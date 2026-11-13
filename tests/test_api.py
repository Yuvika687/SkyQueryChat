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
from backend.agent.quota import ProviderLimit, QuotaConfig, QuotaManager
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
                                                         "explanation": f"The highest day reached {p['fields']['highest_value']} µg/m³.",
                                                         "follow_ups": ["Compare Delhi and Mumbai in November 2025?"],
                                                         "cards": [f"{p['id']}.mean"], "chart": p["id"]}))])
    return FunctionModel(fn)


def _quota(limits=None, **cfg):
    """A fresh shared quota per test (never the process-wide one)."""
    lim = {"test:primary": ProviderLimit("test:primary", rpm=1000, tpm=10_000_000, rpd=100_000, daily_token_budget=10**9),
           "test:backup": ProviderLimit("test:backup", rpm=1000, tpm=10_000_000, rpd=100_000, daily_token_budget=10**9)}
    lim.update(limits or {})
    return QuotaManager(lim, QuotaConfig(**cfg))


def make(store, model=None, factory=None, demo=None, quota=None, **kw):
    s = Settings(**{"allowed_origins": ["http://localhost:3000"], "rate_per_minute": 50, "rate_per_day": 500,
                    "question_timeout_s": 20, **kw})
    qm = quota or _quota()
    f = factory or (lambda: core.build_agent(M.limited_chain([("test:primary", model or trend_model())], qm)))
    return create_app(agent_factory=f, store=store, settings=s, demo=demo or {}, quota=qm)


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
        assert d["values"]["years"][2]["status"] == "ok" and d["values"]["years"][2]["festival_level_aqi"] == 321.5
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
        h = {"True-Client-IP": "203.0.113.7"}
        assert chat(c, "q one", headers=h)[0].status_code == 200
        assert chat(c, "q two", headers=h)[0].status_code == 200
        r, _ = chat(c, "q three", headers=h)
        assert r.status_code == 429 and r.json()["error"]["code"] == "rate_limited" and int(r.headers["Retry-After"]) > 0
        assert chat(c, "q one", headers={"True-Client-IP": "198.51.100.20"})[0].status_code == 200


def test_rate_limit_cannot_be_dodged_with_spoofed_headers(store):
    """Behind Render (Cloudflare sets True-Client-IP). A client may send its own X-Forwarded-For or
    X-Visitor-Id; neither changes who it is."""
    with TestClient(make(store, rate_per_minute=2)) as c:
        real = {"True-Client-IP": "203.0.113.7"}
        assert chat(c, "q one", headers=real)[0].status_code == 200
        assert chat(c, "q two", headers={**real, "X-Forwarded-For": "1.2.3.4"})[0].status_code == 200
        for fake in ({"X-Forwarded-For": "9.9.9.9, 10.0.0.1"}, {"X-Visitor-Id": "brand-new-visitor-1"}):
            r, _ = chat(c, "q three", headers={**real, **fake})
            assert r.status_code == 429
        v = c.get("/api/visitor", headers={**real, "X-Forwarded-For": "9.9.9.9"}).json()
        assert v["identified_by"] == "true-client-ip" and "203.0.113.7" not in json.dumps(v)


def test_cf_connecting_ip_fallback_and_socket_for_local(store):
    with TestClient(make(store)) as c:
        assert c.get("/api/visitor", headers={"CF-Connecting-IP": "198.51.100.9"}).json()["identified_by"] == "cf-connecting-ip"
        assert c.get("/api/visitor", headers={"True-Client-IP": "not an ip <script>"}).json()["identified_by"] == "socket"
        assert c.get("/api/visitor").json()["identified_by"] == "socket"
        a = c.get("/api/visitor", headers={"True-Client-IP": "203.0.113.7"}).json()["visitor_key"]
        b = c.get("/api/visitor", headers={"True-Client-IP": "203.0.113.8"}).json()["visitor_key"]
        assert a != b


