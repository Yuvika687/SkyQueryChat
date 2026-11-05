"""API tests. No LLM quota is used: the agent runs on Pydantic AI FunctionModel scripts."""
import asyncio
import json
import os
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from pydantic_ai.exceptions import ModelRateLimitError
from pydantic_ai.messages import ModelResponse, TextPart, ToolCallPart, ToolReturnPart
from pydantic_ai.models.fallback import FallbackModel
from pydantic_ai.models.function import FunctionModel

from backend.agent import core, models as M
from backend.api.main import LockedStore, create_app
from backend.api.settings import Settings
from backend.api.sse import parse
from backend.analysis.store import Store

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "data" / "app"
pytestmark = pytest.mark.skipif(not (APP / "city_daily.parquet").exists(), reason="app tables not built")
ORDER = ["meta", "step", "answer", "cards", "chart", "sources", "warnings", "done"]


@pytest.fixture(scope="module")
def store():
    return LockedStore(Store.from_dir(APP).tables)


def trend_model(counter=None):
    """Scripted model: one tool call, then a final answer quoting the tool's mean."""
    def fn(messages, info):
        if counter is not None:
            counter["calls"] = counter.get("calls", 0) + 1
        rets = [p for m in messages for p in getattr(m, "parts", []) if isinstance(p, ToolReturnPart)]
        if not rets:
            return ModelResponse(parts=[ToolCallPart("city_trend", {"city": "Delhi", "period": "November 2025"})])
        p = rets[-1].content
        return ModelResponse(parts=[TextPart(json.dumps({"status": "answered", "answer": f"Delhi averaged {p['fields']['mean']} µg/m³.",
                                                         "cards": [f"{p['id']}.mean"], "chart": p["id"]}))])
    return FunctionModel(fn)


def make(store, model=None, factory=None, demo=None, **kw):
    s = Settings(**{"allowed_origins": ["http://localhost:3000"], "rate_per_minute": 50, "rate_per_day": 500,
                    "daily_token_budget": 1_000_000, "question_timeout_s": 20, **kw})
    f = factory or (lambda: core.build_agent(model or trend_model()))
    return create_app(agent_factory=f, store=store, settings=s, demo=demo or {})


def chat(client, msg, sid=None, headers=None):
    r = client.post("/api/chat", json={"message": msg, **({"session_id": sid} if sid else {})}, headers=headers or {})
    return r, parse(r.text) if r.headers.get("content-type", "").startswith("text/event-stream") else []


def names(events):
    return [e for e, _ in events]


def assert_order(evs):
    idx = [ORDER.index(e) for e in evs if e in ORDER]
    assert idx == sorted(idx), evs


# ----------------------------------------------------------------------------- read-only endpoints
def test_health_is_fast_and_has_no_secrets(store, monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "gsk_THIS_IS_A_FAKE_TEST_KEY_123456")
    with TestClient(make(store)) as c:
        r = c.get("/api/health")
        assert r.status_code == 200 and r.json()["status"] == "ok" and r.json()["data_loaded"]
        assert r.json()["ai_configured"] is True
        for path in ("/api/health", "/api/meta", "/api/limits", "/api/accuracy"):
            assert "gsk_THIS_IS_A_FAKE" not in c.get(path).text


