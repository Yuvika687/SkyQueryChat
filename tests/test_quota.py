"""Shared AI quota tests. Fake clock and fake sleep: no waiting, no live quota."""
import asyncio
import json
from datetime import datetime

import pytest
from pydantic_ai.messages import ModelRequest, ModelResponse, TextPart, UserPromptPart
from pydantic_ai.models.function import FunctionModel

from backend.agent import models as M
from backend.agent.quota import (PT, LimitedModel, ProviderLimit, QuotaConfig, QuotaExceeded, QuotaManager,
                                 question_scope)

NOON_PT = datetime(2026, 11, 6, 12, 0, tzinfo=PT).timestamp()


class Clock:
    def __init__(self, t=NOON_PT):
        self.t, self.slept = t, []

    def __call__(self):
        return self.t

    async def sleep(self, s):
        self.slept.append(s)
        self.t += s
        await asyncio.sleep(0)


def pq(clock, margin=1.0, reserve=0.0, **lim):
    base = dict(rpm=100, tpm=10**7, rpd=1000, daily_token_budget=10**9)
    base.update(lim)
    qm = QuotaManager({"m": ProviderLimit("m", **base)},
                      QuotaConfig(safety_margin=margin, demo_reserve=reserve, max_queue_wait_s=120,
                                  question_requests=4, question_tokens=12_000),
                      clock=clock, sleep=clock.sleep)
    return qm.get("m")


def run(coro):
    return asyncio.run(coro)


def test_config_has_owner_gemini_limits_with_margin_and_reserve():
    qm = QuotaManager.from_config(M.load_config())
    g = qm.get("google:gemini-3.5-flash-lite")
    assert (g.limit.rpm, g.limit.tpm, g.limit.rpd) == (15, 250_000, 500)
    assert g.limit.day_reset == "midnight_pt" and "AI Studio" in g.limit.source
    assert g.caps() == {"rpm": 12, "tpm": 200_000, "rpd": 340, "tokens_day": 680_000}     # 80%, then 15% reserve
    assert g.caps(demo=True)["rpd"] == 400
    groq = qm.get("groq:openai/gpt-oss-120b")
    assert groq.limit.day_reset == "rolling_24h" and groq.caps(demo=True)["tokens_day"] == 160_000
    # separate daily budgets per provider, not one fixed number
    assert {qm.get(k).limit.daily_token_budget for k in qm.models} != {150_000}
    assert len({qm.get(k).caps()["tokens_day"] for k in qm.models}) > 1


def test_env_override_merges_per_model(monkeypatch):
    monkeypatch.setenv("SKYQ_PROVIDER_LIMITS", json.dumps({"google:gemini-3.5-flash-lite": {"rpd": 1000}}))
    monkeypatch.setenv("SKYQ_DEMO_RESERVE", "0.25")
    g = QuotaManager.from_config(M.load_config()).get("google:gemini-3.5-flash-lite")
    assert g.limit.rpd == 1000 and g.limit.rpm == 15 and g.caps()["rpd"] == 600


def test_unknown_model_gets_conservative_default():
    qm = QuotaManager.from_config(M.load_config())
    d = qm.get("google:some-new-model")
    assert d.limit.rpd <= 20 and "default" in d.limit.source


def test_rpm_waits_in_queue_then_proceeds():
    c = Clock()
    q = pq(c, rpm=2)

    async def go():
        for _ in range(3):
            await q.acquire(100)
    run(go())
    assert len(q.events) == 3 and sum(c.slept) == pytest.approx(60, abs=1.1)


def test_queue_is_fifo_across_visitors():
    c = Clock()
    q = pq(c, rpm=1)
    order = []

    async def visitor(name, delay):
        await asyncio.sleep(delay)
        await q.acquire(100)
        order.append(name)

    async def go():
        await asyncio.gather(visitor("a", 0), visitor("b", 0.001), visitor("c", 0.002))
    run(go())
    assert order == ["a", "b", "c"]
    ts = [e[0] for e in q.events]
    assert ts[1] - ts[0] >= 60 and ts[2] - ts[1] >= 60          # one per minute, shared


def test_tpm_wait_and_oversized_request():
    c = Clock()
    q = pq(c, tpm=10_000)

    async def go():
        await q.acquire(6_000)
        await q.acquire(6_000)                                   # must wait for the first to age out
    run(go())
    assert sum(c.slept) >= 59
    with pytest.raises(QuotaExceeded):
        run(q.acquire(20_000))


def test_minute_wait_longer_than_queue_limit_gives_up():
    c = Clock()
    q = pq(c, rpm=1)
    q.cfg.max_queue_wait_s = 5
    run(q.acquire(10))
    with pytest.raises(QuotaExceeded) as e:
        run(q.acquire(10))
    assert e.value.scope == "minute" and e.value.retry_after > 5


