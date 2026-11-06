"""Public-demo protection: per-visitor rate limits, an answer cache and cached demo answers.
Shared per-provider AI quotas (RPM, TPM, RPD, daily tokens) live in backend/agent/quota.py. In-memory (Render free instances restart; that resets counters, which only
makes the limits stricter for one day)."""
from __future__ import annotations

import json
import re
import time
from collections import OrderedDict, deque
from datetime import timedelta, timezone
from pathlib import Path

IST = timezone(timedelta(hours=5, minutes=30))
DEMO_FILE = Path(__file__).resolve().parents[2] / "data" / "app" / "demo_answers.json"


class RateLimiter:
    def __init__(self, per_minute: int, per_day: int, clock=time.monotonic):
        self.per_minute, self.per_day, self.clock = per_minute, per_day, clock
        self.hits: dict[str, deque] = {}

    def check(self, visitor: str) -> float | None:
        """None if allowed (and recorded); otherwise seconds to wait."""
        now = self.clock()
        q = self.hits.setdefault(visitor, deque())
        while q and now - q[0] > 86_400:
            q.popleft()
        last_min = [t for t in q if now - t < 60]
        if len(last_min) >= self.per_minute:
            return round(60 - (now - last_min[0]) + 0.5, 1)
        if len(q) >= self.per_day:
            return round(86_400 - (now - q[0]) + 0.5, 1)
        q.append(now)
        if len(self.hits) > 10_000:                     # bound memory
            for k in list(self.hits)[:1000]:
                self.hits.pop(k, None)
        return None


def normalise(q: str) -> str:
    q = re.sub(r"[^a-z0-9.% ]+", " ", q.lower())
    return re.sub(r"\s+", " ", q).strip().rstrip(".")


class AnswerCache:
    def __init__(self, ttl_s: int, max_items: int, clock=time.monotonic):
        self.ttl, self.max, self.clock = ttl_s, max_items, clock
        self.items: OrderedDict[str, tuple[float, dict]] = OrderedDict()

    def get(self, q: str) -> dict | None:
        k = normalise(q)
        hit = self.items.get(k)
        if not hit:
            return None
        t, v = hit
        if self.clock() - t > self.ttl:
            self.items.pop(k, None)
            return None
        self.items.move_to_end(k)
        return v

    def put(self, q: str, payload: dict):
        k = normalise(q)
        self.items[k] = (self.clock(), payload)
        self.items.move_to_end(k)
        while len(self.items) > self.max:
            self.items.popitem(last=False)


def load_demo(path: Path = DEMO_FILE) -> dict[str, dict]:
    """Selected demo answers, pre-computed by scripts/build_demo_answers.py. Never expire."""
    if not path.exists():
        return {}
    d = json.loads(path.read_text())
    return {normalise(x["question"]): x for x in d.get("answers", [])}