def test_data_endpoints(store):
    with TestClient(make(store)) as c:
        st = c.get("/api/stations", params={"city": "Bombay"}).json()
        assert st["count"] > 0 and {x["city"] for x in st["stations"]} == {"Mumbai"}
        cities = c.get("/api/cities").json()["cities"]
        assert [x["city"] for x in cities] == ["Delhi", "Mumbai", "Kolkata", "Chennai", "Bengaluru", "Hyderabad"]
        assert cities[0]["latest_official_aqi"]["data_type"] == "official AQI" and cities[0]["pm25"]["data_type"] == "measured"
        s = c.get("/api/cities/Delhi/summary", params={"period": "March to June 2026"}).json()
        assert s["period"] == {"start": "2026-03-01", "end": "2026-06-30"}
        t = c.get("/api/trends", params={"city": "Delhi", "pollutant": "PM10", "period": "2025", "freq": "M"}).json()
        assert t["kind"] == "city_trend" and t["chart"]["type"] == "line"
        assert c.get("/api/coverage", params={"city": "Chennai"}).json()["kind"] == "coverage_summary"
        d = c.get("/api/diwali/Delhi", params={"years": "2024,2025,2026"}).json()
        assert d["values"]["years"][2]["status"] == "not_available"
        assert "Bulletin" in d["chart"]["x"]["label"] or "bulletin" in d["chart"]["x"]["label"]
        lim = c.get("/api/limits").json()["limits"]
        assert any("481" in x["detail"] and "351" in x["detail"] for x in lim)
        assert "sets" in c.get("/api/accuracy").json()


def test_pm_only_estimates_are_not_exposed(store):
    with TestClient(make(store)) as c:
        for path in ("/api/cities", "/api/diwali/Delhi", "/api/meta", "/api/accuracy"):
            assert "pm-only" not in c.get(path).text.lower()


def test_invalid_input_gives_safe_errors_with_request_id(store):
    with TestClient(make(store)) as c:
        r = c.get("/api/trends", params={"city": "Pune"})
        assert r.status_code == 400 and r.json()["error"]["code"] == "invalid_input" and "Delhi" in r.json()["error"]["message"]
        assert r.json()["error"]["request_id"] == r.headers["X-Request-ID"]
        assert c.get("/api/trends", params={"city": "Delhi", "freq": "X"}).status_code == 422
        assert c.get("/api/trends", params={"city": "Delhi", "period": "the year of the dragon"}).status_code == 400
        for body in ({"message": ""}, {"message": "   "}, {"message": "x" * 501}, {"message": "hi", "session_id": "bad"}, {}):
            r = c.post("/api/chat", json=body)
            assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_input"
            assert "Traceback" not in r.text
        assert c.get("/api/nope").json()["error"]["code"] == "not_found"


def test_request_id_is_echoed(store):
    with TestClient(make(store)) as c:
        r = c.get("/api/health", headers={"X-Request-ID": "abc12345-test"})
        assert r.headers["X-Request-ID"] == "abc12345-test"
        r = c.get("/api/health", headers={"X-Request-ID": "bad id with spaces"})
        assert len(r.headers["X-Request-ID"]) == 32


def test_cors_uses_allowed_origins(store):
    with TestClient(make(store)) as c:
        ok = c.options("/api/chat", headers={"Origin": "http://localhost:3000", "Access-Control-Request-Method": "POST"})
        assert ok.headers.get("access-control-allow-origin") == "http://localhost:3000"
        bad = c.get("/api/health", headers={"Origin": "https://evil.example"})
        assert "access-control-allow-origin" not in bad.headers


# ----------------------------------------------------------------------------- chat streaming
def test_chat_stream_order_and_payloads(store):
    with TestClient(make(store)) as c:
        r, ev = chat(c, "Delhi PM2.5 in November 2025?")
        assert r.status_code == 200 and r.headers["content-type"].startswith("text/event-stream")
        n = names(ev)
        assert n[0] == "meta" and n[-1] == "done" and "error" not in n
        assert_order(n)
        assert n.index("answer") > max(i for i, x in enumerate(n) if x == "step")
        d = dict(ev)
        assert d["answer"]["status"] == "answered" and d["cards"][0]["unit"] == "µg/m³"
        assert d["chart"]["type"] == "line" and d["sources"]["sources"][0]["data_type"] == "measured"
        assert d["done"]["request_id"] == d["meta"]["request_id"] == r.headers["X-Request-ID"]
        steps = [x["type"] for e, x in ev if e == "step"]
        assert steps[0] == "run_started" and "tool_call" in steps and "verification" in steps