def test_daily_requests_reserve_room_for_a_whole_question():
    c = Clock()
    q = pq(c, rpd=6)

    async def go():
        await q.acquire(10, new_question=True)                   # 0 + 4 <= 6
        await q.acquire(10)                                       # same question: 1 request
        await q.acquire(10)
    run(go())
    assert q.can_start_question() == "daily request limit"       # 3 + 4 > 6
    run(q.acquire(10))                                            # a running question may still finish
    with pytest.raises(QuotaExceeded) as e:
        run(q.acquire(10, new_question=True))
    assert e.value.scope == "day" and e.value.retry_after > 0


def test_daily_token_budget_counts_actual_usage():
    c = Clock()
    q = pq(c, daily_token_budget=20_000)
    ev = run(q.acquire(9_000, new_question=True))
    q.settle(ev, 3_000)                                           # provider said 3,000, not the estimate
    assert q.status()["used_today"]["tokens"] == 3_000
    run(q.acquire(5_000, new_question=True))                      # 3,000 + 12,000 <= 20,000
    assert q.can_start_question() is None                         # 8,000 + 12,000 = 20,000: still fits
    q.events[-1][1] += 1                                          # one more token tips it over
    assert q.can_start_question() == "daily token budget"


def test_demo_reserve_only_for_demo():
    c = Clock()
    q = pq(c, rpd=10, reserve=0.5)
    run(q.acquire(10, new_question=True))
    run(q.acquire(10))
    assert q.can_start_question() and q.can_start_question(demo=True) is None


def test_gemini_day_resets_at_midnight_pacific():
    c = Clock(datetime(2026, 11, 6, 23, 59, tzinfo=PT).timestamp())
    q = pq(c, rpd=4)
    run(q.acquire(10, new_question=True))
    assert q.can_start_question()
    assert q.next_reset() == pytest.approx(60, abs=1)
    c.t += 120                                                    # 00:01 PT next day
    assert q.can_start_question() is None


def test_groq_day_is_rolling_24h():
    c = Clock(datetime(2026, 11, 6, 23, 59, tzinfo=PT).timestamp())
    q = pq(c, rpd=4, day_reset="rolling_24h")
    run(q.acquire(10, new_question=True))
    c.t += 120
    assert q.can_start_question()                                 # midnight does not reset Groq
    c.t += 86_400
    assert q.can_start_question() is None


def test_provider_429s_mark_the_model():
    c = Clock()
    q = pq(c)
    q.on_provider_error(per_day=False, rate_limited=True)
    assert q.paused_until == c.t + 60
    q.on_provider_error(per_day=True, rate_limited=True)
    assert q.can_start_question() == "provider daily limit reached" and q.status()["state"] == "exhausted"


def test_status_states_and_plan():
    c = Clock()
    qm = QuotaManager({"a": ProviderLimit("a", rpd=10), "b": ProviderLimit("b", rpd=100)},
                      QuotaConfig(safety_margin=1.0, demo_reserve=0.0, low_fraction=0.5), clock=c, sleep=c.sleep)
    qm.set_chain(["a", "b"])
    assert qm.plan()["state"] == "ok"
    for _ in range(5):
        run(qm.get("a").acquire(10))
    assert qm.get("a").status()["state"] == "ok"                  # 5/10 left = 50%, not below
    run(qm.get("a").acquire(10))
    assert qm.get("a").status()["state"] == "low" and qm.plan()["state"] == "low"
    for _ in range(2):
        run(qm.get("a").acquire(10))
    p = qm.plan()
    assert p["state"] == "fallback" and p["usable"] == ["b"] and "a" in p["blocked"]
    qm.get("b").on_provider_error(per_day=True, rate_limited=True)
    p = qm.plan()
    assert p["state"] == "exhausted" and p["retry_after_s"] > 0


def test_limited_model_skips_to_backup_without_calling_primary():
    c = Clock()
    qm = QuotaManager({"p": ProviderLimit("p", rpd=3), "b": ProviderLimit("b", rpd=100)},
                      QuotaConfig(safety_margin=1.0, demo_reserve=0.0), clock=c, sleep=c.sleep)
    calls = []

    def fn(name):
        def f(messages, info):
            calls.append(name)
            return ModelResponse(parts=[TextPart("ok")])
        return FunctionModel(f, model_name=name)
    model = M.limited_chain([("p", fn("p")), ("b", fn("b"))], qm)
    msgs = [ModelRequest(parts=[UserPromptPart("hi")])]
    from pydantic_ai.models import ModelRequestParameters

    async def go():
        with question_scope():
            return await model.request(msgs, None, ModelRequestParameters())
    run(go())
    assert calls == ["b"]                                          # 0 + 4 > 3 for p: never called
    assert M.FALLBACK_LOG[-1]["local_limit"] and M.FALLBACK_LOG[-1]["per_day"]
    assert qm.get("b").status()["used_today"]["requests"] == 1


