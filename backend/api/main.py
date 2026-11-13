"""SkyQueryChat API (FastAPI). Run: uvicorn backend.api.main:app --port 8000

POST /api/chat streams Server-Sent Events: meta -> step* -> answer -> cards -> chart -> sources ->
warnings -> done (or ... -> error -> done). Data endpoints never call an LLM, so they keep working
when the AI quota is exhausted. API keys stay in the backend environment and are never returned.
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
import re
import threading
import time
import uuid
from contextlib import asynccontextmanager
from datetime import date, timedelta
from pathlib import Path
from typing import Callable

from dotenv import load_dotenv
from fastapi import FastAPI, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field, field_validator
from starlette.exceptions import HTTPException as StarletteHTTPException

from backend.agent import core, models as M, resolver as R
from backend.analysis import functions as F, pages as PG
from backend.analysis.store import Store, read_tables
from backend.agent.quota import QuotaManager
from .protect import AnswerCache, RateLimiter, load_demo, normalise
from .settings import Settings, is_production
from .sse import PING, sse

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / ".env")
log = logging.getLogger("skyquery.api")
RID = re.compile(r"^[A-Za-z0-9\-]{8,64}$")
SID = re.compile(r"^[a-f0-9]{32}$")
IPV = re.compile(r"^[0-9a-fA-F:.]{2,45}$")
AI_LIMIT_MSG = ("The live AI limit has been reached for now. Cached answers, demo questions and the data pages "
                "still work. Please try a live question later.")
NOTICES = {
    "low": "Live AI quota is running low today. Some questions may use a backup model, and live answers may "
           "pause later; demo questions and the data pages always work.",
    "fallback": "The main AI model is at its shared limit, so this answer uses a backup model.",
    "cached_fallback": "Live AI is at its limit, so this is a saved answer to the same question.",
}
MESSAGES = {
    "ai_limit": AI_LIMIT_MSG,
    "ai_busy": "The live AI is busy with other visitors right now. Please try again in about a minute.",
    "model_unavailable": "The AI models are unavailable right now. Cached answers and data pages still work.",
    "timeout": "The answer took too long and was stopped. Please try a narrower question.",
    "model_timeout": core.ERROR_TEXT["timeout"],
    "verification_failed": core.ERROR_TEXT["verification"],
    "format": core.ERROR_TEXT["format"],
    "too_many_steps": core.ERROR_TEXT["limit"],
    "internal": "Something went wrong. Please try again.",
}


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=500)
    session_id: str | None = None

    @field_validator("message")
    @classmethod
    def _clean(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("message is empty")
        return v

    @field_validator("session_id")
    @classmethod
    def _sid(cls, v):
        if v is not None and not SID.match(v):
            raise ValueError("session_id must be 32 hex characters")
        return v


class LockedStore(Store):
    """DuckDB connections are not thread-safe; agent tools may run in worker threads."""

    def __init__(self, tables):
        super().__init__(tables)
        self._lock = threading.Lock()

    def q(self, sql, params=None):
        with self._lock:
            return super().q(sql, params)


class Sessions:
    def __init__(self, store: Store, ttl_s: int, max_n: int):
        self.store, self.ttl, self.max = store, ttl_s, max_n
        self.items: dict[str, tuple[float, core.Session]] = {}

    def get(self, sid: str | None) -> tuple[str, core.Session]:
        now = time.monotonic()
        for k in [k for k, (t, _) in self.items.items() if now - t > self.ttl]:
            self.items.pop(k, None)
        if sid and sid in self.items:
            s = self.items[sid][1]
        else:
            sid = uuid.uuid4().hex
            s = core.new_session(self.store)
            if len(self.items) >= self.max:
                self.items.pop(min(self.items, key=lambda k: self.items[k][0]))
        self.items[sid] = (now, s)
        return sid, s


def _err(code: str, message: str, rid: str, status: int, headers: dict | None = None) -> JSONResponse:
    return JSONResponse({"error": {"code": code, "message": message, "request_id": rid}}, status_code=status,
                        headers={"X-Request-ID": rid, **(headers or {})})


def create_app(agent_factory: Callable | None = None, store: Store | None = None,
               settings: Settings | None = None, demo: dict | None = None,
               quota: QuotaManager | None = None) -> FastAPI:
    st = settings or Settings()
    qm = quota or M.QUOTA
    state: dict = {"started": time.time(), "agent": None, "agent_error": False}

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if store is None:
            state["store"] = LockedStore(read_tables())       # one load, one DuckDB connection
        else:
            state["store"] = store
        core._set_windows(state["store"])
        state["sessions"] = Sessions(state["store"], st.session_ttl_s, st.max_sessions)
        yield

    app = FastAPI(title="SkyQueryChat API", version="0.3", lifespan=lifespan, docs_url="/api/docs",
                  openapi_url="/api/openapi.json", redoc_url=None)
    app.add_middleware(CORSMiddleware, allow_origins=st.allowed_origins, allow_methods=["GET", "POST"],
                       allow_headers=["Content-Type", "X-Request-ID"],
                       expose_headers=["X-Request-ID", "Retry-After"], allow_credentials=False)
    limiter = RateLimiter(st.rate_per_minute, st.rate_per_day)
    cache = AnswerCache(st.cache_ttl_s, st.cache_max)
    demos = demo if demo is not None else load_demo()
    app.state.protect = {"limiter": limiter, "quota": qm, "cache": cache, "demo": demos, "settings": st}

    @app.middleware("http")
    async def request_id(request: Request, call_next):
        rid = request.headers.get("X-Request-ID", "")
        rid = rid if RID.match(rid) else uuid.uuid4().hex
        request.state.request_id = rid
        t0 = time.perf_counter()
        try:
            resp = await call_next(request)
        except Exception as e:                       # never leak tracebacks
            log.warning("unhandled %s rid=%s", type(e).__name__, rid)
            resp = _err("internal", MESSAGES["internal"], rid, 500)
        resp.headers["X-Request-ID"] = rid
        log.info("%s %s %s %.0fms rid=%s", request.method, request.url.path, resp.status_code,
                 (time.perf_counter() - t0) * 1000, rid)
        return resp

    @app.exception_handler(RequestValidationError)
    async def _invalid(request: Request, exc: RequestValidationError):
        msgs = "; ".join(f"{'.'.join(str(x) for x in e['loc'][1:])}: {e['msg']}" for e in exc.errors())[:300]
        return _err("invalid_input", msgs or "Invalid input.", request.state.request_id, 422)

    @app.exception_handler(StarletteHTTPException)
    async def _http(request: Request, exc: StarletteHTTPException):
        code = "not_found" if exc.status_code == 404 else "http_error"
        msg = "Not found." if exc.status_code == 404 else str(exc.detail)[:200]
        return _err(code, msg, getattr(request.state, "request_id", uuid.uuid4().hex), exc.status_code)

    @app.exception_handler(ValueError)
    async def _value(request: Request, exc: ValueError):
        return _err("invalid_input", str(exc)[:300], request.state.request_id, 400)

    @app.exception_handler(Exception)
    async def _any(request: Request, exc: Exception):
        log.warning("error %s rid=%s", type(exc).__name__, request.state.request_id)
        return _err("internal", MESSAGES["internal"], request.state.request_id, 500)

    def S() -> Store:
        return state["store"]

    def get_agent():
        if state["agent"] is None and not state["agent_error"]:
            try:
                state["agent"] = (agent_factory or core.build_agent)()
            except Exception as e:
                log.warning("agent unavailable: %s", type(e).__name__)
                state["agent_error"] = True
        return state["agent"]

    def _quota_brief() -> dict:
        full = qm.status()
        return {"state": qm.plan()["state"] if qm.chain else "not_started",
                "models": {k: {"state": v["state"], "remaining_today": v["remaining_today"]}
                           for k, v in full["models"].items()}}

    # ------------------------------------------------------------------ health and metadata
    @app.get("/api/health")
    async def health():
        return {"status": "ok", "uptime_s": round(time.time() - state["started"], 1),
                "data_loaded": "store" in state, "ai_configured": st.ai_configured,
                "ai_quota": _quota_brief(),
                "rate_limits": {"per_minute": st.rate_per_minute, "per_day": st.rate_per_day,
                                "production": is_production()},
                "data_windows": {k: str(v) for k, v in R.DATA.items()}}

    @app.get("/api/meta")
    async def meta():
        man = json.loads((ROOT / "data" / "app" / "manifest.json").read_text())
        return {"cities": R.SUPPORTED_CITIES, "pollutants": ["pm25", "pm10"], "data_windows": {k: str(v) for k, v in R.DATA.items()},
                "attribution": man.get("attribution"), "default_analysis_rule": man.get("default_analysis_rule"),
                "demo_questions": [x["question"] for x in demos.values()]}

    @app.get("/api/visitor")
    async def visitor(request: Request):
        """Deployment check: which header identified this visitor (the IP itself is not returned)."""
        ip, how = _client_ip(request)
        return {"identified_by": how, "visitor_key": _visitor(request), "trusted_headers": st.client_ip_headers}

    @app.get("/api/quota")
    async def quota_status():
        """Shared AI quota per model (counts only; no keys)."""
        return {**qm.status(), "plan": qm.plan()}

    @app.get("/api/limits")
    async def limits():
        return json.loads((ROOT / "backend" / "config" / "known_limits.json").read_text())

    # ------------------------------------------------------------------ read-only data
    def _city(c: str) -> str:
        r = R.resolve_city(c)
        if not r.get("city"):
            raise ValueError(r["message"])
        return r["city"]

    def _period(p: str | None) -> tuple[date, date]:
        r = R.resolve_period(p or "all data")
        if not r.get("start"):
            raise ValueError(r["message"])
        return date.fromisoformat(r["start"]), date.fromisoformat(r["end"])

    def _pol(p: str) -> str:
        r = R.resolve_pollutant(p)
        if r.get("pollutant") not in ("pm25", "pm10"):
            raise ValueError("pollutant must be pm25 or pm10")
        return r["pollutant"]

    @app.get("/api/stations")
    async def stations(city: str | None = None):
        q = "SELECT DISTINCT city, tier, monitor_type, location_id, station_name, provider, lat, lon, km_from_centre FROM stations"
        df = S().q(q + (" WHERE city=?" if city else "") + " ORDER BY city, tier, station_name", [_city(city)] if city else [])
        return {"count": int(len(df)), "stations": json.loads(df.to_json(orient="records"))}

    @app.get("/api/cities")
    async def cities():
        end = R.DATA["measured_end"]
        a, out = end - timedelta(days=29), []
        aqi = S().q("SELECT city, bulletin_date, aqi, aqi_category FROM city_daily_aqi WHERE (city, bulletin_date) IN "
                    "(SELECT city, MAX(bulletin_date) FROM city_daily_aqi GROUP BY city)")
        for c in R.SUPPORTED_CITIES:
            row = {"city": c, "last_30_days": {"start": str(a), "end": str(end)}}
            for p in ("pm25", "pm10"):
                t = F.city_trend(S(), c, p, a, end, "M").to_dict()
                row[p] = {"mean": t["values"]["summary"].get("mean_of_daily_values"), "units": "µg/m³",
                          "days_with_data": t["coverage"]["days_with_city_value"], "data_type": "measured"}
            x = aqi[aqi.city == c]
            if len(x):
                row["latest_official_aqi"] = {"bulletin_date": str(x.bulletin_date.iat[0])[:10], "aqi": float(x.aqi.iat[0]),
                                              "category": x.aqi_category.iat[0], "data_type": "official AQI"}
            out.append(row)
        return {"cities": out}

    @app.get("/api/cities/{city}/summary")
    async def city_summary(city: str, period: str | None = Query(None, max_length=60)):
        c = _city(city)
        a, b = _period(period)
        res = {p: F.city_trend(S(), c, p, a, b, "M").to_dict() for p in ("pm25", "pm10")}
        return {"city": c, "period": {"start": str(a), "end": str(b)},
                "pm25": {k: res["pm25"][k] for k in ("values", "coverage", "warnings", "units", "data_type", "source")},
                "pm10": {k: res["pm10"][k] for k in ("values", "coverage", "warnings", "units", "data_type", "source")}}

    @app.get("/api/trends")
    async def trends(city: str, pollutant: str = "pm25", period: str | None = Query(None, max_length=60),
                     freq: str = Query("M", pattern="^[DWM]$")):
        a, b = _period(period)
        return F.city_trend(S(), _city(city), _pol(pollutant), a, b, freq).to_dict()

    @app.get("/api/coverage")
    async def coverage(city: str, period: str | None = Query(None, max_length=60)):
        a, b = _period(period)
        return F.coverage_summary(S(), _city(city), a, b).to_dict()

    @app.get("/api/latest")
    async def latest(pollutant: str = Query("pm25", pattern="^pm(25|10)$")):
        """Home page: each city's latest available value and its last 7 days. Read-only, no LLM, no quota.
        The app tables never change while the server runs, so each result is computed once and kept."""
        cache = state.setdefault("latest", {})
        if pollutant not in cache:
            cache[pollutant] = F.latest_city_values(S(), pollutant)
        return cache[pollutant]

    @app.get("/api/explore")
    async def explore(pollutant: str = Query("pm25", pattern="^pm(25|10)$")):
        """Explore map: every station's daily values over the latest 30 available days. Read-only, no LLM,
        computed once per pollutant and kept (the app tables never change while the server runs)."""
        cache = state.setdefault("explore", {})
        if pollutant not in cache:
            cache[pollutant] = F.explore_data(S(), pollutant)
        return cache[pollutant]

    @app.get("/api/city/{city}")
    async def city_page(city: str):
        """City page: latest value, 30 days, calendar, Diwali AQI, unusual days, weather association, stations.
        Read-only, no LLM, computed once per city and kept."""
        c = _city(city)
        cache = state.setdefault("city", {})
        if c not in cache:
            lat = {p: await latest(pollutant=p) for p in ("pm25", "pm10")}      # reuse the cached results
            ex = await explore(pollutant="pm25")
            cache[c] = await asyncio.to_thread(PG.city_page, S(), c, lat, ex)
        return cache[c]

    @app.get("/api/compare/periods")
    async def compare_periods():
        """Compare page presets, limited to dates that exist in the data."""
        if "periods" not in state:
            state["periods"] = PG.periods(S())
        return state["periods"]

    @app.get("/api/compare")
    async def compare(cities: str = Query(..., max_length=80), metric: str = Query("pm25", pattern="^(pm25|pm10|aqi)$"),
                      start: date = Query(...), end: date = Query(...)):
        """Compare page: daily lines on matching dates, ranking with 95% ranges, trends. Read-only, no LLM."""
        cs = list(dict.fromkeys(_city(c.strip()) for c in cities.split(",") if c.strip()))
        if not 2 <= len(cs) <= 6:
            raise ValueError("Pick between 2 and 6 cities.")
        lo = date(2025, 2, 18) if metric != "aqi" else date(2024, 1, 1)
        hi = date.fromisoformat((await latest(pollutant="pm25"))["date"])
        if start > end or start < lo or end > hi or (end - start).days > 400:
            raise ValueError(f"Pick dates between {lo} and {hi}, at most 400 days apart.")
        key = (tuple(cs), metric, start, end)
        cache = state.setdefault("compare", {})
        if key not in cache:
            if len(cache) > 200:                    # bounded: shareable links make many keys possible
                cache.clear()
            cache[key] = await asyncio.to_thread(PG.compare_page, S(), cs, metric, start, end)
        return cache[key]

    @app.get("/api/diwali/{city}")
    async def diwali(city: str, years: str = Query("2024,2025", pattern=r"^\d{4}(,\d{4}){0,2}$")):
        return F.diwali_aqi(S(), _city(city), tuple(int(y) for y in years.split(","))).to_dict()

    # The answer wording the live app uses (readable dates, caveats kept in the answer) dates from this day.
    # A first-pass run that started earlier was measured with an earlier wording; the panel says so.
    ANSWER_WORDING_SINCE = "2026-11-13"

    @app.get("/api/accuracy")
    async def accuracy():
        p = ROOT / "evals" / "scoreboard.json"
        out = json.loads(p.read_text()) if p.exists() else {"sets": {}}
        out["answer_wording_since"] = ANSWER_WORDING_SINCE
        cc = ROOT / "docs" / "crosscheck_bulletins.json"
        if cc.exists():
            d = json.loads(cc.read_text())
            # agreement figures only; the internal estimates themselves are never exposed
            out["crosscheck"] = {"by_city": {
                c: {k: v.get(k) for k in ("days", "correlation", "within_20pct", "period")}
                for c, v in (d.get("by_city") or {}).items()}}
        return out

    # ------------------------------------------------------------------ chat (SSE)
    salt = uuid.uuid4().hex                     # per process: hashed IPs are never stored in clear

    def _client_ip(request: Request) -> tuple[str, str]:
        """(ip, header used). Only platform-set headers are trusted; never X-Forwarded-For or X-Visitor-Id."""
        for h in st.client_ip_headers:
            v = request.headers.get(h, "").split(",")[0].strip()
            if IPV.match(v):
                return v, h
        return (request.client.host if request.client else "unknown"), "socket"

    def _visitor(request: Request) -> str:
        ip, _ = _client_ip(request)
        return "ip:" + hashlib.sha256((salt + ip).encode()).hexdigest()[:20]

    def _final_events(final, eid: int) -> list[str]:
        f = json.loads(final.model_dump_json())
        return [sse("answer", {"status": f["status"], "text": f["answer"], "headline": f.get("headline"),
                               "explanation": f["explanation"], "method": f.get("method", ""),
                               "follow_ups": f.get("follow_ups", []),
                               "clarifying_question": f["clarifying_question"], "data_types": f["data_types"],
                               "resolved_query": f.get("resolved_query"), "required_warnings": f.get("required_warnings", []),
                               "model": f.get("model"), "verification": f["verification"]}, eid),
                sse("cards", f["cards"], eid + 1), sse("chart", f["chart"], eid + 2),
                sse("sources", {"sources": f["sources"], "coverage": f["coverage"]}, eid + 3),
                sse("warnings", f["warnings"], eid + 4)]

    def _error_code(deps) -> str:
        kinds = [e.detail.get("kind") for e in deps.events if e.type == "error"]
        k = kinds[-1] if kinds else "other"
        if k == "model":
            recent = M.FALLBACK_LOG[-len(qm.chain or [1]):]
            if recent and all(x.get("rate_limited") and not x.get("per_day") for x in recent):
                return "ai_busy"
            return "ai_limit" if recent and any(x.get("rate_limited") for x in recent) else "model_unavailable"
        return {"verification": "verification_failed", "format": "format", "limit": "too_many_steps",
                "timeout": "model_timeout"}.get(k, "internal")

    async def _replay(payload: dict, rid: str, sid: str, source: str, t0: float):
        eid = 1
        for ev in payload.get("steps", []):
            yield sse("step", {**ev, "cached": True}, eid)
            eid += 1
        yield sse("step", {"seq": eid, "type": "answer", "title": f"served from {source}", "detail": {"cached": True}}, eid)
        f = payload["final"]
        new = "method" in f                         # saved before answers were LLM-written: explanation was code text
        yield sse("answer", {"status": f["status"], "text": f["answer"], "headline": f.get("headline") or f["answer"],
                             "explanation": f.get("explanation", "") if new else "",
                             "method": f.get("method", "") if new else f.get("explanation", ""),
                             "follow_ups": f.get("follow_ups", []),
                             "clarifying_question": f.get("clarifying_question"), "data_types": f.get("data_types", []),
                             "resolved_query": f.get("resolved_query"), "required_warnings": f.get("required_warnings", []),
                             "model": f.get("model"), "verification": f.get("verification", {}), "cached": True}, eid + 1)
        yield sse("cards", f.get("cards", []), eid + 2)
        yield sse("chart", f.get("chart"), eid + 3)
        yield sse("sources", {"sources": f.get("sources", []), "coverage": f.get("coverage", {})}, eid + 4)
        yield sse("warnings", f.get("warnings", []), eid + 5)
        yield sse("done", {"request_id": rid, "session_id": sid, "status": f["status"], "cached": True,
                           "source": source, "elapsed_ms": round((time.perf_counter() - t0) * 1000)}, eid + 6)

    def _is_demo(request: Request) -> bool:
        tok = request.headers.get("X-Demo-Token", "")
        return bool(st.demo_token and tok and hmac.compare_digest(tok, st.demo_token))

    def _notice(code: str, eid: int, **extra) -> str:
        return sse("notice", {"code": code, "message": NOTICES[code], **extra}, eid)

    async def _stream(body: ChatRequest, request: Request):
        rid = request.state.request_id
        is_demo = _is_demo(request)
        t0 = time.perf_counter()
        sid, sess = state["sessions"].get(body.session_id)
        yield sse("meta", {"request_id": rid, "session_id": sid}, 0)
        first_turn = not sess.turns
        hit = (cache.get(body.message), "cache") if first_turn else (None, None)
        if first_turn and hit[0] is None and normalise(body.message) in demos:
            hit = (demos[normalise(body.message)], "demo")
        if hit[0] is not None:
            sess.context.update(hit[0].get("context", {}))
            async for chunk in _replay(hit[0], rid, sid, hit[1], t0):
                yield chunk
            return

        def fail(code: str, eid: int = 1, **extra):
            msg = MESSAGES[code]
            if code == "ai_limit" and extra.get("retry_after_s"):
                h = extra["retry_after_s"] / 3600
                msg = msg.replace("for now.", f"for now (it resets in about {h:.0f} h)." if h >= 1
                                  else f"for now (it resets in about {max(1, round(h * 60))} min).")
            if code in ("ai_limit", "ai_busy"):
                extra.setdefault("demo_questions", [x["question"] for x in demos.values()][:8])
            return [sse("error", {"code": code, "message": msg, "request_id": rid, **extra}, eid),
                    sse("done", {"request_id": rid, "session_id": sid, "status": "error", "cached": False,
                                 "elapsed_ms": round((time.perf_counter() - t0) * 1000)}, eid + 1)]

        agent = get_agent()
        if agent is None:
            for x in fail("model_unavailable"):
                yield x
            return
        plan = qm.plan(is_demo)
        if plan["state"] == "exhausted":
            # no model can take a new question: a saved answer to the same words still works on any turn
            saved = cache.get(body.message) or demos.get(normalise(body.message))
            if saved is not None:
                yield _notice("cached_fallback", 1)
                async for chunk in _replay(saved, rid, sid, "cache", t0):
                    yield chunk
                return
            for x in fail("ai_limit", 1, retry_after_s=plan["retry_after_s"]):
                yield x
            return
        notice_eid = 0
        if plan["state"] in ("low", "fallback"):
            yield _notice(plan["state"], 1, model=plan["usable"][0])
            notice_eid = 1
        queue: asyncio.Queue = asyncio.Queue()
        done_marker = object()
        task = asyncio.create_task(core.ask(agent, sess, body.message, on_event=queue.put_nowait,
                                            max_tokens=st.tokens_per_question, demo=is_demo))
        task.add_done_callback(lambda _t: queue.put_nowait(done_marker))
        loop = asyncio.get_running_loop()
        deadline = loop.time() + st.question_timeout_s
        eid, steps = 1 + notice_eid, []
        try:
            while True:
                left = deadline - loop.time()
                if left <= 0:
                    task.cancel()
                    for x in fail("timeout", eid):
                        yield x
                    return
                try:
                    item = await asyncio.wait_for(queue.get(), timeout=min(st.heartbeat_s, left))
                except asyncio.TimeoutError:
                    if await request.is_disconnected():
                        task.cancel()
                        return
                    yield PING
                    continue
                if item is done_marker:
                    break
                d = item.model_dump()
                steps.append(d)
                yield sse("step", d, eid)
                eid += 1
            final, deps = task.result()
        except asyncio.CancelledError:             # client went away
            task.cancel()
            raise
        except Exception as e:
            log.warning("chat failed %s rid=%s", type(e).__name__, rid)
            for x in fail("internal", eid):
                yield x
            return
        finally:
            if not task.done():
                task.cancel()
        if final.status == "error":
            for x in fail(_error_code(deps), eid):
                yield x
            return
        for x in _final_events(final, eid):
            yield x
        if first_turn and final.status in ("answered", "unavailable", "refused"):
            cache.put(body.message, {"final": json.loads(final.model_dump_json()), "steps": steps,
                                     "context": dict(sess.context)})
        yield sse("done", {"request_id": rid, "session_id": sid, "status": final.status, "cached": False,
                           "model": final.model, "usage": final.usage,
                           "elapsed_ms": round((time.perf_counter() - t0) * 1000)}, eid + 5)

    @app.post("/api/chat")
    async def chat(body: ChatRequest, request: Request):
        wait = limiter.check(_visitor(request))
        if wait is not None:
            return _err("rate_limited", f"Too many questions. Please wait {int(wait)} seconds.",
                        request.state.request_id, 429, {"Retry-After": str(int(wait) + 1)})
        return StreamingResponse(_stream(body, request), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no",
                                          "X-Request-ID": request.state.request_id})

    return app


app = create_app()
