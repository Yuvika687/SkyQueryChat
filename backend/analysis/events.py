"""Official AQI on any occasion: a festival or holiday (Holi, Dussehra, Chhath, Eid, Christmas, New Year...), any
date ("9 November", "2026-03-04") or a short span of days, for ANY city in CPCB's daily bulletin.

Bulletin alignment (same rule as Diwali): the bulletin dated X averages 4 PM on X-1 to 4 PM on X. A local day D is
therefore covered by the bulletins dated D (the day itself, up to 4 PM) and D+1 (its evening and night). The occasion
level is the mean of the bulletins dated D_start .. D_end+1. Context: the mean of the 7 bulletins before (D-7..D-1)
and the change from it in AQI points (never a cause). Python calculates every number; nothing is filled in.
"""
from __future__ import annotations

import calendar
import json
import re
from dataclasses import dataclass
from datetime import date, timedelta
from functools import lru_cache
from pathlib import Path

import pandas as pd

from .aqi import category
from .result import AQI_COLOURS, AnalysisResult, ChartSpec, r
from .store import Store

CONFIG = Path(__file__).resolve().parents[1] / "config"
METROS = ("Delhi", "Mumbai", "Kolkata", "Chennai", "Bengaluru", "Hyderabad")
UNITS = "index (0-500)"
MAX_SPAN_DAYS = 31
MAX_OCCASIONS = 4
MONTHS = {m.lower(): i for i, m in enumerate(calendar.month_abbr) if m} | \
         {m.lower(): i for i, m in enumerate(calendar.month_name) if m} | {"sept": 9}


@dataclass
class Occasion:
    name: str               # "Holi 2026", "9 Nov 2026"
    start: date             # first local day
    end: date               # last local day
    note: str | None = None


@lru_cache(maxsize=1)
def calendar_() -> dict:
    fest = json.loads((CONFIG / "festivals.json").read_text(encoding="utf-8"))
    ev = json.loads((CONFIG / "events.json").read_text(encoding="utf-8"))
    fest["lunar"]["diwali"] = {"name": "Diwali", "aliases": ["diwali", "deepavali", "deepawali", "dipawali"],
                               "dates": {y: v["date"] for y, v in ev["diwali"].items()},
                               "note": "Diwali night is reported in the next day's bulletin."}
    return fest


def _norm(t: str) -> str:
    t = re.sub(r"[’'`]", "'", t.lower())
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9' ]+", " ", t)).strip()


def find_event(text: str) -> tuple[str, dict, bool] | None:
    """(key, spec, is_fixed) of the festival named in `text`, longest alias first."""
    t = _norm(text)
    best = None
    for fixed, group in ((True, calendar_()["fixed"]), (False, calendar_()["lunar"])):
        for k, spec in group.items():
            for a in [spec["name"]] + spec.get("aliases", []):
                a = _norm(a)
                if a and re.search(rf"\b{re.escape(a)}\b", t) and (best is None or len(a) > best[0]):
                    best = (len(a), k, spec, fixed)
    return (best[1], best[2], best[3]) if best else None


def known_events() -> list[str]:
    c = calendar_()
    return sorted({s["name"] for s in c["fixed"].values()} | {s["name"] for s in c["lunar"].values()})


def event_occasions(text: str, years: list[int] | None, first: date, last: date) -> list[Occasion]:
    hit = find_event(text)
    if not hit:
        raise ValueError(f"'{text}' is not in the festival calendar. Known: {', '.join(known_events())}. "
                         "Any date also works, e.g. '9 November 2026'.")
    key, spec, fixed = hit
    span = int(spec.get("days", 1))
    out = []
    if fixed:
        ys = years or [y for y in range(last.year, first.year - 1, -1)
                       if first <= date(y, spec["month"], spec["day"]) <= last][:3]
        for y in ys:
            d = date(y, spec["month"], spec["day"])
            out.append(Occasion(f"{spec['name']} {y}", d, d + timedelta(days=span - 1), spec.get("note")))
    else:
        dates = {int(y): date.fromisoformat(v) for y, v in spec["dates"].items()}
        ys = years or [y for y in sorted(dates, reverse=True) if first <= dates[y] <= last][:3] \
            or [max(dates)]
        for y in ys:
            if y not in dates:
                raise ValueError(f"{spec['name']} {y} is not in the festival calendar (years: "
                                 f"{', '.join(str(x) for x in sorted(dates))}). Give the date instead, e.g. "
                                 f"'{spec['name']} on 2026-03-04'.")
            d = dates[y]
            note = spec.get("note")
            if spec.get("moon"):
                note = ((note + " ") if note else "") + "Moon-dependent: the date can differ by a day by region."
            out.append(Occasion(f"{spec['name']} {y}", d, d + timedelta(days=span - 1), note))
    return sorted(out, key=lambda o: o.start)


def _day_month(t: str) -> tuple[int, int] | None:
    m = re.fullmatch(r"(\d{1,2})(?:st|nd|rd|th)?(?: of)? ([a-z]+)", t) or \
        re.fullmatch(r"([a-z]+) (\d{1,2})(?:st|nd|rd|th)?", t)
    if not m:
        return None
    a, b = m.groups()
    day, mon = (a, b) if a.isdigit() else (b, a)
    return (int(day), MONTHS[mon]) if mon in MONTHS else None


