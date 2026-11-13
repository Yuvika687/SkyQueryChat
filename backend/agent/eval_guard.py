"""Quota guard for evaluation runs (local tool; never used by the API).

Before an evaluation starts, count ALL AI use already made today for each model:
  - local evaluation runs: usage stored in evals/runs/*/results.jsonl for runs started since the last reset
    (midnight Pacific for Gemini), and
  - visitors: the live backend's /api/quota "used_today" (it counts since that server last started, so it is a lower
    bound; a restart loses earlier counts, see known limit ai_quota_in_memory).
Then seed the shared limiter with that usage, so it enforces the daily caps with today's earlier use counted, and
refuse to start when the run's estimated need does not fit under the cap. Evaluations use the PUBLIC caps (80% of the
provider limit, minus the demo reserve), so the reserve stays free for visitors and demos.
"""
from __future__ import annotations

import json
import time
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

PT = ZoneInfo("America/Los_Angeles")
MODEL_KEY = "google:{}"


def last_reset(now: float | None = None) -> float:
    d = datetime.fromtimestamp(time.time() if now is None else now, PT)
    return d.replace(hour=0, minute=0, second=0, microsecond=0).timestamp()


def run_started(run_dir: Path) -> float | None:
    """Start time of a run from its meta.json ("%Y-%m-%d %H:%M", the machine's local time)."""
    try:
        meta = json.loads((run_dir / "meta.json").read_text())
        return time.mktime(time.strptime(meta["started"], "%Y-%m-%d %H:%M"))
    except (OSError, KeyError, ValueError):
        return None


def local_usage(runs_dir: Path, since: float) -> dict[str, dict[str, int]]:
    """Requests and tokens per model from evaluation runs started at or after `since`."""
    out: dict[str, dict[str, int]] = {}
    for d in sorted(p for p in runs_dir.glob("*") if p.is_dir()):
        t = run_started(d)
        if t is None or t < since or not (d / "results.jsonl").exists():
            continue
        for line in (d / "results.jsonl").read_text().splitlines():
            if not line.strip():
                continue
            f = json.loads(line).get("final") or {}
            u, m = f.get("usage") or {}, f.get("model")
            if not m or not u:
                continue
            x = out.setdefault(MODEL_KEY.format(m) if ":" not in m else m, {"requests": 0, "tokens": 0})
            x["requests"] += int(u.get("requests", 0))
            x["tokens"] += int(u.get("input_tokens", 0)) + int(u.get("output_tokens", 0))
    return out


def live_usage(api: str, timeout: float = 90) -> dict[str, dict[str, int]]:
    """Visitor usage today from the live backend's /api/quota. Raises if it cannot be read (never assume zero)."""
    with urllib.request.urlopen(f"{api.rstrip('/')}/api/quota", timeout=timeout) as r:
        d = json.loads(r.read())
    return {k: {"requests": int(v["used_today"]["requests"]), "tokens": int(v["used_today"]["tokens"])}
            for k, v in (d.get("models") or {}).items() if "used_today" in v}


@dataclass
class Plan:
    ok: bool
    lines: list[str] = field(default_factory=list)
    used: dict[str, dict[str, int]] = field(default_factory=dict)


def plan(quota, chain: list[str], local: dict, live: dict, need_requests: int, need_tokens: int) -> Plan:
    """Check the primary model has room for the whole run under the public daily caps, counting today's use."""
    used = {}
    for k in set(local) | set(live):
        a, b = local.get(k, {}), live.get(k, {})
        used[k] = {"requests": a.get("requests", 0) + b.get("requests", 0), "tokens": a.get("tokens", 0) + b.get("tokens", 0)}
    primary = chain[0]
    caps = quota.get(primary).caps(demo=False)
    u = used.get(primary, {"requests": 0, "tokens": 0})
    lines = [f"{primary}: used today {u['requests']} requests / {u['tokens']:,} tokens "
             f"(evaluations {local.get(primary, {}).get('requests', 0)} / {local.get(primary, {}).get('tokens', 0):,}; "
             f"visitors {live.get(primary, {}).get('requests', 0)} / {live.get(primary, {}).get('tokens', 0):,}); "
             f"caps {caps['rpd']} requests / {caps['tokens_day']:,} tokens; this run needs about {need_requests} / {need_tokens:,}."]
    ok = True
    if caps["rpd"] is not None and u["requests"] + need_requests > caps["rpd"]:
        ok = False
        lines.append(f"Not starting: {u['requests']} + {need_requests} requests would pass the cap of {caps['rpd']}.")
    if caps["tokens_day"] is not None and u["tokens"] + need_tokens > caps["tokens_day"]:
        ok = False
        lines.append(f"Not starting: {u['tokens']:,} + {need_tokens:,} tokens would pass the cap of {caps['tokens_day']:,}.")
    return Plan(ok, lines, used)


def seed(quota, used: dict[str, dict[str, int]], now: float | None = None) -> None:
    """Record today's earlier use in the shared limiter, so it enforces the daily caps with that use counted."""
    now = time.time() if now is None else now
    for k, u in used.items():
        if k in quota.models:
            quota.get(k).seed(u["requests"], u["tokens"], now)


def estimate(runs_dir: Path, set_name: str, n_questions: int, margin: float = 1.25) -> tuple[int, int]:
    """Requests and tokens for a run of `n_questions`, from the set's most recent complete run (plus 25%)."""
    best = None
    for d in sorted(runs_dir.glob(f"*_{set_name}_*"), reverse=True):
        rows = [json.loads(x) for x in (d / "results.jsonl").read_text().splitlines() if x.strip()] \
            if (d / "results.jsonl").exists() else []
        if len(rows) >= n_questions * 0.8:
            best = rows
            break
    if not best:
        return int(n_questions * 3 * margin), int(n_questions * 7000 * margin)
    req = sum((r["final"].get("usage") or {}).get("requests", 0) for r in best)
    tok = sum((r["final"].get("usage") or {}).get("input_tokens", 0) + (r["final"].get("usage") or {}).get("output_tokens", 0) for r in best)
    k = n_questions / max(1, len(best))
    return int(req * k * margin) + 1, int(tok * k * margin) + 1
