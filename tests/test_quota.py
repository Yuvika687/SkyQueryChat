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