def test_estimate_is_an_upper_bound_of_small_prompts():
    from pydantic_ai.models import ModelRequestParameters
    from backend.agent.quota import estimate_tokens
    msgs = [ModelRequest(parts=[UserPromptPart("What was Delhi PM2.5 in November 2025?")])]
    est = estimate_tokens(msgs, ModelRequestParameters(), {"max_tokens": 1500}, QuotaConfig())
    assert 20 < est < 2_000


def test_chain_order_and_gemini_limits_from_ai_studio(monkeypatch):
    monkeypatch.delenv("SKYQ_MODEL_CHAIN", raising=False)
    assert [e.label for e in M.model_chain()] == ["google:gemini-3.5-flash-lite", "google:gemini-3.1-flash-lite",
                                                  "google:gemini-3.8-flash"]       # Groq disabled 2026-11-08
    qm = QuotaManager.from_config(M.load_config())
    for key, lim in {"google:gemini-3.1-flash-lite": (15, 250_000, 500),
                     "google:gemini-3.8-flash": (5, 250_000, 20)}.items():
        L = qm.get(key).limit
        assert (L.rpm, L.tpm, L.rpd) == lim and "AI Studio" in L.source and "28-day" in L.source


def test_gemini_429_text_is_classified_per_minute_or_per_day():
    from pydantic_ai.exceptions import ModelHTTPError
    qm = QuotaManager.from_config(M.load_config())
    qm.set_chain(["google:gemini-3.1-flash-lite"])
    minute = ("Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, "
              "limit: 15, model: gemini-3.1-flash-lite, description: Generate content requests per minute limit "
              "exceeded on Free Tier.")
    M._record_fallback(ModelHTTPError(429, "gemini-3.1-flash-lite", minute), qm)
    assert M.FALLBACK_LOG[-1]["rate_limited"] and not M.FALLBACK_LOG[-1]["per_day"]
    pq = qm.get("google:gemini-3.1-flash-lite")
    assert pq.paused_until > 0 and pq.can_start_question() is None
    M._record_fallback(ModelHTTPError(429, "gemini-3.1-flash-lite", minute.replace("per minute", "per day")), qm)
    assert M.FALLBACK_LOG[-1]["per_day"] and pq.can_start_question() == "provider daily limit reached"
    assert qm.get("google:gemini-3.5-flash-lite").can_start_question() is None      # other model unaffected


# ---------------------------------------------------------------- Gemini-only chain, timeouts and token cap (2026-11-08)
def test_disabled_groq_is_never_listed_as_a_fallback(monkeypatch):
    monkeypatch.delenv("SKYQ_MODEL_CHAIN", raising=False)
    qm = QuotaManager.from_config(M.load_config(), configured=M.live_labels())
    shown = list(qm.status()["models"])                              # before the agent is built
    assert shown == ["google:gemini-3.5-flash-lite", "google:gemini-3.1-flash-lite", "google:gemini-3.8-flash"]
    assert qm.get("groq:openai/gpt-oss-120b").limit.rpm == 30       # its limits stay configured for testing
    assert not any("groq" in k for k in M.QUOTA.status()["models"])


def test_one_token_cap_for_run_limit_and_reservation(monkeypatch):
    from backend.api.settings import Settings, question_token_cap
    cfg = M.load_config()
    cap = cfg["limits"]["max_tokens_per_question"]
    assert cap == 12_000 and "question_tokens" not in cfg["quota"]
    assert QuotaManager.from_config(cfg).cfg.question_tokens == cap == question_token_cap()
    monkeypatch.delenv("TOKENS_PER_QUESTION", raising=False)
    assert Settings().tokens_per_question == cap
    monkeypatch.setenv("TOKENS_PER_QUESTION", "8000")                # env may lower the cap
    assert Settings().tokens_per_question == 8000
    monkeypatch.setenv("TOKENS_PER_QUESTION", "16000")               # but never raise it above the reservation
    assert Settings().tokens_per_question == cap


def test_measured_questions_fit_under_the_token_cap():
    stats = json.load(open(M.CONFIG.parents[2] / "evals" / "request_stats.json"))["runs"]
    current = {k: v for k, v in stats.items() if "day2" not in k}   # legacy runs (IDs end in day2) used older code
    assert current and max(v["tokens_per_question_max"] for v in current.values()) < M.load_config()["limits"]["max_tokens_per_question"]


