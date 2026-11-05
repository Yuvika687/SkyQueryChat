"""Deterministic resolver: turns phrases the model copies from the user into canonical cities,
pollutants, date ranges and events. The model never decides dates or city spellings itself."""
from __future__ import annotations

import calendar
import difflib
import re
from datetime import date, timedelta

from backend.pipeline import config as C

SUPPORTED_CITIES = list(C.CITIES)
CITY_ALIASES = {
    "delhi": "Delhi", "new delhi": "Delhi", "delhi ncr": "Delhi", "ncr": "Delhi", "dilli": "Delhi",
    "mumbai": "Mumbai", "bombay": "Mumbai",
    "kolkata": "Kolkata", "calcutta": "Kolkata",
    "chennai": "Chennai", "madras": "Chennai",
    "bengaluru": "Bengaluru", "bangalore": "Bengaluru", "blr": "Bengaluru",
    "hyderabad": "Hyderabad", "hyd": "Hyderabad", "secunderabad": "Hyderabad",
}
POLLUTANT_ALIASES = {
    "pm2.5": "pm25", "pm25": "pm25", "pm 2.5": "pm25", "pm2_5": "pm25", "fine particles": "pm25",
    "fine particulate matter": "pm25", "pm10": "pm10", "pm 10": "pm10", "coarse particles": "pm10",
    "aqi": "aqi", "air quality index": "aqi",
}
UNSUPPORTED_POLLUTANTS = {"no2", "nitrogen dioxide", "so2", "sulphur dioxide", "sulfur dioxide", "o3", "ozone",
                          "co", "carbon monoxide", "nh3", "ammonia", "lead", "benzene"}
MONTHS = {m.lower(): i for i, m in enumerate(calendar.month_name) if m}
MONTHS.update({m.lower(): i for i, m in enumerate(calendar.month_abbr) if m})
MONTHS["sept"] = 9
SEASONS = {  # (start month, end month, crosses year)
    "winter": (12, 2, True), "summer": (3, 5, False), "pre-monsoon": (3, 5, False),
    "monsoon": (6, 9, False), "post-monsoon": (10, 11, False),
}

# data windows (set from data at startup; defaults match the current build)
DATA = {"measured_start": date(2025, 2, 18), "measured_end": date(2026, 10, 30),
        "aqi_end": date(2026, 10, 25), "weather_start": date(2025, 2, 18), "weather_end": date(2026, 11, 3)}


def set_data_windows(measured_end: date, aqi_end: date, weather_end: date) -> None:
    DATA.update(measured_end=measured_end, aqi_end=aqi_end, weather_end=weather_end)


def resolve_city(text: str) -> dict:
    t = re.sub(r"[^a-z ]", " ", text.lower()).strip()
    t = re.sub(r"\s+", " ", t)
    if t in CITY_ALIASES:
        return {"input": text, "city": CITY_ALIASES[t]}
    close = difflib.get_close_matches(t, list(CITY_ALIASES), n=1, cutoff=0.85)
    if close:
        return {"input": text, "city": CITY_ALIASES[close[0]], "note": f"interpreted '{text}' as {CITY_ALIASES[close[0]]}"}
    return {"input": text, "city": None, "unsupported": True,
            "message": f"'{text}' is not supported. Supported cities: {', '.join(SUPPORTED_CITIES)}."}


def resolve_pollutant(text: str | None) -> dict:
    if not text:
        return {"pollutant": None}
    t = text.lower().strip().replace("µg/m³", "").strip()
    if t in POLLUTANT_ALIASES:
        return {"input": text, "pollutant": POLLUTANT_ALIASES[t]}
    if t in UNSUPPORTED_POLLUTANTS:
        return {"input": text, "pollutant": None, "unsupported": True,
                "message": f"{text} is not covered. Only PM2.5 and PM10 (measured) and official AQI are available."}
    for k, v in POLLUTANT_ALIASES.items():
        if k in t:
            return {"input": text, "pollutant": v}
    return {"input": text, "pollutant": None, "unsupported": True,
            "message": "Only PM2.5, PM10 and official AQI are available."}


def _month_range(y: int, m: int) -> tuple[date, date]:
    return date(y, m, 1), date(y, m, calendar.monthrange(y, m)[1])