def test_follow_up_uses_same_session(store):
    with TestClient(make(store)) as c:
        _, ev = chat(c, "Delhi PM2.5 in November 2025?")
        sid = dict(ev)["meta"]["session_id"]
        _, ev2 = chat(c, "And in more detail?", sid=sid)
        assert dict(ev2)["meta"]["session_id"] == sid and dict(ev2)["done"]["cached"] is False


def test_repeated_question_is_served_from_cache(store):
    counter = {}
    with TestClient(make(store, model=trend_model(counter))) as c:
        chat(c, "Delhi PM2.5 in November 2025?")
        calls = counter["calls"]
        _, ev = chat(c, "  delhi pm2.5 in november 2025? ")
        d = dict(ev)
        assert d["done"]["cached"] is True and d["done"]["source"] == "cache" and counter["calls"] == calls
        assert_order(names(ev)) or True
        assert d["cards"][0]["value"] > 0


def test_demo_answer_served_without_llm(store):
    demo = {"what is delhi s diwali aqi": {"question": "What is Delhi's Diwali AQI?", "steps": [],
            "final": {"status": "answered", "answer": "Cached demo answer.", "cards": [], "chart": None,
                      "sources": [], "warnings": [], "data_types": ["official_aqi"]}}}

    def broken():
        raise RuntimeError("no keys")
    with TestClient(make(store, factory=broken, demo=demo)) as c:
        _, ev = chat(c, "What is Delhi's Diwali AQI?")
        assert dict(ev)["answer"]["text"] == "Cached demo answer." and dict(ev)["done"]["source"] == "demo"
        _, ev = chat(c, "Something not cached")
        assert dict(ev)["error"]["code"] == "model_unavailable"
        assert c.get("/api/cities").status_code == 200          # data pages still work


def test_rate_limit_per_visitor(store):
    with TestClient(make(store, rate_per_minute=2)) as c:
        h = {"X-Visitor-Id": "visitor-abc-123"}
        assert chat(c, "q one", headers=h)[0].status_code == 200
        assert chat(c, "q two", headers=h)[0].status_code == 200
        r, _ = chat(c, "q three", headers=h)
        assert r.status_code == 429 and r.json()["error"]["code"] == "rate_limited" and int(r.headers["Retry-After"]) > 0
        assert chat(c, "q one", headers={"X-Visitor-Id": "other-visitor-99"})[0].status_code == 200


def test_daily_token_budget_shows_ai_limit_and_keeps_cache(store):
    with TestClient(make(store, daily_token_budget=0)) as c:
        _, ev = chat(c, "Delhi PM2.5 in November 2025?")
        d = dict(ev)
        assert d["error"]["code"] == "ai_limit" and "limit" in d["error"]["message"].lower()
        assert names(ev) == ["meta", "error", "done"]
        assert c.get("/api/trends", params={"city": "Delhi"}).status_code == 200


def test_provider_quota_error_maps_to_ai_limit(store):
    def dead(m, info):
        raise ModelRateLimitError("groq-test", "Rate limit reached ... tokens per day (TPD)")
    factory = lambda: core.build_agent(FallbackModel(FunctionModel(dead), fallback_on=M._record_fallback))
    with TestClient(make(store, factory=factory)) as c:
        _, ev = chat(c, "Delhi?")
        d = dict(ev)
        assert d["error"]["code"] == "ai_limit" and names(ev)[-1] == "done"
        assert "TPD" not in json.dumps(d)                                  # provider text never leaks


def test_verification_failure_is_a_clean_error(store):
    def liar(m, info):
        return ModelResponse(parts=[TextPart(json.dumps({"status": "answered", "answer": "Delhi was 987.6."}))])
    with TestClient(make(store, model=FunctionModel(liar))) as c:
        _, ev = chat(c, "Delhi?")
        assert dict(ev)["error"]["code"] == "verification_failed"


