"""Shared AI quota across all visitors: per-model RPM, TPM, RPD and a daily token budget.

Limits live in backend/config/models.json ("quota"), overridable with env SKYQ_PROVIDER_LIMITS (JSON
object merged per model), SKYQ_QUOTA_SAFETY_MARGIN and SKYQ_DEMO_RESERVE.

How it works
- Every model in the chain is wrapped in LimitedModel. Before each provider request it asks the
  model's ProviderQuota for a slot. Slots are counted for all visitors together (one process).
- Effective caps = provider limit x safety margin. Daily caps keep a reserve for the demo: public
  visitors stop at (1 - demo_reserve); requests marked demo may use the reserve.
- Minute limits (RPM, TPM): wait in a shared FIFO queue up to max_queue_wait_s, else give up.
- Daily limits (RPD, daily tokens): the first request of a question needs room for a whole question
  (question_reserve); later requests need room for one request.
- Giving up raises QuotaExceeded (a ModelAPIError), so FallbackModel moves to the next model.
- A real provider 429 also marks the model: per-day -> exhausted until reset; per-minute -> 60 s pause.
Counters are in memory: a restart resets them (see known limits).
"""
from __future__ import annotations

import asyncio
import contextvars
import itertools
import json
import math
import os
import time
from collections import deque
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Callable

from pydantic_ai.exceptions import ModelAPIError

from backend.runtime import override

try:
    from zoneinfo import ZoneInfo
    PT = ZoneInfo("America/Los_Angeles")
except Exception:                                   # no tz database: UTC-8 resets an hour late (safe side)
    PT = timezone(timedelta(hours=-8))

DAY = 86_400.0


class QuotaExceeded(ModelAPIError):
    """Raised before calling a provider when our shared limiter has no room. Never reaches users raw."""

    def __init__(self, model_name: str, reason: str, retry_after: float | None = None, scope: str = "day"):
        super().__init__(model_name, f"local quota: {reason}", retry_after=retry_after)
        self.reason, self.scope = reason, scope


class ModelTimeout(ModelAPIError):
    """One model request took longer than limits.model_request_timeout_s. FallbackModel moves to the next
    model; if every model times out the user sees a clear timeout message."""

    def __init__(self, model_name: str, timeout_s: float):
        super().__init__(model_name, f"model request timed out after {timeout_s:g} s")
        self.timeout_s = timeout_s


@dataclass
class ProviderLimit:
    key: str                                   # "google:gemini-3.5-flash-lite"
    rpm: int | None = None
    tpm: int | None = None
    rpd: int | None = None
    tpd: int | None = None                     # provider's own daily token limit, if it has one
    daily_token_budget: int | None = None      # our budget for this model
    day_reset: str = "midnight_pt"             # or "rolling_24h"
    source: str = ""


@dataclass
class QuotaConfig:
    safety_margin: float = 0.8
    demo_reserve: float = 0.15
    low_fraction: float = 0.2                  # "low" when public headroom < 20% of the public cap
    max_queue_wait_s: float = 20.0
    question_requests: int = 4                 # room needed to start a question (measured max = 4)
    question_tokens: int = 12_000              # = limits.max_tokens_per_question (one cap; set in from_config)
    est_output_tokens: int = 600
    chars_per_token: float = 7.0               # calibrated live 2026-11-06: JSON chars/4 overestimated ~2x


@dataclass
class _Ctx:
    demo: bool = False
    started: set = field(default_factory=set)
    on_wait: Callable[[str, float], None] | None = None
    skipped: list = field(default_factory=list)     # (model key, reason) skipped by the shared limiter
    reported: int = 0


_CTX: contextvars.ContextVar[_Ctx | None] = contextvars.ContextVar("skyq_quota_ctx", default=None)


def current() -> _Ctx | None:
    return _CTX.get()


@contextmanager
def question_scope(demo: bool = False, on_wait: Callable[[str, float], None] | None = None):
    """Marks one question (so its first request reserves room for the whole question)."""
    tok = _CTX.set(_Ctx(demo=demo, on_wait=on_wait))
    try:
        yield
    finally:
        _CTX.reset(tok)