def date_occasions(texts: list[str], years: list[int] | None, last: date) -> list[Occasion]:
    from backend.agent import resolver as R
    out = []
    for raw in texts:
        t = _norm(raw).replace("'", "")
        dm = _day_month(t)
        if dm:                                    # "9 November": the year(s) asked, else the latest one with data
            day, mon = dm
            ys = years or [last.year if date(last.year, mon, day) <= last else last.year - 1]
            for y in ys:
                d = date(y, mon, day)
                out.append(Occasion(f"{d.day} {d:%b %Y}", d, d,
                                    None if years else f"year not given: used {y}, the latest with data"))
            continue
        p = R.resolve_period(raw, anchor=last)
        if not p.get("start"):
            raise ValueError(f"Could not read the date '{raw}'. Use e.g. '9 November 2026' or '2026-11-09'.")
        s, e = date.fromisoformat(p["start"]), date.fromisoformat(p["end"])
        if (e - s).days + 1 > MAX_SPAN_DAYS:
            raise ValueError(f"'{raw}' covers {(e - s).days + 1} days; for periods longer than {MAX_SPAN_DAYS} "
                             "days use official_aqi with a period.")
        name = f"{s.day} {s:%b %Y}" if s == e else f"{s.day} {s:%b} to {e.day} {e:%b %Y}"
        out.append(Occasion(name, s, e, "; ".join(p.get("notes") or []) or None))
    return sorted(out, key=lambda o: o.start)


def series(store: Store, city: str) -> pd.DataFrame:
    """One row per bulletin date. The six metros use the long city_daily_aqi table (from 2015), topped up with
    city_aqi_all; every other bulletin city uses city_aqi_all."""
    cols = ["bulletin_date", "aqi", "aqi_category", "prominent_pollutant", "no_stations", "source"]
    parts = []
    if city in METROS and "city_daily_aqi" in store.tables:
        t = store.tables["city_daily_aqi"]
        parts.append(t[t["city"] == city][[c for c in cols if c in t]])
    if "city_aqi_all" in store.tables:
        t = store.tables["city_aqi_all"]
        parts.append(t[t["city"] == city][[c for c in cols if c in t]])
    if not parts:
        return pd.DataFrame(columns=cols)
    g = pd.concat(parts, ignore_index=True)
    g["bulletin_date"] = pd.to_datetime(g["bulletin_date"]).dt.date
    g = g.dropna(subset=["aqi"]).drop_duplicates("bulletin_date", keep="first")
    return g.sort_values("bulletin_date").reset_index(drop=True)


def _txt(x):
    return None if x is None or (isinstance(x, float) and pd.isna(x)) or str(x).lower() in ("nan", "none", "") \
        else str(x)


def _covers(b: date) -> str:
    p = b - timedelta(days=1)
    return f"4 PM {p.day} {p:%b} to 4 PM {b.day} {b:%b %Y}"