def test_timeout(store):
    async def slow(m, info):
        await asyncio.sleep(5)
        return ModelResponse(parts=[TextPart("{}")])
    with TestClient(make(store, model=FunctionModel(slow), question_timeout_s=1)) as c:
        _, ev = chat(c, "Delhi?")
        assert dict(ev)["error"]["code"] == "timeout" and names(ev)[-1] == "done"


def test_disconnect_cancels_agent_task(store):
    flag = {"cancelled": False}

    async def slow(m, info):
        try:
            await asyncio.sleep(30)
        except asyncio.CancelledError:
            flag["cancelled"] = True
            raise
        return ModelResponse(parts=[TextPart("{}")])
    app = make(store, model=FunctionModel(slow), heartbeat_s=0.05)

    async def go():
        async with app.router.lifespan_context(app):
            route = next(r for r in app.routes if getattr(r, "path", "") == "/api/chat")
            from backend.api.main import ChatRequest
            calls = {"n": 0}

            async def is_disconnected():
                calls["n"] += 1
                return calls["n"] > 1
            req = SimpleNamespace(state=SimpleNamespace(request_id="rid-test-0001"), is_disconnected=is_disconnected,
                                  headers={}, client=SimpleNamespace(host="t"))
            resp = await route.endpoint(ChatRequest(message="Delhi?"), req)
            chunks = []
            async for ch in resp.body_iterator:
                chunks.append(ch)
            await asyncio.sleep(0.05)
            return chunks
    chunks = asyncio.run(go())
    assert chunks[0].startswith("id: 0\nevent: meta") and not any("event: done" in c for c in chunks)
    assert flag["cancelled"] is True


def test_closing_stream_early_cancels_task(store):
    flag = {"cancelled": False}

    async def slow(m, info):
        try:
            await asyncio.sleep(30)
        except asyncio.CancelledError:
            flag["cancelled"] = True
            raise
        return ModelResponse(parts=[TextPart("{}")])
    app = make(store, model=FunctionModel(slow), heartbeat_s=0.05)

    async def go():
        async with app.router.lifespan_context(app):
            route = next(r for r in app.routes if getattr(r, "path", "") == "/api/chat")
            from backend.api.main import ChatRequest

            async def never():
                return False
            req = SimpleNamespace(state=SimpleNamespace(request_id="rid-test-0002"), is_disconnected=never,
                                  headers={}, client=SimpleNamespace(host="t"))
            resp = await route.endpoint(ChatRequest(message="Delhi?"), req)
            it = resp.body_iterator
            first = await it.__anext__()
            while "model_request" not in await it.__anext__():   # until the model call has started
                pass
            await asyncio.sleep(0.1)
            await it.aclose()                  # client goes away
            await asyncio.sleep(0.05)
            return first
    assert "event: meta" in asyncio.run(go())
    assert flag["cancelled"] is True


# ----------------------------------------------------------------------------- memory
def test_memory_fits_render_free_tier():
    code = ("import resource,sys,json;"
            "from fastapi.testclient import TestClient;"
            "from backend.api.main import create_app;"
            "app=create_app();c=TestClient(app);c.__enter__();"
            "[c.get(p) for p in ('/api/health','/api/cities','/api/stations','/api/trends?city=Delhi&freq=D',"
            "'/api/coverage?city=Delhi','/api/diwali/Delhi')];"
            "from backend.agent import core;import os;os.environ.setdefault('GROQ_API_KEY','gsk_fake_for_memory_test');"
            "a=core.build_agent();"
            "r=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss;"
            "print(json.dumps({'max_rss_mb': round(r/(1024*1024 if sys.platform=='darwin' else 1024),1)}))")
    out = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, cwd=ROOT,
                         env={**os.environ, "PYTHONPATH": str(ROOT)}, timeout=180)
    mb = json.loads(out.stdout.strip().splitlines()[-1])["max_rss_mb"]
    print(f"peak RSS {mb} MB")
    assert mb < 400, mb          # Render free tier: 512 MB
