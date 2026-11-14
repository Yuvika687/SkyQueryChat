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
DATA = {"measured_start": date(2025, 2, 18), "measured_end": date(2026, 11, 11),
        "aqi_end": date(2026, 11, 11), "weather_start": date(2025, 2, 18), "weather_end": date(2026, 11, 11)}


def set_data_windows(measured_end: date, aqi_end: date, weather_end: date) -> None:
    DATA.update(measured_end=measured_end, aqi_end=aqi_end, weather_end=weather_end)


def set_windows_from_store(store) -> None:
    """The latest available dates come from the data itself (never fixed in code)."""
    import pandas as pd
    try:
        m = store.q("SELECT MAX(local_date) d FROM date_quality WHERE severity <> 'not_yet_published' AND source LIKE 'OpenAQ%'")["d"].iat[0]
        a = store.q("SELECT MAX(bulletin_date) d FROM city_daily_aqi")["d"].iat[0]
        w = store.q("SELECT MAX(local_date) d FROM weather_daily")["d"].iat[0]
        set_data_windows(pd.Timestamp(m).date(), pd.Timestamp(a).date(), pd.Timestamp(w).date())
    except Exception:       # synthetic test stores may lack tables; keep defaults
        pass


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


MON = r"(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)"
SEP = r"\s*(?:to|until|till|through|thru|and|-|–|—)\s*"


def _mon(t: str) -> int:
    return MONTHS[t[:3]] if t[:3] in MONTHS else MONTHS[t]


def _latest_year_for(month: int, anchor: date) -> int:
    """Most recent year in which `month` has started on or before the anchor date."""
    return anchor.year if date(anchor.year, month, 1) <= anchor else anchor.year - 1


def _natural_range(t: str, anchor: date) -> tuple[date, date, str | None] | None:
    """Ranges like 'March to June 2026', 'between Oct 2025 and Jan 2026', '15 Oct to 5 Nov 2025',
    '1-15 November 2025', 'since August 2025', 'until March 2026', 'Q1 2026', 'first half of 2026',
    'March to June' (year inferred from the latest data)."""
    # month (year) to month year
    m = re.fullmatch(rf"{MON}\.?(?:\s+(\d{{4}}))?{SEP}{MON}\.?(?:\s+(\d{{4}}))?", t)
    if m:
        m1, y1, m2, y2 = _mon(m.group(1)), m.group(2), _mon(m.group(3)), m.group(4)
        note = None
        if y2 is None and y1 is None:
            y2 = _latest_year_for(m2, anchor)
            note = f"year not given; taken as the latest {calendar.month_name[m1]}–{calendar.month_name[m2]} in the data"
        y2 = int(y2) if y2 else int(y1) + (1 if m2 < m1 else 0)
        y1 = int(y1) if y1 else (y2 - 1 if m1 > m2 else y2)
        return _month_range(y1, m1)[0], _month_range(y2, m2)[1], note
    # day month (year) to day month year
    m = re.fullmatch(rf"(\d{{1,2}})\s+{MON}\.?(?:\s+(\d{{4}}))?{SEP}(\d{{1,2}})\s+{MON}\.?\s+(\d{{4}})", t)
    if m:
        y2 = int(m.group(6))
        m1, m2 = _mon(m.group(2)), _mon(m.group(5))
        y1 = int(m.group(3)) if m.group(3) else (y2 - 1 if m1 > m2 else y2)
        return date(y1, m1, int(m.group(1))), date(y2, m2, int(m.group(4))), None
    # 1-15 November 2025
    m = re.fullmatch(rf"(\d{{1,2}}){SEP}(\d{{1,2}})\s+{MON}\.?\s+(\d{{4}})", t)
    if m:
        mo, y = _mon(m.group(3)), int(m.group(4))
        return date(y, mo, int(m.group(1))), date(y, mo, int(m.group(2))), None
    # since / from <month> <year>
    m = re.fullmatch(rf"(?:since|from|after)\s+{MON}\.?\s+(\d{{4}})", t)
    if m:
        return _month_range(int(m.group(2)), _mon(m.group(1)))[0], anchor, f"up to the latest data ({anchor})"
    m = re.fullmatch(rf"(?:until|till|up to|before|through)\s+{MON}\.?\s+(\d{{4}})", t)
    if m:
        return DATA["measured_start"], _month_range(int(m.group(2)), _mon(m.group(1)))[1], "from the start of the data"
    m = re.fullmatch(r"q([1-4])\s+(\d{4})", t)
    if m:
        q, y = int(m.group(1)), int(m.group(2))
        return _month_range(y, 3 * q - 2)[0], _month_range(y, 3 * q)[1], None
    m = re.fullmatch(r"(first|second) half(?: of)? (\d{4})", t)
    if m:
        y = int(m.group(2))
        return (date(y, 1, 1), date(y, 6, 30), None) if m.group(1) == "first" else (date(y, 7, 1), date(y, 12, 31), None)
    # month without year
    m = re.fullmatch(rf"{MON}\.?", t)
    if m:
        mo = _mon(m.group(1))
        y = _latest_year_for(mo, anchor)
        a, b = _month_range(y, mo)
        return a, b, f"year not given; taken as {calendar.month_name[mo]} {y} (latest in the data)"
    return None