def occasion_aqi(store: Store, city: str, occasions: list[Occasion]) -> AnalysisResult:
    g = series(store, city)
    if g.empty:
        raise ValueError(f"No official AQI for {city} in the bulletin data.")
    first, last = g["bulletin_date"].min(), g["bulletin_date"].max()
    by = {d: row for d, row in zip(g["bulletin_date"], g.itertuples(index=False))}
    years = [o.start.year for o in occasions]
    unique_years = len(set(years)) == len(years)
    out, chart_series, bands, notes = [], [], [], []
    for o in occasions[:MAX_OCCASIONS]:
        key = str(o.start.year) if unique_years else f"{o.start:%Y_%m_%d}"
        span = (o.end - o.start).days
        bds = [o.start + timedelta(days=k) for k in range(span + 2)]           # D_start .. D_end+1
        rec = {"key": key, "occasion": o.name, "local_days": [str(o.start), str(o.end)]}
        if o.note:
            rec["date_note"] = o.note
            notes.append(f"{o.name}: {o.note}")
        if o.start > last:
            rec |= {"status": "not_yet", "message": f"{o.name} ({o.start}) is after the latest bulletin for {city} "
                                                     f"({last}), so its AQI is not available yet."}
            out.append(rec)
            continue
        if o.end + timedelta(days=1) < first:
            rec |= {"status": "not_available", "message": f"The app's bulletins for {city} start on "
                                                           f"{first.day} {first:%b %Y}, so {o.name} is not covered."}
            out.append(rec)
            continue
        bul = [{"bulletin_date": str(b), "covers": _covers(b),
                "period": f"{b - timedelta(days=1)} 16:00 to {b} 16:00 IST", "aqi": int(by[b].aqi),
                "category": _txt(by[b].aqi_category) or category(by[b].aqi),
                "main_pollutant": _txt(by[b].prominent_pollutant),
                "stations": int(by[b].no_stations) if pd.notna(by[b].no_stations) else None}
               for b in bds if b in by]
        missing = [str(b) for b in bds if b not in by and b <= last]
        if not bul:
            before = next((b for b in sorted(by, reverse=True) if b < bds[0]), None)
            after = next((b for b in sorted(by) if b > bds[-1]), None)
            near = [f"{b} (AQI {int(by[b].aqi)})" for b in (before, after)
                    if b is not None and abs((b - o.start).days) <= 10]
            rec |= {"status": "not_available", "message": f"CPCB published no bulletin value for {city} on {o.name} "
                                                           f"(bulletins {bds[0]} to {bds[-1]} are missing)."
                                                           + (f" Nearest bulletins: {', '.join(near)}." if near else "")}
            out.append(rec)
            continue
        level = sum(b["aqi"] for b in bul) / len(bul)
        pre = [int(by[o.start - timedelta(days=k)].aqi) for k in range(1, 8) if o.start - timedelta(days=k) in by]
        pre_mean = sum(pre) / len(pre) if len(pre) >= 4 else None
        hi = max(bul, key=lambda b: b["aqi"])
        rec |= {"status": "ok", "bulletins": bul, "missing_bulletins": missing,
                "level_aqi": r(level), "level_category": category(level),
                "highest_bulletin": {"date": hi["bulletin_date"], "aqi": hi["aqi"], "category": hi["category"]},
                "week_before_aqi": r(pre_mean) if pre_mean is not None else None,
                "n_week_before_bulletins": len(pre),
                "change_vs_week_before": r(level - pre_mean) if pre_mean is not None else None}
        out.append(rec)
        pts = []
        for k in range(-7, span + 4):
            b = o.start + timedelta(days=k)
            if b in by:
                pts.append({"x": k, "aqi": int(by[b].aqi), "category": _txt(by[b].aqi_category) or category(by[b].aqi),
                            "bulletin_date": str(b), "reporting_period": _covers(b)})
        chart_series.append({"name": o.name, "data": pts})
        bands.append({"label": f"{o.name} bulletins ({bds[0]} to {bds[-1]})", "start": 0, "end": span + 1})
    ok = [x for x in out if x["status"] == "ok"]
    warns = ["This is official AQI (an index of several pollutants), not a PM2.5 or PM10 concentration.",
             "Each bulletin covers 4 PM on the previous day to 4 PM on its date, so a day's evening and night are "
             "reported in the next day's bulletin; both are included in the occasion level.",
             "A change around an occasion can come from weather, crop burning or traffic as well; it is not proof "
             "that the occasion caused it."]
    if city not in METROS:
        warns.append("Station-level PM2.5 and PM10 analysis covers only Delhi, Mumbai, Kolkata, Chennai, Bengaluru "
                     "and Hyderabad; for this city the app has CPCB's official AQI only.")
    if any(x.get("missing_bulletins") for x in ok):
        warns.append("Some bulletin days are missing; they are left as gaps, never filled in.")
    warns += notes
    for x in out:
        if x["status"] != "ok":
            warns.append(x["message"])
    span_lo = min(o.start for o in occasions) - timedelta(days=7)
    span_hi = max(o.end for o in occasions) + timedelta(days=4)
    title = ", ".join(o.name for o in occasions[:MAX_OCCASIONS])
    chart = ChartSpec(type="line", title=f"{city}: official CPCB AQI around {title}",
                      x={"field": "x", "label": "Bulletin day relative to the occasion (0 = the day itself; "
                                                "each bulletin = 24 h to 4 PM IST)",
                         "tooltip_fields": ["bulletin_date", "reporting_period", "category"]},
                      y={"field": "aqi", "label": "AQI (index)"}, series=chart_series, units=UNITS, bands=bands,
                      colour_scale="cpcb_aqi",
                      notes=["Each point is one CPCB bulletin: the 24 hours from 4 PM the previous day to 4 PM on "
                             "the bulletin date.", f"AQI category colours: {AQI_COLOURS}"]) if chart_series else None
    srcs = sorted({str(s) for s in g["source"].dropna().unique()}) if "source" in g else []
    return AnalysisResult(
        kind="occasion_aqi", title=f"Official AQI in {city}: {title}", metric="aqi", units=UNITS,
        data_type="official measured AQI (city average)",
        source="; ".join(srcs) or "CPCB daily AQI bulletin",
        date_range={"start": str(max(span_lo, first)), "end": str(min(span_hi, last))},
        stations={"bulletin_station_counts": [b["stations"] for x in ok for b in x["bulletins"]],
                  "note": "stations chosen by CPCB for the city bulletin"},
        coverage={"occasions_available": [x["occasion"] for x in ok], "bulletins_from": str(first),
                  "bulletins_to": str(last)},
        quality={"note": "Bulletins are published by CPCB."},
        method="Bulletin dated X = 4 PM X-1 to 4 PM X. Occasion level = mean of the bulletins dated from the first "
               "day to the day after the last day (covers the day and its night). Week before = mean of the 7 "
               "bulletins before the first day (at least 4 needed). Change = level minus week before, in AQI points.",
        warnings=warns, values={"city": city, "is_metro": city in METROS, "occasions": out}, chart=chart)