class ProviderQuota:
    def __init__(self, limit: ProviderLimit, cfg: QuotaConfig, clock=time.time, sleep=asyncio.sleep):
        self.limit, self.cfg, self.clock, self.sleep = limit, cfg, clock, sleep
        self.events: deque[list] = deque()           # [t, tokens, estimate]
        self.queue: deque[int] = deque()
        self.tickets = itertools.count()
        self.exhausted_until = 0.0                    # provider said per-day 429
        self.paused_until = 0.0                       # provider said per-minute 429
        self.provider_429s = 0
        self.settled: list[tuple[int, int]] = []     # (estimate, actual) for recent requests

    # ------------------------------------------------------------------ caps
    def _cap(self, v: int | None) -> int | None:
        return None if v is None else max(1, math.floor(v * self.cfg.safety_margin))

    def caps(self, demo: bool = False) -> dict:
        L, keep = self.limit, 1.0 if demo else 1.0 - self.cfg.demo_reserve
        tok_day = [x for x in (L.daily_token_budget, self._cap(L.tpd)) if x is not None]
        rpd = self._cap(L.rpd)
        tday = min(tok_day) if tok_day else None
        return {"rpm": self._cap(L.rpm), "tpm": self._cap(L.tpm),
                "rpd": None if rpd is None else math.floor(rpd * keep),
                "tokens_day": None if tday is None else math.floor(tday * keep)}

    # ------------------------------------------------------------------ windows
    def _day_start(self, now: float) -> float:
        if self.limit.day_reset == "rolling_24h":
            return now - DAY
        d = datetime.fromtimestamp(now, PT)
        return d.replace(hour=0, minute=0, second=0, microsecond=0).timestamp()

    def next_reset(self, now: float | None = None) -> float:
        """Seconds until daily room comes back."""
        now = self.clock() if now is None else now
        if self.limit.day_reset == "rolling_24h":
            first = next((e[0] for e in self.events if e[0] > now - DAY), None)
            return max(1.0, (first + DAY - now) if first else 1.0)
        d = datetime.fromtimestamp(now, PT)
        nxt = (d.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1)).timestamp()
        return max(1.0, nxt - now)

    def _usage(self, now: float) -> dict:
        while self.events and self.events[0][0] <= now - DAY - 3600:
            self.events.popleft()
        ds, ms = self._day_start(now), now - 60
        day = [e for e in self.events if e[0] > ds]
        minute = [e for e in day if e[0] > ms] if ds < ms else [e for e in self.events if e[0] > ms]
        return {"req_day": len(day), "tok_day": sum(e[1] for e in day),
                "req_min": len(minute), "tok_min": sum(e[1] for e in minute), "minute": minute}

    def seed(self, requests: int, tokens: int, now: float | None = None) -> None:
        """Count use made elsewhere today (other processes, the live server) as if it happened at the start of the
        quota day: it counts toward the daily caps but not toward the per-minute window."""
        if requests <= 0 and tokens <= 0:
            return
        now = self.clock() if now is None else now
        t = self._day_start(now) + 1
        if t > now - 61:                       # first minute of the day: keep it inside the day
            t = max(self._day_start(now) + 0.001, now - 61)
        ev = [[t, tokens if i == 0 else 0, 0] for i in range(max(1, requests))]
        self.events = deque(sorted([*ev, *self.events], key=lambda e: e[0]))

    # ------------------------------------------------------------------ admission
    def _day_ok(self, u: dict, caps: dict, need_req: int, need_tok: int) -> str | None:
        if self.clock() < self.exhausted_until:
            return "provider daily limit reached"
        if caps["rpd"] is not None and u["req_day"] + need_req > caps["rpd"]:
            return "daily request limit"
        if caps["tokens_day"] is not None and u["tok_day"] + need_tok > caps["tokens_day"]:
            return "daily token budget"
        return None

    def _minute_wait(self, u: dict, caps: dict, est: int, now: float) -> float:
        wait = max(0.0, self.paused_until - now)
        mins = sorted(u["minute"], key=lambda e: e[0])
        if caps["rpm"] is not None and u["req_min"] + 1 > caps["rpm"]:
            k = u["req_min"] + 1 - caps["rpm"]                  # oldest k must expire
            wait = max(wait, mins[k - 1][0] + 60 - now)
        if caps["tpm"] is not None and u["tok_min"] + est > caps["tpm"]:
            excess, acc = u["tok_min"] + est - caps["tpm"], 0
            for t, tok, *_ in mins:
                acc += tok
                if acc >= excess:
                    wait = max(wait, t + 60 - now)
                    break
        return wait

    def can_start_question(self, demo: bool = False) -> str | None:
        """None if a new question fits today's room; else the reason."""
        now = self.clock()
        return self._day_ok(self._usage(now), self.caps(demo), self.cfg.question_requests, self.cfg.question_tokens)

    async def acquire(self, est_tokens: int, demo: bool = False, new_question: bool = False,
                      on_wait: Callable[[str, float], None] | None = None) -> list:
        caps = self.caps(demo)
        name = self.limit.key
        if caps["tpm"] is not None and est_tokens > caps["tpm"]:
            raise QuotaExceeded(name, "request larger than the per-minute token limit", scope="minute")
        need_req = self.cfg.question_requests if new_question else 1
        need_tok = max(est_tokens, self.cfg.question_tokens) if new_question else est_tokens
        ticket = next(self.tickets)
        self.queue.append(ticket)
        deadline = self.clock() + self.cfg.max_queue_wait_s
        told = False
        try:
            while True:
                now = self.clock()
                u = self._usage(now)
                why = self._day_ok(u, caps, need_req, need_tok)
                if why:
                    raise QuotaExceeded(name, why, retry_after=self.next_reset(now), scope="day")
                wait = self._minute_wait(u, caps, est_tokens, now) if self.queue[0] == ticket else 0.25
                if self.queue[0] == ticket and wait <= 0:
                    ev = [now, int(est_tokens), int(est_tokens)]      # [time, tokens counted, estimate]
                    self.events.append(ev)
                    return ev
                if now + wait > deadline:
                    raise QuotaExceeded(name, "per-minute limit busy", retry_after=round(wait, 1), scope="minute")
                if on_wait and not told and self.queue[0] == ticket and wait > 1:
                    on_wait(name, wait)
                    told = True
                await self.sleep(min(wait, 1.0))
        finally:
            try:
                self.queue.remove(ticket)
            except ValueError:
                pass

    def settle(self, ev: list, actual_tokens: int | None):
        if actual_tokens:
            ev[1] = int(actual_tokens)
            self.settled.append((ev[2], ev[1]))
            del self.settled[:-200]

    def on_provider_error(self, per_day: bool, rate_limited: bool):
        now = self.clock()
        if per_day:
            self.exhausted_until = now + self.next_reset(now)
        elif rate_limited:
            self.paused_until = now + 60
        if per_day or rate_limited:
            self.provider_429s += 1

    # ------------------------------------------------------------------ reporting
    def status(self, demo: bool = False) -> dict:
        now = self.clock()
        u, caps = self._usage(now), self.caps(demo)
        rem_req = None if caps["rpd"] is None else max(0, caps["rpd"] - u["req_day"])
        rem_tok = None if caps["tokens_day"] is None else max(0, caps["tokens_day"] - u["tok_day"])
        fracs = [r / c for r, c in ((rem_req, caps["rpd"]), (rem_tok, caps["tokens_day"])) if c]
        if self.can_start_question(demo):
            state = "exhausted"
        elif fracs and min(fracs) < self.cfg.low_fraction:
            state = "low"
        else:
            state = "ok"
        return {"model": self.limit.key, "state": state,
                "used_today": {"requests": u["req_day"], "tokens": u["tok_day"]},
                "remaining_today": {"requests": rem_req, "tokens": rem_tok},
                "last_minute": {"requests": u["req_min"], "tokens": u["tok_min"]},
                "caps": caps, "provider_limits": {k: getattr(self.limit, k) for k in ("rpm", "tpm", "rpd", "tpd")},
                "daily_token_budget": self.limit.daily_token_budget, "day_reset": self.limit.day_reset,
                "estimate_vs_actual": round(sum(e for e, _ in self.settled) / max(1, sum(a for _, a in self.settled)), 2)
                if self.settled else None,
                "resets_in_s": round(self.next_reset(now)), "queued": len(self.queue), "source": self.limit.source}