def _season_words(t: str) -> str:
    """'2025 post-monsoon', 'post monsoon season of 2025', '2025-26 winter' -> '<season> <year>'."""
    t = re.sub(r"\b(pre|post)\s?-?\s?monsoon\b", r"\1-monsoon", t)
    t = re.sub(r"\brainy season\b", "monsoon", t)
    t = re.sub(r"\s+season\b", "", t)
    t = re.sub(r"^([a-z\-]+) of (\d{4}(?:[-/–]\d{2,4})?)$", r"\1 \2", t)
    m = re.fullmatch(r"(\d{4}(?:[-/–]\d{2,4})?)(?:'s)? ([a-z\-]+)", t)
    if m and m.group(2) in SEASONS:
        t = f"{m.group(2)} {m.group(1)}"
    return t


def resolve_period(text: str | None, anchor: date | None = None) -> dict:
    """Parse a period phrase. Relative phrases ('last month') are anchored to the latest measured
    data date, not today, and the answer says so."""
    if not text:
        return {"period": None}
    anchor = anchor or DATA["measured_end"]
    t = text.lower().strip().rstrip("?.!")
    t = re.sub(r"\s+", " ", t)
    t = re.sub(r"^(?:between|during|in|over|for|the)\s+", "", t)
    t = re.sub(r"\bsept\b", "sep", t)
    t = re.sub(r"^(\d{4})-(\d{2})$", lambda m: f"{calendar.month_abbr[int(m.group(2))].lower()} {m.group(1)}"
               if 1 <= int(m.group(2)) <= 12 else m.group(0), t)                      # 2025-11
    t = re.sub(r"^(\d{1,2})/(\d{4})$", lambda m: f"{calendar.month_abbr[int(m.group(1))].lower()} {m.group(2)}"
               if 1 <= int(m.group(1)) <= 12 else m.group(0), t)                      # 11/2025
    t = re.sub(r"^([a-z]+)[-,]\s*(\d{4})$", r"\1 \2", t)                              # Nov-2025, November, 2025
    t = re.sub(r"^(\d{4}-\d{2}-\d{2})\s*/\s*(\d{4}-\d{2}-\d{2})$", r"\1 to \2", t)   # ISO interval
    t = re.sub(r"^(\d{4}-\d{2}-\d{2})\s*\.\.\s*(\d{4}-\d{2}-\d{2})$", r"\1 to \2", t)  # our own payload format
    if t.startswith("from ") and re.search(r"\s(?:to|until|till|through)\s|[-–—]", t):
        t = t[5:]
    t = _season_words(t)
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
    elif t in SEASONS:                                     # season without a year: latest one with data
        sm, em, cross = SEASONS[t]
        y = anchor.year if (anchor.month >= sm or (cross and anchor.month <= em)) else anchor.year - 1
        if cross and anchor.month <= em:
            y -= 1
        start = date(y, sm, 1)
        end = date(y + 1 if cross else y, em, calendar.monthrange(y + 1 if cross else y, em)[1])
        note = (f"no year given: used the latest {t} in the data ({calendar.month_name[sm]} {y}–"
                f"{calendar.month_name[em]} {end.year})")
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
    elif (nr := _natural_range(t, anchor)) is not None:
        start, end, note = nr
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
