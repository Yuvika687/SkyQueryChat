"""Read-only data for the city pages and the Compare page. No LLM: everything here is plain Python over the app
tables, built from the same analysis functions the agent uses, so the numbers match its answers."""
from __future__ import annotations

from datetime import date, timedelta

import pandas as pd

from backend.pipeline import config as C

from . import stats as ST
from .functions import (_city_days, compare_cities, delhi_pm_context, diwali_aqi,
                        diwali_aqi_percent, explore_data, latest_city_values, unusual_days, weather_relationship)
from .result import r
from .store import Store

DIWALI_YEARS = (2024, 2025, 2026)
DATA_START = date(2025, 2, 18)          # new sensors only: never bridge the 2022-11 .. 2025-02 gap
WEATHER = {"precipitation_sum_mm": "rainfall", "wind_speed_mean_kmh": "wind speed"}


def _series(cd: pd.DataFrame, start: date, end: date) -> list[dict]:
    """One row per calendar day (None where the city has no valid value), so charts keep gaps as gaps."""
    v = cd[cd["meets_rule"]].copy()
    v["local_date"] = pd.to_datetime(v["local_date"]).dt.date
    m = dict(zip(v["local_date"], v["city_mean"]))
    n = dict(zip(v["local_date"], v["n_valid_stations"]))
    out, d = [], start
    while d <= end:
        out.append({"date": str(d), "value": r(m[d]) if d in m else None, "stations": int(n[d]) if d in n else 0})
        d += timedelta(days=1)
    return out


def _trend_out(t: dict) -> dict:
    """Trend for the page: status, days, change per month and p-value written as a short string ("< 0.001")."""
    p = t.get("p_value")
    return {"status": t["status"], "n_days": t["n_days"],
            "per_month": r(t["slope_per_month"], 1) if "slope_per_month" in t else None,
            "change_over_period": r(t["change_over_period"], 1) if "change_over_period" in t else None,
            "period_days": t.get("period_days"), "note": t.get("note"),
            "p_value": None if p is None else ("< 0.001" if p < 0.001 else f"{p:.3f}")}


def _unusual_reason(u: dict, festival: set[date]) -> str:
    """Why a day was flagged, from the flagging logic only (never a guessed cause)."""
    d = date.fromisoformat(str(u["date"]))
    parts = [f"{u['direction']}: {u['value']} µg/m³ against a 15-day median of {u['rolling_median']}"]
    if d in festival:
        parts.append("Diwali festival day")
    if u.get("peer_outlier_over_25pct"):
        parts.append("one station moved the city value by more than 25%, so treat with care")
    else:
        parts.append("seen across the city's stations, not one station")
    if u.get("data_quality") not in (None, "none"):
        parts.append(f"data quality: {u['data_quality']} gaps")
    return "; ".join(parts)


