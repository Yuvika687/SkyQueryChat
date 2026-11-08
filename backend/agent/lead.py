"""The answer's lead sentence ("headline"), written by code in plain analyst language.

It is built only from what the final answer already contains (cards, chart points, coverage, resolved
period), so every number in it is a tool result. It then goes through the same number check and causal-
wording check as the model's text; if anything fails, there is no headline and the model's text is shown.
Works on a FinalAnswer dict, so live, cached and saved demo answers all get the same wording.
"""
from __future__ import annotations

import calendar
import re
from datetime import date
from typing import Any

from backend.analysis.aqi import category as aqi_category

from .verify import allowed_numbers, causal_phrases, check_numbers

MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
MONTHS_LONG = list(calendar.month_name)[1:]
PM = {"pm25": "PM2.5", "pm10": "PM10", "pm2.5": "PM2.5"}


# ------------------------------------------------------------------ formatting
def _d(iso: str | None) -> date | None:
    try:
        return date.fromisoformat(str(iso)[:10])
    except (TypeError, ValueError):
        return None


def fmt_day(iso: str, year: bool = True) -> str:
    d = _d(iso)
    return f"{d.day} {MONTHS[d.month - 1]}" + (f" {d.year}" if year else "") if d else str(iso)


def fmt_range(a: str, b: str) -> str:
    x, y = _d(a), _d(b)
    if not x or not y:
        return f"{a} to {b}"
    if x == y:
        return fmt_day(a)
    if x.year == y.year and x.month == y.month:
        return f"{x.day}–{y.day} {MONTHS[y.month - 1]} {y.year}"
    if x.year == y.year:
        return f"{fmt_day(a, year=False)} – {fmt_day(b)}"
    return f"{fmt_day(a)} – {fmt_day(b)}"


def pm(v: float) -> str:
    return f"{v:.1f}"


def aqi(v: float) -> str:
    return str(int(v)) if float(v).is_integer() else f"{v:g}"


WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"]


def count_word(n: int) -> str:
    return WORDS[n] if 0 <= n < len(WORDS) else str(n)


def _join(items: list[str]) -> str:
    return items[0] if len(items) == 1 else ", ".join(items[:-1]) + " and " + items[-1]


# ------------------------------------------------------------------ period wording
def period_phrase(rq: dict | None, allowed: set[float]) -> str:
    if not rq or not rq.get("start_date"):
        return ""
    a, b = rq["start_date"], rq.get("end_date") or rq["start_date"]
    x, y = _d(a), _d(b)
    assume = " ".join(rq.get("assumptions") or []).lower()
    if "relative to the latest data" in assume and x and y:
        n = (y - x).days + 1
        days = f"{n} days" if float(n) in allowed else "days"
        return f"over the latest {days} available ({fmt_range(a, b)})"
    if "no period stated" in assume:
        return f"across all the measured data ({fmt_range(a, b)})"
    if x and y and x.day == 1 and y.day == calendar.monthrange(y.year, y.month)[1]:
        if x.year == y.year and x.month == y.month:
            return f"in {MONTHS_LONG[x.month - 1]} {x.year}"
        if x.month == 1 and y.month == 12 and x.year == y.year:
            return f"in {x.year}"
    m = re.search(r"\b(winter|summer|monsoon|post-monsoon|pre-monsoon)\b", assume)
    if m and x and y:
        return f"in {m.group(1)} ({fmt_range(a, b)})"
    if x and y and x != y:
        return f"between {fmt_day(a, year=x.year != y.year)} and {fmt_day(b)}"
    return f"on {fmt_day(a)}"


# ------------------------------------------------------------------ helpers over the final answer
def _card(f: dict, pattern: str) -> dict | None:
    return next((c for c in f.get("cards", []) if re.fullmatch(pattern, c.get("field", ""))), None)


def _kind(f: dict) -> str | None:
    rq = f.get("resolved_query") or {}
    items = rq.get("items") or []
    if items and items[0].get("tool"):
        return {"city_trend": "trend", "compare_cities": "compare", "diwali_aqi": "diwali",
                "unusual_days": "unusual", "weather_association": "weather", "data_coverage": "coverage"}.get(items[0]["tool"])
    return None


def _pairs(series: dict) -> list[tuple[str, float]]:
    return [(str(p[0]), float(p[1])) for p in series.get("data", [])
            if isinstance(p, (list, tuple)) and len(p) == 2 and isinstance(p[1], (int, float))]


def _pollutant(f: dict) -> str:
    p = ((f.get("resolved_query") or {}).get("pollutant") or "").lower()
    return "PM10" if "pm10" in p else "PM2.5" if "pm2" in p or "pm25" in p else ""


