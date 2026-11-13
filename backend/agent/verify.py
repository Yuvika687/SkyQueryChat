"""Answer checks: every number must come from a tool result; causal wording is rejected.

Numbers are compared after rounding: a number written with d decimals matches a tool value v when
round(v, d) equals it (also v x 100 for shares written as %). Dates in tool results contribute their
year/month/day parts. Labels like PM2.5, PM10, D+1 and clock times (4 PM, 16:00) are not values.

Readable dates ("9 Nov 2026", "Nov 9, 2026", "9–10 Nov 2026", "13 Oct – 11 Nov 2026", "9 Nov") are checked as dates:
each must be a date that appears in a tool result (or, without a year, the same day and month of one). Tool dates are
kept in the allowed set as date codes yyyymmdd (DATE_CODE + code), so every caller gets the date check.
"""
from __future__ import annotations

import json
import math
import re
from typing import Any, Iterable

NUM = re.compile(r"(?<![\w.])[-−–]?\d{1,3}(?:,\d{3})+(?:\.\d+)?%?|(?<![\w.])[-−–]?\d+(?:\.\d+)?%?")
DATE = re.compile(r"(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)")   # also inside field names like bulletin_2026-11-09
STRIP = [
    re.compile(r"\bPM\s?2\.5\b", re.I), re.compile(r"\bPM\s?10\b", re.I), re.compile(r"\bPM\s?25\b", re.I),
    re.compile(r"\bD\s?[+\-−–]\s?\d+\b"),                         # D+1, D-7
    re.compile(r"\b\d{1,2}(?::\d{2})?\s?(?:AM|PM|am|pm)\b"),       # 4 PM
    re.compile(r"\b\d{1,2}:\d{2}\b"),                              # 16:00
    re.compile(r"\bW[1-4]\b"), re.compile(r"\bCC BY 4\.0\b"), re.compile(r"\bC3S\b"),
    re.compile(r"\b(?:gpt|gemini|llama)[\w.\-/]*", re.I),
    re.compile(r"\bds\d+\b"),                                      # dataset ids
]

MONTHS = {m: i + 1 for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"])}
_MON = r"(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?"
_DASH = r"\s*[–\-−]\s*"
READABLE = [
    # 13 Oct – 11 Nov 2026
    (re.compile(rf"(?<![\w.])(\d{{1,2}})\s+{_MON}{_DASH}(\d{{1,2}})\s+{_MON}(?:,?\s+(\d{{4}}))?\b", re.I), "range2"),
    # 9–10 Nov 2026
    (re.compile(rf"(?<![\w.])(\d{{1,2}}){_DASH}(\d{{1,2}})\s+{_MON}(?:,?\s+(\d{{4}}))?\b", re.I), "range1"),
    # 9 Nov 2026, 9 November
    (re.compile(rf"(?<![\w.])(\d{{1,2}})\s+{_MON}(?:,?\s+(\d{{4}}))?\b", re.I), "dmy"),
    # Nov 9, 2026
    (re.compile(rf"\b{_MON}\s+(\d{{1,2}})(?:,\s*(\d{{4}}))?\b", re.I), "mdy"),
]
DATE_CODE = 1e9          # date codes live far above any measured value: DATE_CODE + yyyymmdd


def _code(y: int, m: int, d: int) -> float:
    return DATE_CODE + y * 10000 + m * 100 + d


def readable_dates(text: str) -> tuple[list[tuple[str, list[tuple[int | None, int, int]]]], str]:
    """Readable dates in text as (token, [(year or None, month, day), ...]); returns the text with them removed."""
    found = []

    def mon(x: str) -> int:
        return MONTHS[x[:3].lower()]

    for rx, kind in READABLE:
        def take(m: re.Match) -> str:
            g = m.groups()
            if kind == "range2":
                y = int(g[4]) if g[4] else None
                ds = [(y, mon(g[1]), int(g[0])), (y, mon(g[3]), int(g[2]))]
            elif kind == "range1":
                y = int(g[3]) if g[3] else None
                ds = [(y, mon(g[2]), int(g[0])), (y, mon(g[2]), int(g[1]))]
            elif kind == "dmy":
                ds = [(int(g[2]) if g[2] else None, mon(g[1]), int(g[0]))]
            else:
                ds = [(int(g[2]) if g[2] else None, mon(g[0]), int(g[1]))]
            if any(not 1 <= d <= 31 for _, _, d in ds):
                return m.group(0)
            found.append((m.group(0), ds))
            return " "
        text = rx.sub(take, text)
    return found, text


def date_supported(y: int | None, m: int, d: int, allowed: set[float]) -> bool:
    if y is not None:
        return _code(y, m, d) in allowed
    return any(a >= DATE_CODE and int(a - DATE_CODE) % 10000 == m * 100 + d for a in allowed)


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
            yield _code(int(y), int(m), int(d))
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
    """(token, value, decimals, is_percent) for each number written in text. ISO and readable dates are not
    numbers (readable dates are checked separately, see check_numbers)."""
    _, text = readable_dates(text)
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
        known = allowed | set(user_numbers)
        for tok, ds in readable_dates(text)[0]:          # every day in a readable date must be a real tool date
            if not all(date_supported(y, m, d, known) for y, m, d in ds):
                bad.append(tok)
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
        out.update({float(y), float(int(m)), float(int(d)), _code(int(y), int(m), int(d))})
    for _, ds in readable_dates(question)[0]:          # dates the user wrote may be echoed back
        for y, m, d in ds:
            if y:
                out.add(_code(y, m, d))
            else:
                out.update(_code(yy, m, d) for yy in range(2024, 2028))
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