def test_exhausted_shared_quota_shows_ai_limit_and_keeps_cache(store):
    counter = {}
    tiny = {"test:primary": ProviderLimit("test:primary", rpm=100, tpm=10**7, rpd=7, daily_token_budget=10**9)}
    qm = _quota(tiny, safety_margin=1.0, demo_reserve=0.0, question_requests=4)
    with TestClient(make(store, model=trend_model(counter), quota=qm)) as c:
        _, ev = chat(c, "Delhi PM2.5 in November 2025?")          # needs room for 4, uses 2
        assert dict(ev)["answer"]["status"] == "answered"
        _, ev = chat(c, "Delhi PM2.5 in October 2025?")           # 2 + 4 <= 7: still room
        assert "answer" in names(ev)
        calls = counter["calls"]
        _, ev = chat(c, "Delhi PM10 in October 2025?")            # 4 used, 4 + 4 > 7: blocked
        d = dict(ev)
        assert names(ev) == ["meta", "error", "done"] and d["error"]["code"] == "ai_limit"
        assert "resets in about" in d["error"]["message"] and d["error"]["retry_after_s"] > 0
        assert counter["calls"] == calls                           # no model call was made
        _, ev = chat(c, "delhi pm2.5 in november 2025")            # saved answer still served
        assert dict(ev)["done"]["cached"] is True
        assert c.get("/api/trends", params={"city": "Delhi"}).status_code == 200
        q = c.get("/api/quota").json()
        assert q["models"]["test:primary"]["state"] == "exhausted" and q["plan"]["state"] == "exhausted"
        assert c.get("/api/health").json()["ai_quota"]["state"] == "exhausted"


def test_cached_answer_served_on_follow_up_turn_when_quota_is_exhausted(store):
    tiny = {"test:primary": ProviderLimit("test:primary", rpm=100, tpm=10**7, rpd=5, daily_token_budget=10**9)}
    qm = _quota(tiny, safety_margin=1.0, demo_reserve=0.0, question_requests=4)
    with TestClient(make(store, quota=qm)) as c:
        _, ev = chat(c, "Delhi PM2.5 in November 2025?")
        sid = dict(ev)["meta"]["session_id"]
        _, ev = chat(c, "Delhi PM2.5 in November 2025?", sid=sid)  # follow-up turn, no room left
        d = dict(ev)
        assert names(ev)[:2] == ["meta", "notice"] and d["notice"]["code"] == "cached_fallback"
        assert d["done"]["cached"] is True and "error" not in d


def test_primary_at_limit_uses_backup_with_notice(store):
    used = {"p": 0, "b": 0}

    def counting(key):
        inner = trend_model()

        async def fn(messages, info):
            used[key] += 1
            return await inner.function(messages, info) if asyncio.iscoroutinefunction(inner.function) \
                else inner.function(messages, info)
        return FunctionModel(fn)
    lim = {"test:primary": ProviderLimit("test:primary", rpm=100, tpm=10**7, rpd=3, daily_token_budget=10**9)}
    qm = _quota(lim, safety_margin=1.0, demo_reserve=0.0, question_requests=4)
    f = lambda: core.build_agent(M.limited_chain([("test:primary", counting("p")), ("test:backup", counting("b"))], qm))
    with TestClient(make(store, factory=f, quota=qm)) as c:
        c.get("/api/health")
        _, ev = chat(c, "Delhi PM2.5 in November 2025?")
        d = dict(ev)
        assert d["notice"]["code"] == "fallback" and d["notice"]["model"] == "test:backup"
        assert d["answer"]["status"] == "answered" and used == {"p": 0, "b": 2}
        steps = [x for e, x in ev if e == "step"]
        assert any(x["type"] == "fallback" and "shared limit" in x["detail"]["reason"] for x in steps)


def test_low_quota_notice(store):
    lim = {"test:primary": ProviderLimit("test:primary", rpm=100, tpm=10**7, rpd=20, daily_token_budget=10**9)}
    qm = _quota(lim, safety_margin=1.0, demo_reserve=0.0, question_requests=4, low_fraction=0.55)
    with TestClient(make(store, quota=qm)) as c:
        chat(c, "Delhi PM2.5 in November 2025?")
        chat(c, "Delhi PM2.5 in October 2025?")
        chat(c, "Delhi PM2.5 in September 2025?")                 # 6 used of 20 -> 70% left
        _, ev = chat(c, "Delhi PM2.5 in August 2025?")              # asked with 6 of 20 used (70% left): ok
        assert "notice" not in names(ev)
        chat(c, "Delhi PM2.5 in July 2025?")
        _, ev = chat(c, "Delhi PM2.5 in June 2025?")                # asked with 10 used (50% < 55%): low
        d = dict(ev)
        assert d["notice"]["code"] == "low" and "running low" in d["notice"]["message"]
        assert d["answer"]["status"] == "answered"