def city_page(s: Store, city: str, latest: dict | None = None, explore: dict | None = None) -> dict:
    """latest ({"pm25": ..., "pm10": ...}) and explore (PM2.5) may be passed in from the API's caches."""
    latest = latest or {p: latest_city_values(s, p) for p in ("pm25", "pm10")}
    end = date.fromisoformat(latest["pm25"]["date"])
    start30 = end - timedelta(days=29)
    hero = next(c for c in latest["pm25"]["cities"] if c["city"] == city)
    rank = [c["city"] for c in latest["pm25"]["cities"]].index(city) + 1

    trend = {p: _series(_city_days(s, city, p, start30, end), start30, end) for p in ("pm25", "pm10")}
    t30 = ST.trend([date.fromisoformat(x["date"]) for x in trend["pm25"] if x["value"] is not None],
                   [x["value"] for x in trend["pm25"] if x["value"] is not None], start30, end)

    # calendar: every day with PM2.5 data since the new sensors began (the 2022-2025 gap is never bridged)
    allc = _city_days(s, city, "pm25", DATA_START, end)
    first = pd.to_datetime(allc.loc[allc["meets_rule"], "local_date"]).min().date()
    calendar = _series(allc, first.replace(day=1), end)

    diwali = diwali_aqi(s, city, DIWALI_YEARS).to_dict()
    years = []
    for y in diwali["values"]["years"]:
        row = {"year": y["year"], "status": y["status"], "diwali_date": y.get("diwali_date"),
               "level": y.get("festival_level_aqi"), "category": y.get("festival_level_category"),
               "week_before": y.get("pre_festival_week_aqi"),
               "bulletins": [{"date": b["bulletin_date"], "evening_of": b["evening_of"], "period": b["reporting_period"],
                              "aqi": b["aqi"], "category": b["category"], "source": b["source"]}
                             for b in y.get("festival_bulletins", [])]}
        if y["status"] == "ok":
            pc = diwali_aqi_percent(s, city, y["year"]).to_dict()["values"]
            if pc.get("status") == "ok":            # always a range across the three baseline weeks
                ps = [w["percent_change"] for w in pc["windows"]]
                row["change_range_pct"] = [min(ps), max(ps)]
        years.append(row)
    pm_context = None
    if city == "Delhi":
        pm_context = []
        for y in DIWALI_YEARS:
            try:
                d = delhi_pm_context(s, y).to_dict()
            except Exception:                          # a year without data simply has no context row
                continue
            pols = {x["pollutant"]: x for x in d["values"].get("pollutants", [])}
            pm25 = pols.get("pm25") or {}
            pm_context.append({
                "year": y, "source": d["source"], "warnings": d["warnings"][:2],
                "festival_pm25": pm25.get("festival_mean_lower_bound", pm25.get("festival_mean")),
                "lower_bound": "festival_mean_lower_bound" in pm25, "stations": pm25.get("panel_stations"),
                "blank_share_diwali_night": pm25.get("blank_share_diwali_night"),
                "comparable_with_earlier_years": d["values"].get("comparable_with_2024_2025", True)})

    festival = {date.fromisoformat(y["diwali_date"]) + timedelta(days=k) for y in years if y.get("diwali_date") for k in (0, 1)}
    un = unusual_days(s, city, "pm25", first, end).to_dict()
    unusual = [{"date": str(u["date"]), "value": u["value"], "median": u["rolling_median"], "direction": u["direction"],
                "reason": _unusual_reason(u, festival)}
               for u in sorted(un["values"].get("unusual_days", []), key=lambda u: str(u["date"]), reverse=True)[:12]]

    weather = {}
    for var, name in WEATHER.items():
        w = weather_relationship(s, city, "pm25", var, first, end).to_dict()
        v = w["values"]
        weather[name] = {"rho": v["spearman_rho"], "range": [v.get("rho_range95_low"), v.get("rho_range95_high")],
                         "strength": v["strength"], "days": v["n_days"], "statement": v["statement"],
                         "groups": [{"label": g.get("label") or g["group"], "days": g["n_days"], "mean": g["mean_pm"]}
                                    for g in v["groups"]], "chart": w["chart"], "source": w["source"]}

    ex = explore or explore_data(s, "pm25")
    stations = []
    for st in ex["stations"]:
        if st["city"] != city:
            continue
        have = sum(v is not None for v in st["values"])
        stations.append({"id": st["id"], "name": st["name"], "provider": st["provider"], "tier": st["tier"],
                         "type": st["type"], "coverage_pct": r(100 * have / len(st["values"]), 0),
                         "latest": next((v for v in reversed(st["values"]) if v is not None), None)})
    stations.sort(key=lambda x: (x["tier"] != "primary", -(x["coverage_pct"] or 0), x["name"]))

    return {
        "city": city, "date": str(end), "units": "µg/m³", "source": latest["pm25"]["source"],
        "hero": {"pm25": hero["value"], "pm10": next(c["value"] for c in latest["pm10"]["cities"] if c["city"] == city),
                 "stations_reporting": hero["stations_reporting"], "stations_total": hero["stations_total"],
                 "rank_of_six": rank, "date": str(end)},
        "trend30": {"start": str(start30), "end": str(end), **trend,
                    "trend": _trend_out(t30)},
        "calendar": {"start": calendar[0]["date"], "end": str(end), "days": calendar},
        "diwali": {"years": years, "source": diwali["source"], "pm_context": pm_context,
                   "note": "Official AQI from CPCB's 4 PM bulletins: each bulletin covers 4 PM the day before to 4 PM "
                           "on its date, so Diwali night appears in the next day's bulletin."},
        "unusual": {"days": unusual, "tested": un["values"].get("n_days_tested"), "method": un["method"]},
        "weather": weather,
        "stations": stations,
    }