# ------------------------------------------------------------------ per analysis
def _compare(f: dict, allowed: set[float]) -> str | None:
    chart = f.get("chart") or {}
    bars = sorted(_pairs((chart.get("series") or [{}])[0]), key=lambda x: -x[1])
    if len(bars) < 2:
        return None
    pol, per = _pollutant(f), period_phrase(f.get("resolved_query"), allowed)
    cov = next(iter((f.get("coverage") or {}).values()), None) or {}
    n = cov.get("common_days")
    days = f"on the {n} days with valid data in every city" if n else "on days with valid data in every city"
    if len(bars) == 2:
        (a, va), (b, vb) = bars
        if va == vb:
            return f"{a} and {b} had the same average {pol} {per}: {pm(va)} µg/m³, {days}."
        days2 = f"on the {n} days with valid data for both" if n else "on days with valid data for both"
        return f"{a}'s {pol} was higher than {b}'s {per}: {pm(va)} µg/m³ against {pm(vb)} µg/m³, averaged {days2}."
    (top, vt), (low, vl) = bars[0], bars[-1]
    return (f"{top} had the highest {pol} of the {count_word(len(bars))} cities {per}, averaging {pm(vt)} µg/m³; "
            f"{low} had the lowest at {pm(vl)} µg/m³ (averages {days}).")


def _trend(f: dict, allowed: set[float]) -> str | None:
    rq = f.get("resolved_query") or {}
    city, pol, per = rq.get("city"), _pollutant(f), period_phrase(rq, allowed)
    if not city:
        return None
    mean = _card(f, "mean")
    series = ((f.get("chart") or {}).get("series") or [{}])[0]
    pts = _pairs(series)
    daily = [p for p in pts if re.fullmatch(r"\d{4}-\d{2}-\d{2}", p[0])]
    first = f"{city}'s {pol} averaged {pm(mean['value'])} µg/m³ {per}." if mean else None
    if first is None and len(pts) == 1:
        first = f"{city}'s {pol} averaged {pm(pts[0][1])} µg/m³ {per}."
    if first is None:
        return None
    if len(daily) >= 3:
        lo, hi = min(daily, key=lambda p: p[1]), max(daily, key=lambda p: p[1])
        return first + (f" Daily values ranged from {pm(lo[1])} µg/m³ on {fmt_day(lo[0], year=False)} "
                        f"to {pm(hi[1])} µg/m³ on {fmt_day(hi[0], year=False)}.")
    cov = next(iter((f.get("coverage") or {}).values()), None) or {}
    if cov.get("days_with_city_value") is not None and cov.get("days_in_period"):
        return first[:-1] + (f", with a valid city value on {cov['days_with_city_value']} of "
                             f"{cov['days_in_period']} days.")
    return first


def _festival_points(f: dict) -> dict[str, list[dict]]:
    chart = f.get("chart") or {}
    bands = chart.get("bands") or []
    lo = min((b.get("start") for b in bands), default=1)
    hi = max((b.get("end") for b in bands), default=2)
    out: dict[str, list[dict]] = {}
    for s in chart.get("series") or []:
        m = re.search(r"(\d{4})", s.get("name", ""))
        pts = [p for p in s.get("data", []) if isinstance(p, dict) and isinstance(p.get("aqi"), (int, float))
               and isinstance(p.get("x"), (int, float)) and lo <= p["x"] <= hi]
        if m and pts:
            out[m.group(1)] = sorted(pts, key=lambda p: p["x"])
    return out


def _diwali(f: dict, allowed: set[float]) -> str | None:
    rq = f.get("resolved_query") or {}
    city = rq.get("city")
    years = _festival_points(f)
    if not city or not years:
        return None

    def bulletins(pts: list[dict]) -> str:
        vals = [aqi(p["aqi"]) for p in pts]
        return " and ".join(vals)

    def when(pts: list[dict]) -> str:
        ds = [p.get("bulletin_date") for p in pts if p.get("bulletin_date")]
        return fmt_range(ds[0], ds[-1]) if ds else ""

    def cats(pts: list[dict]) -> set[str]:
        return {str(p.get("category") or aqi_category(p["aqi"])) for p in pts}

    if len(years) == 1:
        y, pts = next(iter(years.items()))
        c = cats(pts)
        lead = (f"{city}'s air was {c.pop()} over Diwali {y}: " if len(c) == 1 else f"Over Diwali {y} in {city}, ")
        return (lead + f"the official CPCB AQI read {bulletins(pts)} in the {count_word(len(pts))} festival "
                f"bulletins ({when(pts)}). Each bulletin runs from 4 PM to 4 PM.")
    (y1, p1), (y2, p2) = sorted(years.items())[-2:]
    c1, c2 = _card(f, fr"{y1}_festival_aqi"), _card(f, fr"{y2}_festival_aqi")
    if not c1 or not c2:
        return None
    trend = "lower" if c2["value"] < c1["value"] else "higher" if c2["value"] > c1["value"] else "about the same"
    allc = cats(p1) | cats(p2)
    tail = f" All {count_word(len(p1) + len(p2))} bulletins were {allc.pop()}." if len(allc) == 1 else ""
    return (f"On average, {city}'s official AQI over Diwali was {trend} in {y2} than in {y1}: the festival "
            f"bulletins read {bulletins(p2)} in {y2} ({when(p2)}), against {bulletins(p1)} in {y1} ({when(p1)}).{tail}")