def test_demo_token_unlocks_reserved_quota(store, monkeypatch):
    monkeypatch.setenv("DEMO_ACCESS_TOKEN", "owner-demo-pass-0123456789")
    lim = {"test:primary": ProviderLimit("test:primary", rpm=100, tpm=10**7, rpd=10, daily_token_budget=10**9)}
    qm = _quota(lim, safety_margin=1.0, demo_reserve=0.5, question_requests=4)   # public cap = 5 requests
    with TestClient(make(store, quota=qm)) as c:
        _, ev = chat(c, "Delhi PM2.5 in November 2025?")            # public cap 5: 0 + 4 fits, uses 2
        assert "answer" in names(ev)
        _, ev = chat(c, "Delhi PM2.5 in October 2025?")
        assert dict(ev)["error"]["code"] == "ai_limit"
        _, ev = chat(c, "Delhi PM2.5 in October 2025?", headers={"X-Demo-Token": "wrong-pass"})
        assert dict(ev)["error"]["code"] == "ai_limit"
        _, ev = chat(c, "Delhi PM2.5 in October 2025?", headers={"X-Demo-Token": "owner-demo-pass-0123456789"})
        assert dict(ev)["answer"]["status"] == "answered"
        for path in ("/api/health", "/api/quota"):
            assert "owner-demo-pass" not in c.get(path).text


def test_quota_is_shared_across_visitors(store):
    lim = {"test:primary": ProviderLimit("test:primary", rpm=100, tpm=10**7, rpd=7, daily_token_budget=10**9)}
    qm = _quota(lim, safety_margin=1.0, demo_reserve=0.0, question_requests=4)
    with TestClient(make(store, quota=qm)) as c:
        assert "answer" in names(chat(c, "Delhi PM2.5 in November 2025?", headers={"True-Client-IP": "203.0.113.1"})[1])
        assert "answer" in names(chat(c, "Delhi PM2.5 in October 2025?", headers={"True-Client-IP": "203.0.113.2"})[1])
        _, ev = chat(c, "Delhi PM2.5 in May 2025?", headers={"True-Client-IP": "203.0.113.3"})
        assert dict(ev)["error"]["code"] == "ai_limit"           # a new visitor sees the shared limit
        assert qm.get("test:primary").status()["used_today"]["requests"] == 4


def test_provider_quota_error_maps_to_ai_limit(store):
    def dead(m, info):
        raise ModelRateLimitError("groq-test", "Rate limit reached ... tokens per day (TPD)")
    factory = lambda: core.build_agent(FallbackModel(FunctionModel(dead), fallback_on=M._record_fallback))
    with TestClient(make(store, factory=factory)) as c:
        _, ev = chat(c, "Delhi?")
        d = dict(ev)
        assert d["error"]["code"] == "ai_limit" and names(ev)[-1] == "done"
        assert "TPD" not in json.dumps(d)                                  # provider text never leaks


def test_provider_daily_429_blocks_model_until_reset(store):
    calls = {"n": 0}

    def dead(m, info):
        calls["n"] += 1
        raise ModelRateLimitError("primary", "Rate limit reached ... tokens per day (TPD)")
    qm = _quota()
    f = lambda: core.build_agent(M.limited_chain([("test:primary", FunctionModel(dead, model_name="primary"))], qm))
    with TestClient(make(store, factory=f, quota=qm)) as c:
        _, ev = chat(c, "Delhi?")
        assert dict(ev)["error"]["code"] == "ai_limit" and calls["n"] == 1
        _, ev = chat(c, "Delhi again?")                               # no second provider call today
        assert dict(ev)["error"]["code"] == "ai_limit" and calls["n"] == 1
        assert qm.get("test:primary").status()["state"] == "exhausted"


def test_minute_limit_busy_gives_ai_busy(store):
    lim = {"test:primary": ProviderLimit("test:primary", rpm=1, tpm=10**7, rpd=1000, daily_token_budget=10**9)}
    qm = _quota(lim, safety_margin=1.0, max_queue_wait_s=0.5)
    with TestClient(make(store, quota=qm)) as c:
        _, ev = chat(c, "Delhi PM2.5 in November 2025?")       # 2nd request needs to wait ~60 s > 0.5 s
        d = dict(ev)
        assert d["error"]["code"] == "ai_busy" and "busy" in d["error"]["message"]


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


