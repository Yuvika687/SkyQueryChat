"""Answer checks: every number must come from a tool result; causal wording is rejected.

Numbers are compared after rounding: a number written with d decimals matches a tool value v when
round(v, d) equals it (also v x 100 for shares written as %). Dates in tool results contribute their
year/month/day parts. Labels like PM2.5, PM10, D+1 and clock times (4 PM, 16:00) are not values.
"""
from __future__ import annotations

import json
import math
import re
from typing import Any, Iterable

NUM = re.compile(r"(?<![\w.])[-−–]?\d{1,3}(?:,\d{3})+(?:\.\d+)?%?|(?<![\w.])[-−–]?\d+(?:\.\d+)?%?")
DATE = re.compile(r"\b(\d{4})-(\d{2})-(\d{2})\b")
STRIP = [
    re.compile(r"\bPM\s?2\.5\b", re.I), re.compile(r"\bPM\s?10\b", re.I), re.compile(r"\bPM\s?25\b", re.I),
    re.compile(r"\bD\s?[+\-−–]\s?\d+\b"),                         # D+1, D-7
    re.compile(r"\b\d{1,2}(?::\d{2})?\s?(?:AM|PM|am|pm)\b"),       # 4 PM
    re.compile(r"\b\d{1,2}:\d{2}\b"),                              # 16:00
    re.compile(r"\bW[1-4]\b"), re.compile(r"\bCC BY 4\.0\b"), re.compile(r"\bC3S\b"),
    re.compile(r"\b(?:gpt|gemini|llama)[\w.\-/]*", re.I),
    re.compile(r"\bds\d+\b"),                                      # dataset ids
]

CAUSAL = re.compile(r"\b(caus(?:e|es|ed|ing)|due to|because of|leads? to|led to|results? in|resulted in|"
                    r"driven by|responsible for|triggered|attributable to)\b", re.I)
NEGATED = re.compile(r"\b(not|no|never|cannot|can't|doesn't|does not|do not|isn't|is not|without)\b[^.]{0,60}$", re.I)


def _numbers_in(obj: Any) -> Iterable[float]:
    if isinstance(obj, bool) or obj is None:
        return
    if isinstance(obj, (int, float)):
        if not (isinstance(obj, float) and math.isnan(obj)):
            yield float(obj)
    elif isinstance(obj, str):
        for y, m, d in DATE.findall(obj):
            yield float(y); yield float(int(m)); yield float(int(d))
        s = DATE.sub(" ", obj)
        for p in STRIP:
            s = p.sub(" ", s)
        for tok in NUM.findall(s):
            v = _to_float(tok)
            if v is not None:
                yield v
    elif isinstance(obj, dict):
        for k, v in obj.items():
            yield from _numbers_in(k) if isinstance(k, str) and DATE.search(k) else ()
            yield from _numbers_in(v)
    elif isinstance(obj, (list, tuple)):
        for v in obj:
            yield from _numbers_in(v)


def _to_float(tok: str) -> float | None:
    t = tok.replace(",", "").replace("−", "-").replace("–", "-").rstrip("%")
    try:
        return float(t)
    except ValueError:
        return None


def numeric_leaves(obj: Any) -> set[float]:
    """Only real numeric fields (not numbers inside text or dates) — used for metric cards."""
    out: set[float] = set()
    if isinstance(obj, bool) or obj is None:
        return out
    if isinstance(obj, (int, float)):
        if not (isinstance(obj, float) and math.isnan(obj)):
            out.add(float(obj))
    elif isinstance(obj, dict):
        for v in obj.values():
            out |= numeric_leaves(v)
    elif isinstance(obj, (list, tuple)):
        for v in obj:
            out |= numeric_leaves(v)
    return out


def allowed_numbers(tool_payloads: Iterable[Any]) -> set[float]:
    out: set[float] = set()
    for p in tool_payloads:
        out.update(_numbers_in(p))
    return out


def extract_numbers(text: str) -> list[tuple[str, float, int, bool]]:
    """(token, value, decimals, is_percent) for each number written in text."""
    s = DATE.sub(lambda m: " ", text)
    dates = DATE.findall(text)
    for p in STRIP:
        s = p.sub(" ", s)
    out = []
    for tok in NUM.findall(s):
        v = _to_float(tok)
        if v is None:
            continue
        core = tok.replace(",", "").rstrip("%")
        dec = len(core.split(".")[1]) if "." in core else 0
        out.append((tok, v, dec, tok.endswith("%")))
    return out, dates


def number_supported(v: float, dec: int, pct: bool, allowed: set[float]) -> bool:
    for a in allowed:
        for cand in (a, -a, a * 100, -a * 100) if pct else (a, -a):
            if math.isclose(round(cand, dec), v, abs_tol=10 ** (-dec) * 0.01 + 1e-9):
                return True
    return False


def check_numbers(texts: list[str], allowed: set[float], user_numbers: set[float] = frozenset()) -> list[str]:
    """Return tokens not supported by any tool result."""
    bad = []
    for text in texts:
        if not text:
            continue
        nums, _ = extract_numbers(text)
        for tok, v, dec, pct in nums:
            if v in user_numbers and not pct:
                continue
            if not number_supported(v, dec, pct, allowed):
                bad.append(tok)
    return bad


def user_safe_numbers(question: str) -> set[float]:
    """Numbers from the user's question that may be echoed: years and small counts (e.g. 'top 5')."""
    nums, dates = extract_numbers(question)
    out = {v for _, v, dec, pct in nums if not pct and dec == 0 and (2000 <= v <= 2100 or 0 < v <= 12)}
    for y, m, d in dates:
        out.update({float(y), float(int(m)), float(int(d))})
    return out


def causal_phrases(text: str) -> list[str]:
    """Causal wording that is not negated in the same sentence ('this is not a cause' is fine)."""
    bad = []
    for m in CAUSAL.finditer(text or ""):
        sentence_start = max(text.rfind(".", 0, m.start()), text.rfind("\n", 0, m.start())) + 1
        before = text[sentence_start:m.start()]
        if NEGATED.search(before):
            continue
        bad.append(m.group(0))
    return bad


def payload_text(p: Any) -> str:
    return json.dumps(p, ensure_ascii=False, default=str)