def _unusual(f: dict, allowed: set[float]) -> str | None:
    rq = f.get("resolved_query") or {}
    city, pol, per = rq.get("city"), _pollutant(f), period_phrase(rq, allowed)
    n = _card(f, "unusual_count")
    if not city or not n:
        return None
    count = int(n["value"])
    lead = (f"{city} had {count} unusual {pol} day{'s' if count != 1 else ''} {per}, judged against the "
            f"typical level of the surrounding days.")
    highs = [c for c in f.get("cards", []) if re.fullmatch(r"day\d+_value", c.get("field", "")) and "unusually high" in c["label"]]
    if highs:
        top = max(highs, key=lambda c: c["value"])
        m = re.search(r"(\d{4}-\d{2}-\d{2})", top["label"])
        if m:
            lead += f" The highest was {pm(top['value'])} µg/m³ on {fmt_day(m.group(1))}."
    return lead


def _weather(f: dict, allowed: set[float]) -> str | None:
    rq = f.get("resolved_query") or {}
    city, pol = rq.get("city"), _pollutant(f)
    rho = _card(f, "rho")
    if not city or not rho:
        return None
    src = (f.get("sources") or [{}])[0].get("title", "")
    var = src.split(" and ", 1)[-1].rsplit(" in ", 1)[0] if " and " in src else "the weather"
    r = rho["value"]
    a = abs(r)
    rs = f"{r:g}".replace("-", "−")
    strength = "very weak" if a < 0.1 else "weak" if a < 0.3 else "moderate" if a < 0.5 else "strong"
    cov = next(iter((f.get("coverage") or {}).values()), None) or {}
    days = f", {cov['matched_days']} days" if cov.get("matched_days") else ""
    rain, dry = _card(f, "rain_mean"), _card(f, "dry_mean")
    if rain and dry:
        lower = "rainy" if rain["value"] < dry["value"] else "dry"
        return (f"In {city}, {pol} tended to be lower on {lower} days: it averaged {pm(rain['value'])} µg/m³ on days "
                f"with rain against {pm(dry['value'])} µg/m³ on dry days (Spearman ρ = {rs}{days}, a {strength} "
                f"association). This is an association, not a cause.")
    sign = "negative" if r < 0 else "positive"
    return (f"In {city}, daily {pol} showed a {strength} {sign} association with {var} (Spearman ρ = {rs}{days}). "
            "This is an association, not a cause.")


def _coverage(f: dict, allowed: set[float]) -> str | None:
    rq = f.get("resolved_query") or {}
    city, per = rq.get("city"), period_phrase(rq, allowed)
    cov = next(iter((f.get("coverage") or {}).values()), None) or {}
    rows = {r.get("pollutant"): r for r in cov.get("by_pollutant") or []}
    days = _card(f, "days_in_period")
    if not city or not rows or not days:
        return None
    parts = []
    for key, name in (("pm25", "PM2.5"), ("pm10", "PM10")):
        r = rows.get(key)
        if r and r.get("days_with_city_value") is not None:
            parts.append(f"{name} on {r['days_with_city_value']} of {int(days['value'])} days")
    return f"{city} had a valid city value for {_join(parts)} {per}." if parts else None


BUILDERS = {"compare": _compare, "trend": _trend, "diwali": _diwali, "unusual": _unusual,
            "weather": _weather, "coverage": _coverage}


def headline(final: dict[str, Any]) -> str | None:
    """Code-written lead sentence for an answered question, or None (then the model's text leads)."""
    if final.get("status") != "answered":
        return None
    kind = _kind(final)
    if kind not in BUILDERS:
        return None
    payload = {k: final.get(k) for k in ("cards", "chart", "coverage", "sources", "resolved_query")}
    allowed = allowed_numbers([payload])
    try:
        text = BUILDERS[kind](final, allowed)
    except (KeyError, TypeError, ValueError, IndexError):
        return None
    if not text:
        return None
    text = re.sub(r"\s+", " ", text).replace(" .", ".").strip()
    if check_numbers([text], allowed) or causal_phrases(text):
        return None
    return text