def test_every_model_timing_out_gives_a_clear_error(store):
    async def slow(m, info):
        await asyncio.sleep(5)
        return ModelResponse(parts=[TextPart("late")])
    qm = _quota()
    f = lambda: core.build_agent(M.limited_chain([("test:primary", FunctionModel(slow, model_name="primary")),
                                                  ("test:backup", FunctionModel(slow, model_name="backup"))],
                                                 qm, timeout_s=0.2))
    with TestClient(make(store, factory=f, quota=qm)) as c:
        _, ev = chat(c, "Delhi PM2.5 in November 2025?")
        d = dict(ev)
        assert d["error"]["code"] == "model_timeout" and "took too long" in d["error"]["message"]
        assert names(ev)[-1] == "done"


def test_health_reports_active_rate_limits(store):
    with TestClient(make(store)) as c:
        h = c.get("/api/health").json()
        assert h["rate_limits"] == {"per_minute": 50, "per_day": 500, "production": False}
        assert not any("groq" in k for k in h["ai_quota"]["models"])


def test_answer_event_carries_llm_headline_explanation_follow_ups_and_code_method(store):
    with TestClient(make(store)) as c:
        _, ev = chat(c, "Delhi PM2.5 in November 2025?")
        a = dict(ev)["answer"]
        assert a["headline"] == a["text"] and a["text"].startswith("Delhi averaged ")       # written by the model
        assert a["explanation"].startswith("The highest day reached ")                    # written by the model
        assert a["follow_ups"] == ["Compare Delhi and Mumbai in November 2025?"]
        assert a["method"].startswith("Measured PM") and a["verification"]["answer_source"] == "llm"


def test_saved_demo_answer_replays_its_llm_text(store):
    from backend.api.protect import normalise
    demo = {normalise(a["question"]): a for a in json.loads((APP / "demo_answers.json").read_text())["answers"]}
    saved = demo[normalise("How bad was Delhi's air on Diwali 2025?")]["final"]
    with TestClient(make(store, demo=demo)) as c:
        _, ev = chat(c, "How bad was Delhi's air on Diwali 2025?")
        a = dict(ev)["answer"]
        assert a["text"] == saved["answer"] and a["headline"] == (saved.get("headline") or saved["answer"])
        assert a["method"] and a["cached"]


def test_latest_city_values_for_the_home_page(store):
    with TestClient(make(store)) as c:
        r = c.get("/api/latest")
        assert r.status_code == 200
        d = r.json()
        assert d["data_type"] == "measured" and d["pollutant"] == "pm25" and d["units"] == "µg/m³"
        assert {x["city"] for x in d["cities"]} == {"Delhi", "Mumbai", "Kolkata", "Chennai", "Bengaluru", "Hyderabad"}
        vals = [x["value"] for x in d["cities"]]
        assert vals == sorted(vals, reverse=True)                       # highest first
        for x in d["cities"]:
            assert len(x["series"]) == 7 and x["series"][-1] == {"date": d["date"], "value": x["value"]}
            assert x["series"][0]["date"] == d["start"]
            assert 0 < x["stations_reporting"] <= x["stations_total"]
            assert 5 < x["lat"] < 35 and 68 < x["lon"] < 98
        # same values as the city table: latest date every city has a valid value
        cd = store.tables["city_daily"]
        delhi = cd[(cd.city == "Delhi") & (cd.pollutant == "pm25") & (cd.local_date.astype(str) == d["date"])]
        assert round(float(delhi.city_mean.iloc[0]), 1) == next(x["value"] for x in d["cities"] if x["city"] == "Delhi")
        assert c.get("/api/latest", params={"pollutant": "pm10"}).json()["pollutant"] == "pm10"
        assert c.get("/api/latest", params={"pollutant": "no2"}).status_code == 422
        assert c.get("/api/latest").json() == d                         # cached, unchanged


def test_explore_station_days_for_the_map(store):
    with TestClient(make(store)) as c:
        d = c.get("/api/explore").json()
        assert d["data_type"] == "measured" and d["pollutant"] == "pm25" and d["min_valid_hours"] == 16
        assert len(d["dates"]) == 30 and d["dates"][-1] == c.get("/api/latest").json()["date"]
        assert set(d["cities"]) == {"Delhi", "Mumbai", "Kolkata", "Chennai", "Bengaluru", "Hyderabad"}
        assert {s["tier"] for s in d["stations"]} <= {"primary", "low_cost", "supporting_single_station"}
        sd = store.tables["station_daily"]
        for s in d["stations"][:20]:
            assert len(s["values"]) == len(s["valid_hours"]) == 30 and 5 < s["lat"] < 35 and 68 < s["lon"] < 98
            for day, v, h in zip(d["dates"], s["values"], s["valid_hours"]):
                if v is not None:
                    assert h >= 16                                   # a value needs >= 16 valid hours
                    row = sd[(sd.location_id == s["id"]) & (sd.pollutant == "pm25") & (sd.local_date.astype(str) == day)]
                    assert round(float(row.daily_mean.max()), 1) == v
                elif h is not None:
                    assert h < 16                                    # "not enough data", never a made-up value
        delhi = d["cities"]["Delhi"]
        assert delhi["values"][-1] == next(x["value"] for x in c.get("/api/latest").json()["cities"] if x["city"] == "Delhi")
        assert c.get("/api/explore", params={"pollutant": "pm10"}).json()["pollutant"] == "pm10"
        assert c.get("/api/explore", params={"pollutant": "so2"}).status_code == 422