class QuotaManager:
    def __init__(self, limits: dict[str, ProviderLimit], cfg: QuotaConfig, default: ProviderLimit | None = None,
                 clock=time.time, sleep=asyncio.sleep, configured: list[str] | None = None):
        self.cfg, self.clock, self.sleep = cfg, clock, sleep
        self.default = default
        self.models: dict[str, ProviderQuota] = {k: ProviderQuota(v, cfg, clock, sleep) for k, v in limits.items()}
        self.chain: list[str] = []
        # Live (enabled) models in order, shown before the chain is built. Disabled models keep their limits
        # in self.models for testing but are never listed.
        self.configured: list[str] = list(configured) if configured is not None else list(limits)

    @classmethod
    def from_config(cls, cfg: dict, **kw) -> "QuotaManager":
        q = dict(cfg.get("quota", {}))
        provs = {k: dict(v) for k, v in q.get("providers", {}).items()}
        env = override("SKYQ_PROVIDER_LIMITS")      # testing only; ignored in production
        if env:
            for k, v in json.loads(env).items():
                provs.setdefault(k, {}).update(v)
        qc = QuotaConfig(**{k: q[k] for k in QuotaConfig.__dataclass_fields__ if k in q})
        cap = cfg.get("limits", {}).get("max_tokens_per_question")
        if cap and "question_tokens" not in q:     # one per-question token cap for the run limit and the reservation
            qc.question_tokens = int(cap)
        for name, attr in (("SKYQ_QUOTA_SAFETY_MARGIN", "safety_margin"), ("SKYQ_DEMO_RESERVE", "demo_reserve")):
            if override(name):
                setattr(qc, attr, float(override(name)))
        fields = ProviderLimit.__dataclass_fields__
        limits = {k: ProviderLimit(key=k, **{a: b for a, b in v.items() if a in fields and a != "key"}) for k, v in provs.items()}
        d = q.get("default")
        default = ProviderLimit(key="default", **{a: b for a, b in d.items() if a in fields}) if d else None
        return cls(limits, qc, default, **kw)

    def get(self, key: str) -> ProviderQuota:
        if key not in self.models:
            base = self.default or ProviderLimit(key=key, rpm=5, tpm=50_000, rpd=20, daily_token_budget=50_000,
                                                source="built-in conservative default")
            lim = ProviderLimit(**{**base.__dict__, "key": key, "source": base.source or "default limits (not checked)"})
            self.models[key] = ProviderQuota(lim, self.cfg, self.clock, self.sleep)
        return self.models[key]

    def by_model_name(self, name: str | None) -> ProviderQuota | None:
        for k in self.chain or list(self.models):
            if name and k.split(":", 1)[-1] == name:
                return self.get(k)
        return None

    def set_chain(self, keys: list[str]):
        self.chain = list(keys)
        for k in keys:
            self.get(k)

    def plan(self, demo: bool = False) -> dict:
        """Which chain models can take a new question now, and the overall state for the visitor."""
        if not self.chain:                               # chain not built through limited_chain: no data
            return {"state": "ok", "usable": [], "blocked": {}, "retry_after_s": None}
        usable, blocked = [], {}
        for k in self.chain:
            why = self.get(k).can_start_question(demo)
            (blocked.__setitem__(k, why) if why else usable.append(k))
        states = [self.get(k).status(demo)["state"] for k in usable]
        if not usable:
            state = "exhausted"
        elif usable[0] != (self.chain[0] if self.chain else None):
            state = "fallback"
        elif "low" in states[:1]:
            state = "low"
        else:
            state = "ok"
        retry = min((self.get(k).next_reset() for k in blocked), default=None) if not usable else None
        return {"state": state, "usable": usable, "blocked": blocked,
                "retry_after_s": None if retry is None else round(retry)}

    def status(self) -> dict:
        return {"chain": self.chain, "safety_margin": self.cfg.safety_margin, "demo_reserve": self.cfg.demo_reserve,
                "models": {k: self.get(k).status() for k in (self.chain or self.configured)}}