def compare_page(s: Store, cities: list[str], metric: str, start: date, end: date) -> dict:
    """Daily lines on matching dates, ranking with 95% ranges, and each city's trend. metric: pm25, pm10 or aqi."""
    days = (end - start).days + 1
    if metric == "aqi":
        q = s.q("SELECT city, bulletin_date AS d, aqi FROM city_daily_aqi WHERE bulletin_date BETWEEN ? AND ? "
                "AND city IN (" + ",".join("?" * len(cities)) + ")", [start, end, *cities])
        q["d"] = pd.to_datetime(q["d"]).dt.date
        series = {c: {d: v for d, v in zip(q[q.city == c].d, q[q.city == c].aqi) if pd.notna(v)} for c in cities}
        common = set.intersection(*(set(v) for v in series.values())) if series else set()
        rows = []
        for c in cities:
            vals = [series[c][d] for d in sorted(common)]
            ci = ST.block_bootstrap_ci(sorted(common), vals) if vals else None
            rows.append({"city": c, "mean": r(sum(vals) / len(vals)) if vals else None,
                         "range95": [r(ci[0]), r(ci[1])] if ci else None, "valid_days": len(series[c]),
                         "coverage_pct": r(100 * len(series[c]) / days, 1)})
        rows.sort(key=lambda x: (x["mean"] is None, -(x["mean"] or 0)))
        close = []
        for a, b in zip(rows, rows[1:]):
            if a["range95"] and b["range95"] and ST.ranges_overlap_heavily(tuple(a["range95"]), tuple(b["range95"])):
                close.append([a["city"], b["city"]])
        res = {"cities": rows, "common_days": len(common), "too_close_to_call": close,
               "units": "AQI (index)", "data_type": "official AQI", "source": "CPCB daily AQI bulletins (4 PM)"}
        raw = {c: series[c] for c in cities}
    else:
        cc = compare_cities(s, cities, metric, start, end).to_dict()
        v = cc["values"]
        res = {"cities": [{"city": x["city"], "mean": x["mean_common_days"],
                           "range95": [x["range95_low"], x["range95_high"]] if x["range95_low"] is not None else None,
                           "valid_days": x["n_valid_days"], "coverage_pct": x["coverage_pct"]} for x in v["cities"]],
               "common_days": v["common_days"], "too_close_to_call": v["too_close_to_call"], "units": "µg/m³",
               "data_type": "measured", "source": cc["source"]}
        raw = {}
        for c in cities:
            cd = _city_days(s, c, metric, start, end)
            ok = cd[cd["meets_rule"]]
            raw[c] = {pd.to_datetime(d).date(): x for d, x in zip(ok["local_date"], ok["city_mean"])}
    dates = [start + timedelta(days=i) for i in range(days)]
    res["dates"] = [str(d) for d in dates]
    res["lines"] = {c: [r(raw[c][d]) if d in raw[c] else None for d in dates] for c in cities}
    for row in res["cities"]:
        pts = sorted(raw[row["city"]].items())
        t = ST.trend([d for d, _ in pts], [x for _, x in pts], start, end)
        row["trend"] = _trend_out(t)
        row["low_coverage"] = (row["coverage_pct"] or 0) < 50
    res.update({"metric": metric, "start": str(start), "end": str(end), "days": days,
                "method": "Ranking uses days on which every selected city has a value. 95% range: weekly block "
                          "bootstrap of those daily values. Trend: Mann-Kendall test with Sen's slope (at least 20 "
                          "days; 'no clear trend' when p is 0.05 or more)."})
    return res


def periods(s: Store) -> dict:
    """Compare page presets, limited to dates that exist in the data."""
    end = date.fromisoformat(latest_city_values(s, "pm25")["date"])
    pre = [
        {"id": "30d", "label": "Last 30 days", "start": end - timedelta(days=29), "end": end},
        {"id": "90d", "label": "Last 90 days", "start": end - timedelta(days=89), "end": end},
        {"id": "winter-2025-26", "label": "Winter 2025–26", "start": date(2025, 12, 1), "end": date(2026, 2, 28)},
        {"id": "post-monsoon-2025", "label": "Post-monsoon 2025", "start": date(2025, 10, 1), "end": date(2025, 11, 30)},
    ]
    for y in (2025, 2026):
        d = C.diwali_date(y)
        if d + timedelta(days=7) <= end or y == 2026:
            pre.append({"id": f"diwali-{y}", "label": f"Diwali {y} (two weeks)", "start": d - timedelta(days=7),
                        "end": min(d + timedelta(days=7), end)})
    return {"data_start": str(DATA_START), "data_end": str(end),
            "presets": [{**p, "start": str(p["start"]), "end": str(p["end"])} for p in pre]}