def _slow_then_fast(calls, delay):
    async def slow(messages, info):
        calls.append("slow")
        await asyncio.sleep(delay)
        return ModelResponse(parts=[TextPart("late")])

    def fast(messages, info):
        calls.append("fast")
        return ModelResponse(parts=[TextPart("ok")])
    return FunctionModel(slow, model_name="slow"), FunctionModel(fast, model_name="fast")


def test_slow_model_request_times_out_and_falls_back():
    from pydantic_ai.models import ModelRequestParameters
    qm = QuotaManager({"s": ProviderLimit("s", rpd=100), "f": ProviderLimit("f", rpd=100)},
                      QuotaConfig(safety_margin=1.0, demo_reserve=0.0))
    calls = []
    slow, fast = _slow_then_fast(calls, delay=5)
    model = M.limited_chain([("s", slow), ("f", fast)], qm, timeout_s=0.2)
    msgs = [ModelRequest(parts=[UserPromptPart("hi")])]

    async def go():
        with question_scope():
            return await model.request(msgs, None, ModelRequestParameters())
    resp = run(go())
    assert calls == ["slow", "fast"] and resp.parts[0].content == "ok"
    assert M.FALLBACK_LOG[-1]["timeout"] and not M.FALLBACK_LOG[-1]["rate_limited"]


def test_live_chain_uses_configured_request_timeout():
    model = M.limited_chain([("x", FunctionModel(lambda m, i: ModelResponse(parts=[TextPart("ok")])))],
                            QuotaManager({}, QuotaConfig()))
    assert model.models[0].timeout_s == M.load_config()["limits"]["model_request_timeout_s"] == 20


def test_production_ignores_raised_rate_limits(monkeypatch):
    from backend.api.settings import PROD_RATE_PER_DAY, PROD_RATE_PER_MINUTE, Settings
    for k in ("RENDER", "SKYQ_ENV"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.delenv("RATE_PER_MINUTE", raising=False)
    monkeypatch.delenv("RATE_PER_DAY", raising=False)
    assert (Settings().rate_per_minute, Settings().rate_per_day) == (PROD_RATE_PER_MINUTE, PROD_RATE_PER_DAY) == (4, 30)
    monkeypatch.setenv("RATE_PER_MINUTE", "60")                      # the Playwright test values
    monkeypatch.setenv("RATE_PER_DAY", "1000")
    assert (Settings().rate_per_minute, Settings().rate_per_day) == (60, 1000)     # allowed locally
    monkeypatch.setenv("RENDER", "true")                             # Render sets this on every service
    assert (Settings().rate_per_minute, Settings().rate_per_day) == (4, 30)
    monkeypatch.delenv("RENDER")
    monkeypatch.setenv("SKYQ_ENV", "production")
    assert (Settings(rate_per_minute=60).rate_per_minute) == 4
    monkeypatch.setenv("RATE_PER_MINUTE", "2")                       # lowering stays possible
    assert Settings().rate_per_minute == 2


def test_production_ignores_testing_overrides_and_uses_the_gemini_chain(monkeypatch):
    for k in ("RENDER", "SKYQ_ENV"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("SKYQ_MODEL_CHAIN", "groq:openai/gpt-oss-120b")
    monkeypatch.setenv("SKYQ_PROVIDER_LIMITS", '{"google:gemini-3.5-flash-lite": {"rpd": 99999}}')
    monkeypatch.setenv("SKYQ_DEMO_RESERVE", "0")
    assert [e.label for e in M.model_chain()] == ["groq:openai/gpt-oss-120b"]          # applied locally
    assert QuotaManager.from_config(M.load_config()).cfg.demo_reserve == 0
    cfg = M.load_config()
    cfg["chain"][-1]["enabled"] = True                                                  # even if Groq were re-enabled
    monkeypatch.setenv("RENDER", "true")
    assert [e.label for e in M.model_chain(cfg)] == [
        "google:gemini-3.5-flash-lite", "google:gemini-3.1-flash-lite", "google:gemini-3.8-flash"]
    q = QuotaManager.from_config(M.load_config())
    assert q.cfg.demo_reserve == 0.15 and q.models["google:gemini-3.5-flash-lite"].limit.rpd == 500


def test_production_allowed_origins_come_only_from_the_environment(monkeypatch):
    from backend.api.settings import Settings
    for k in ("RENDER", "SKYQ_ENV", "ALLOWED_ORIGINS"):
        monkeypatch.delenv(k, raising=False)
    assert Settings().allowed_origins == ["http://localhost:3000"]                       # local default
    monkeypatch.setenv("RENDER", "true")
    assert Settings().allowed_origins == []                                             # no localhost in production
    monkeypatch.setenv("ALLOWED_ORIGINS", "https://skyquerychat.vercel.app/, *, http://localhost:3000")
    assert Settings().allowed_origins == ["https://skyquerychat.vercel.app"]