def test_city_page_data(store):
    with TestClient(make(store)) as c:
        d = c.get("/api/city/delhi").json()
        latest = c.get("/api/latest").json()
        assert d["city"] == "Delhi" and d["date"] == latest["date"]
        assert d["hero"]["pm25"] == next(x["value"] for x in latest["cities"] if x["city"] == "Delhi")
        t = d["trend30"]
        assert len(t["pm25"]) == len(t["pm10"]) == 30 and t["pm25"][-1]["value"] == d["hero"]["pm25"]
        assert any(x["value"] is None for x in t["pm25"])                    # gaps stay gaps, never filled
        assert d["calendar"]["start"] >= "2025-02-01"                        # never bridges the old-sensor gap
        years = {y["year"]: y for y in d["diwali"]["years"]}
        assert years[2026]["level"] == 321.5 and [b["aqi"] for b in years[2026]["bulletins"]] == [344.0, 299.0]
        assert all(len(y.get("change_range_pct", [0, 0])) == 2 for y in years.values())   # percentages only as ranges
        assert d["diwali"]["pm_context"] and all(p["warnings"] for p in d["diwali"]["pm_context"])
        assert all(u["reason"] for u in d["unusual"]["days"])
        assert "association" not in d["weather"]["rainfall"]["statement"] or "not a cause" in d["weather"]["rainfall"]["statement"]
        assert d["weather"]["rainfall"]["chart"]["series"][-1]["type"] == "line"      # fitted line from Python
        assert {s["tier"] for s in d["stations"]} <= {"primary", "low_cost", "supporting_single_station"}
        assert c.get("/api/city/mumbai").json()["diwali"]["pm_context"] is None      # Delhi only
        assert c.get("/api/city/london").status_code == 400


def test_compare_page_data(store):
    with TestClient(make(store)) as c:
        per = c.get("/api/compare/periods").json()
        p30 = next(p for p in per["presets"] if p["id"] == "30d")
        resp = c.get("/api/compare", params={"cities": "Delhi,Mumbai", "metric": "pm25", "start": p30["start"], "end": p30["end"]})
        assert resp.status_code == 200, resp.text
        d = resp.json()
        assert len(d["dates"]) == 30 and set(d["lines"]) == {"Delhi", "Mumbai"} and d["units"] == "µg/m³"
        top = d["cities"][0]
        assert top["city"] == "Delhi" and top["range95"][0] < top["mean"] < top["range95"][1]
        assert top["trend"]["status"] in ("increasing", "decreasing", "no clear trend", "not enough data")
        a = c.get("/api/compare", params={"cities": "Delhi,Mumbai,Chennai", "metric": "aqi",
                                           "start": "2025-12-01", "end": "2026-02-28"}).json()
        assert a["units"] == "AQI (index)" and a["data_type"] == "official AQI"
        assert ["Chennai", "Mumbai"] in a["too_close_to_call"]
        bad = c.get("/api/compare", params={"cities": "Delhi", "metric": "pm25", "start": p30["start"], "end": p30["end"]})
        assert bad.status_code == 400
        assert c.get("/api/compare", params={"cities": "Delhi,Mumbai", "start": "2020-01-01", "end": "2020-02-01"}).status_code == 400


def test_accuracy_reports_first_pass_scores_and_crosscheck(store):
    with TestClient(make(store)) as c:
        d = c.get("/api/accuracy").json()
        assert d["answer_wording_since"] and "main" in d["sets"]
        mp = d["sets"]["main"]["main_first_pass"]
        assert mp["kind"] == "first" and mp["complete"]                     # only complete first passes are headline
        assert set(d["crosscheck"]["by_city"]) == {"Delhi", "Mumbai", "Kolkata", "Chennai", "Bengaluru", "Hyderabad"}