# ---------------------------------------------------------------------- model wrapper
def estimate_tokens(messages, params, settings, cfg: QuotaConfig) -> int:
    """Rough estimate of tokens for one request (serialised JSON size / chars_per_token + output allowance).
    The record is corrected with the provider's real usage after the response."""
    from pydantic_ai.messages import ModelMessagesTypeAdapter
    try:
        chars = len(ModelMessagesTypeAdapter.dump_json(messages))
    except Exception:
        chars = sum(len(str(m)) for m in messages)
    for t in getattr(params, "function_tools", []) + getattr(params, "output_tools", []):
        chars += len(t.name) + len(t.description or "") + len(json.dumps(t.parameters_json_schema))
    out = (settings or {}).get("max_tokens") if isinstance(settings, dict) else None
    return int(chars / cfg.chars_per_token) + min(int(out or cfg.est_output_tokens), cfg.est_output_tokens * 2)


def _wrapper_base():
    from pydantic_ai.models.wrapper import WrapperModel
    return WrapperModel


class LimitedModel(_wrapper_base()):
    """Asks the shared quota for a slot before every provider request."""

    def __init__(self, wrapped, quota_key: str, quota: QuotaManager, timeout_s: float | None = None):
        super().__init__(wrapped)
        self.quota_key, self.quota, self.timeout_s = quota_key, quota, timeout_s

    async def request(self, messages, model_settings, model_request_parameters):
        ctx = _CTX.get()
        pq = self.quota.get(self.quota_key)
        new_q = ctx is not None and self.quota_key not in ctx.started
        est = estimate_tokens(messages, model_request_parameters, model_settings, self.quota.cfg)
        try:
            ev = await pq.acquire(est, demo=bool(ctx and ctx.demo), new_question=new_q,
                                  on_wait=ctx.on_wait if ctx else None)
        except QuotaExceeded as e:
            if ctx is not None:
                ctx.skipped.append((self.quota_key, e.reason))
            raise
        if ctx is not None:
            ctx.started.add(self.quota_key)
        # The timeout covers only the provider call (not the queue wait above). The slot stays counted at
        # its estimate, because a timed-out request may still have used provider quota.
        try:
            resp = await asyncio.wait_for(self.wrapped.request(messages, model_settings, model_request_parameters),
                                          timeout=self.timeout_s)
        except asyncio.TimeoutError:
            raise ModelTimeout(self.quota_key.split(":", 1)[-1], self.timeout_s) from None
        u = getattr(resp, "usage", None)
        pq.settle(ev, (getattr(u, "input_tokens", 0) or 0) + (getattr(u, "output_tokens", 0) or 0) if u else None)
        return resp