def resolve_period(text: str | None, anchor: date | None = None) -> dict:
    """Parse a period phrase. Relative phrases ('last month') are anchored to the latest measured
    data date, not today, and the answer says so."""
    if not text:
        return {"period": None}
    anchor = anchor or DATA["measured_end"]
    t = text.lower().strip()
    t = re.sub(r"\s+", " ", t)
    start = end = None
    note = None
    m = re.fullmatch(r"(\d{4}-\d{2}-\d{2})\s*(?:to|until|-|–|and|through)\s*(\d{4}-\d{2}-\d{2})", t)
    if m:
        start, end = date.fromisoformat(m.group(1)), date.fromisoformat(m.group(2))
    elif re.fullmatch(r"\d{4}-\d{2}-\d{2}", t):
        start = end = date.fromisoformat(t)
    elif re.fullmatch(r"(19|20)\d{2}", t):
        y = int(t)
        start, end = date(y, 1, 1), date(y, 12, 31)
    elif (m := re.fullmatch(r"([a-z]+)\.? (\d{4})", t)) and m.group(1) in MONTHS:
        start, end = _month_range(int(m.group(2)), MONTHS[m.group(1)])
    elif (m := re.fullmatch(r"(\d{1,2}) ([a-z]+) (\d{4})", t)) and m.group(2) in MONTHS:
        start = end = date(int(m.group(3)), MONTHS[m.group(2)], int(m.group(1)))
    elif (m := re.fullmatch(r"([a-z]+) (\d{1,2}),? (\d{4})", t)) and m.group(1) in MONTHS:
        start = end = date(int(m.group(3)), MONTHS[m.group(1)], int(m.group(2)))
    elif (m := re.fullmatch(r"([a-z\-]+) (\d{4})(?:[-/–](\d{2,4}))?", t)) and m.group(1) in SEASONS:
        sm, em, cross = SEASONS[m.group(1)]
        y = int(m.group(2))
        start = date(y, sm, 1)
        end = date(y + 1 if cross else y, em, calendar.monthrange(y + 1 if cross else y, em)[1])
        note = f"{m.group(1)} taken as {calendar.month_name[sm]}–{calendar.month_name[em]}"
    elif t in ("last month", "previous month"):
        first = anchor.replace(day=1)
        start, end = _month_range((first - timedelta(days=1)).year, (first - timedelta(days=1)).month)
        note = f"'last month' is relative to the latest data ({anchor})"
    elif t in ("this month", "latest month"):
        start, end = anchor.replace(day=1), anchor
        note = f"relative to the latest data ({anchor})"
    elif (m := re.fullmatch(r"(?:last|past|previous) (\d{1,3}) days", t)):
        start, end = anchor - timedelta(days=int(m.group(1)) - 1), anchor
        note = f"relative to the latest data ({anchor})"
    elif t in ("last year", "previous year"):
        start, end = date(anchor.year - 1, 1, 1), date(anchor.year - 1, 12, 31)
    elif t in ("this year", "so far this year"):
        start, end = date(anchor.year, 1, 1), anchor
    elif t in ("all", "all data", "entire period", "whole period", "all available data", "overall"):
        start, end = DATA["measured_start"], DATA["measured_end"]
    if start is None:
        return {"input": text, "period": None, "unparsed": True,
                "message": "Could not read this period. Use e.g. 'November 2025', '2025', 'winter 2025', "
                           "'last 30 days' or '2025-11-01 to 2025-11-30'."}
    if end < start:
        start, end = end, start
    out = {"input": text, "start": str(start), "end": str(end)}
    notes = [note] if note else []
    if end < DATA["measured_start"]:
        notes.append(f"No measured PM data before {DATA['measured_start']} in this dataset.")
        out["measured_available"] = False
    elif start > DATA["measured_end"]:
        notes.append(f"Measured PM data is not yet available after {DATA['measured_end']}.")
        out["measured_available"] = False
    else:
        if start < DATA["measured_start"]:
            notes.append(f"Measured PM data starts {DATA['measured_start']}; earlier dates are not covered.")
        if end > DATA["measured_end"]:
            notes.append(f"Measured PM data ends {DATA['measured_end']} (later days not yet published).")
        out["measured_available"] = True
    if notes:
        out["notes"] = notes
    return out


def resolve_event(text: str | None) -> dict:
    if not text:
        return {"event": None}
    t = text.lower()
    m = re.search(r"(diwali|deepavali|deepawali)\s*(\d{4})?", t)
    if not m:
        return {"input": text, "event": None, "unsupported": True,
                "message": "Only Diwali (2024, 2025, 2026) is configured as an event."}
    years = [int(m.group(2))] if m.group(2) else [2024, 2025]
    out = []
    for y in years:
        if str(y) not in C.EVENTS["diwali"]:
            out.append({"year": y, "status": "not_configured",
                        "message": f"Diwali {y} is not in the verified dates file (only 2024, 2025, 2026)."})
            continue
        D = C.diwali_date(y)
        fb = C.bulletin_dates_for(C.festival_days(y))
        avail = fb[-1] <= DATA["aqi_end"]
        e = {"year": y, "diwali_date": str(D), "festival_days": [str(d) for d in C.festival_days(y)],
             "festival_bulletin_dates": [str(d) for d in fb], "official_aqi_available": avail}
        if not avail:
            e["message"] = (f"Official AQI bulletins currently end {DATA['aqi_end']}; Diwali {y} ({D}) data is "
                            f"not available yet.")
        out.append(e)
    return {"input": text, "event": "diwali", "years": out}


def resolve(cities: list[str] | None = None, pollutant: str | None = None, period: str | None = None,
            event: str | None = None) -> dict:
    cs = [resolve_city(c) for c in (cities or [])]
    return {"cities": [c["city"] for c in cs if c.get("city")],
            "unsupported_cities": [c["input"] for c in cs if c.get("unsupported")],
            "city_details": cs, "pollutant": resolve_pollutant(pollutant), "period": resolve_period(period),
            "event": resolve_event(event), "supported_cities": SUPPORTED_CITIES,
            "data_windows": {k: str(v) for k, v in DATA.items()}}
