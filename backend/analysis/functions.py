"""Deterministic analysis functions. Python computes every number; results carry data type,
source, dates, stations, valid coverage, quality, warnings and units.

Default analysis rule (approved data design): city values use primary reference stations,
equal weights, >= max(3, ceil(50%)) valid stations; hours flagged flat-line/isolated spike and
physically impossible PM2.5 > PM10 station-days are excluded (still stored).
"""
from __future__ import annotations

from datetime import date, timedelta

import numpy as np
import pandas as pd

from backend.pipeline import config as C
from .aqi import category
from .result import AQI_COLOURS, AnalysisResult, ChartSpec, r
from .store import Store
from . import stats as ST

SRC_OPENAQ = "OpenAQ archive (CPCB/AirNow/AirGradient)"
SRC_BULLETIN = "CPCB daily AQI bulletin (via UrbanEmissions)"
PM_UNITS = "µg/m³"
POLLUTANT_NAMES = {"pm25": "PM2.5", "pm10": "PM10"}
WEATHER_VARS = {"temperature_mean_c": ("temperature", "°C"), "relative_humidity_mean_pct": ("relative humidity", "%"),
                "wind_speed_mean_kmh": ("wind speed", "km/h"), "precipitation_sum_mm": ("rainfall", "mm")}
DATA_START = date(2025, 2, 18)
SEVERITY_RANK = {"none": 0, "minor": 1, "moderate": 2, "severe": 3, "not_yet_published": 4}

# Diwali percentage change (approved 2026-11-04): NEVER in the default answer. Only when a user asks,
# via diwali_aqi_percent(): baseline W2 (D-7..D-1); a single figure only if W1, W2, W3 agree within
# 25 percentage points, otherwise a range.
APPROVED_DIWALI_BASELINE: str | None = None        # default diwali_aqi() keeps percentages withheld
PERCENT_BASELINE = "W2_d7_d1"
PERCENT_STABILITY_WINDOWS = ("W1_d14_d8", "W2_d7_d1", "W3_d3_d1")
PERCENT_MAX_SPREAD_PP = 25.0
CAUSAL_WARNING = ("Do not read this as Diwali causing the change: AQI often rises through October and November "
                  "for seasonal reasons, and other weather and emission changes happen at the same time.")


def _period_label(bulletin_date) -> str:
    b = pd.Timestamp(bulletin_date).date()
    return f"{b - timedelta(days=1)} 16:00 to {b} 16:00 IST"


def _pre_trend(g: pd.DataFrame) -> dict:
    """Was AQI already rising before the festival? Mean of evenings D-7..D-5 vs D-3..D-1."""
    early = g[(g["offset_days"] >= -7) & (g["offset_days"] <= -5)]["aqi"]
    late = g[(g["offset_days"] >= -3) & (g["offset_days"] <= -1)]["aqi"]
    if early.isna().any() or late.isna().any() or early.empty or late.empty:
        return {"pre_festival_trend": None}
    e, l_ = float(early.mean()), float(late.mean())
    t = "rising" if l_ > e * 1.1 else "falling" if l_ < e * 0.9 else "flat"
    return {"pre_festival_trend": t, "aqi_d7_to_d5_mean": r(e), "aqi_d3_to_d1_mean": r(l_)}


# ----------------------------------------------------------------------------- helpers
def _d(x) -> str | None:
    """ISO date string from date/Timestamp/str (no time part)."""
    return None if x is None or (isinstance(x, float) and np.isnan(x)) else pd.Timestamp(x).date().isoformat()


def _check(city: str | None = None, pollutant: str | None = None):
    if city is not None and city not in C.CITIES:
        raise ValueError(f"Unknown city {city!r}; choose from {C.CITIES}")
    if pollutant is not None and pollutant not in C.POLLUTANTS:
        raise ValueError(f"Unknown pollutant {pollutant!r}; choose from {list(C.POLLUTANTS)}")


def _primary_stations(s: Store, city: str) -> pd.DataFrame:
    return s.q("SELECT DISTINCT location_id, station_name FROM stations WHERE city=? AND tier='primary' "
               "ORDER BY location_id", [city])


def _city_days(s: Store, city: str, pollutant: str, start: date, end: date) -> pd.DataFrame:
    return s.q("SELECT * FROM city_daily WHERE city=? AND pollutant=? AND local_date BETWEEN ? AND ? "
               "ORDER BY local_date", [city, pollutant, start, end])


def _quality(s: Store, cities: list[str], start: date, end: date) -> dict:
    dq = s.q("SELECT city, local_date, severity, gap_hours, extent FROM date_quality "
             "WHERE source=? AND city IN (SELECT UNNEST(?)) AND local_date BETWEEN ? AND ?",
             [SRC_OPENAQ, cities, start, end])
    counts = dq.groupby("severity").size().to_dict() if not dq.empty else {}
    worst = max(dq["severity"], key=lambda x: SEVERITY_RANK.get(x, 0)) if not dq.empty else "none"
    severe = sorted({str(d) for d in dq.loc[dq["severity"] == "severe", "local_date"]})
    return {"severity_counts": counts, "worst_severity": worst, "severe_dates": severe[:50],
            "n_severe_dates": len(severe)}


def _common_warnings(start: date, end: date, quality: dict, data_end: date | None) -> list[str]:
    w = []
    if start < DATA_START:
        w.append(f"No measured OpenAQ data before {DATA_START} in this dataset (CPCB data gap "
                 "Nov 2022 - Feb 2025); results start at {DATA_START}.".replace("{DATA_START}", str(DATA_START)))
    if data_end and end > data_end:
        w.append(f"Data after {data_end} is not yet published by the source.")
    if quality.get("n_severe_dates"):
        w.append(f"{quality['n_severe_dates']} date(s) in this period have severe network-wide data gaps; "
                 "values on those dates are less reliable.")
    return w


def _peer_warning(cd: pd.DataFrame) -> list[str]:
    """Warn when a flag-only peer-outlier station moves a city value by more than 25%."""
    if cd.empty or "peer_outlier_major" not in cd:
        return []
    m = cd[cd["peer_outlier_major"].fillna(False).astype(bool)]
    if m.empty:
        return []
    ex = ", ".join(f"{_d(d)} ({e:+.0f}%)" for d, e in zip(m["local_date"].head(5), m["peer_outlier_effect_pct"].head(5)))
    return [f"On {len(m)} day(s) one station flagged as a peer outlier moves the city value by more than 25% "
            f"(e.g. {ex}); treat those days with caution."]


def _is_major(cd: pd.DataFrame, d) -> bool:
    if "peer_outlier_major" not in cd:
        return False
    x = cd.loc[pd.to_datetime(cd["local_date"]) == pd.Timestamp(d), "peer_outlier_major"]
    return bool(x.fillna(False).any())


def _data_end(s: Store) -> date | None:
    d = s.q("SELECT MAX(local_date) AS d FROM date_quality WHERE source=? AND severity <> 'not_yet_published'",
            [SRC_OPENAQ])["d"].iat[0]
    return pd.Timestamp(d).date() if pd.notna(d) else None


def _coverage_block(cd: pd.DataFrame, start: date, end: date) -> dict:
    n_days = (end - start).days + 1
    valid = int(cd["meets_rule"].sum()) if not cd.empty else 0
    return {"days_in_period": n_days, "days_with_city_value": valid,
            "share_of_days_with_city_value": r(valid / n_days if n_days else np.nan, 3),
            "mean_valid_stations": r(cd.loc[cd["meets_rule"], "n_valid_stations"].mean() if valid else np.nan, 1),
            "flagged_hours_excluded": int(cd["n_flagged_hours_excluded"].fillna(0).sum()) if not cd.empty else 0,
            "impossible_pm25_gt_pm10_station_days_excluded":
                int(cd["n_pm25_gt_pm10_excluded"].fillna(0).sum()) if not cd.empty else 0}


# ----------------------------------------------------------------------------- 1. trend
def city_trend(s: Store, city: str, pollutant: str, start: date, end: date, freq: str = "M") -> AnalysisResult:
    """Daily city values aggregated to D (daily), W (weekly) or M (monthly) means of valid days."""
    _check(city, pollutant)
    if freq not in ("D", "W", "M"):
        raise ValueError("freq must be D, W or M")
    cd = _city_days(s, city, pollutant, start, end)
    v = cd[cd["meets_rule"]].copy()
    v["local_date"] = pd.to_datetime(v["local_date"])
    periods = []
    if not v.empty:
        key = {"D": v["local_date"].dt.to_period("D"), "W": v["local_date"].dt.to_period("W-SUN"),
               "M": v["local_date"].dt.to_period("M")}[freq]
        for p, g in v.groupby(key):
            days_in = (min(p.end_time.date(), end) - max(p.start_time.date(), start)).days + 1
            periods.append({"period": str(p), "start": max(p.start_time.date(), start),
                            "mean": r(g["city_mean"].mean()), "n_valid_days": int(len(g)),
                            "days_in_period": days_in, "coverage": r(len(g) / days_in, 3)})
    summary = {}
    if not v.empty:
        imax, imin = v["city_mean"].idxmax(), v["city_mean"].idxmin()
        summary = {"mean_of_daily_values": r(v["city_mean"].mean()), "median": r(v["city_mean"].median()),
                   "highest_day": {"date": v.at[imax, "local_date"].date(), "value": r(v.at[imax, "city_mean"]),
                                   "peer_outlier_over_25pct": _is_major(cd, v.at[imax, "local_date"])},
                   "lowest_day": {"date": v.at[imin, "local_date"].date(), "value": r(v.at[imin, "city_mean"]),
                                  "peer_outlier_over_25pct": _is_major(cd, v.at[imin, "local_date"])}}
    tr = ST.trend(list(v["local_date"].dt.date), list(v["city_mean"]), start, end) if not v.empty else \
        {"status": "not enough data", "n_days": 0, "min_days": ST.MIN_TREND_DAYS}
    if "slope_per_month" in tr:
        tr["slope_per_month"] = r(tr["slope_per_month"], 2)
        if "change_over_period" in tr:
            tr["change_over_period"] = r(tr["change_over_period"], 1)
        tr["p_value"] = r(tr["p_value"], 3) if tr["p_value"] >= 0.001 else "< 0.001"
    summary["trend"] = tr
    if (end - start).days > 120 and tr.get("status") in ("increasing", "decreasing"):
        tr["note"] = "covers more than one season, so the trend mixes seasonal change with any longer-term change"
    q = _quality(s, [city], start, end)
    warns = _common_warnings(start, end, q, _data_end(s)) + _peer_warning(cd)
    low = [p["period"] for p in periods if p["coverage"] is not None and p["coverage"] < 0.7]
    if low:
        warns.append(f"Periods with < 70% of days having a city value: {', '.join(low[:12])}.")
    if v.empty:
        warns.append("No valid city values in this period.")
    st = _primary_stations(s, city)
    chart = ChartSpec(type="line", title=f"{city} {POLLUTANT_NAMES[pollutant]} ({ {'D': 'daily', 'W': 'weekly', 'M': 'monthly'}[freq]} mean)",
                      x={"field": "period", "type": "time" if freq == "D" else "category"},
                      y={"field": "mean", "label": f"{POLLUTANT_NAMES[pollutant]} ({PM_UNITS})"},
                      series=[{"name": city, "data": [[p["period"], p["mean"]] for p in periods]}], units=PM_UNITS)
    return AnalysisResult(
        kind="city_trend", title=f"{POLLUTANT_NAMES[pollutant]} trend in {city}", metric=pollutant, units=PM_UNITS,
        data_type="measured", source=SRC_OPENAQ, date_range={"start": str(start), "end": str(end)},
        stations={"count": int(len(st)), "location_ids": st["location_id"].tolist(), "tier": "primary reference"},
        coverage=_coverage_block(cd, start, end), quality=q,
        method="City value per day = equal-weight mean of valid primary station-days (>= 16 valid IST hours; "
               ">= max(3, 50%) stations). Period value = mean of days with a city value. Trend: Mann-Kendall test "
               "with Sen's slope on the daily values (direction only when p < 0.05; at least 20 days).",
        warnings=warns, values={"freq": freq, "periods": periods, "summary": summary}, chart=chart)


# ----------------------------------------------------------------------------- 2. compare
def compare_cities(s: Store, cities: list[str], pollutant: str, start: date, end: date) -> AnalysisResult:
    """Compare cities on days where EVERY city has a city value (fair), plus all-valid-day means."""
    _check(pollutant=pollutant)
    for c in cities:
        _check(c)
    frames = {c: _city_days(s, c, pollutant, start, end) for c in cities}
    valid = {c: set(f.loc[f["meets_rule"], "local_date"]) for c, f in frames.items()}
    common = set.intersection(*valid.values()) if valid else set()
    rows = []
    days = (end - start).days + 1
    for c, f in frames.items():
        v = f[f["meets_rule"]]
        cm = v[v["local_date"].isin(common)]
        ci = ST.block_bootstrap_ci(list(pd.to_datetime(cm["local_date"]).dt.date), list(cm["city_mean"])) if len(cm) else None
        rows.append({"city": c, "mean_common_days": r(cm["city_mean"].mean()),
                     "median_common_days": r(cm["city_mean"].median()),
                     "range95_low": r(ci[0]) if ci else None, "range95_high": r(ci[1]) if ci else None,
                     "mean_all_valid_days": r(v["city_mean"].mean()), "n_valid_days": int(len(v)),
                     "coverage_pct": r(100 * len(v) / days, 1)})
    ranked = sorted(rows, key=lambda x: (x["mean_common_days"] is None, -(x["mean_common_days"] or 0)))
    for i, row in enumerate(ranked, 1):
        row["rank_highest_first"] = i if row["mean_common_days"] is not None else None
    # neighbours in the ranking whose 95% ranges overlap heavily are "too close to call"
    close = []
    for a, b in zip(ranked, ranked[1:]):
        if None in (a["range95_low"], b["range95_low"]):
            continue
        if ST.ranges_overlap_heavily((a["range95_low"], a["range95_high"]), (b["range95_low"], b["range95_high"])):
            close.append([a["city"], b["city"]])
            a.setdefault("too_close_to_call_with", []).append(b["city"])
            b.setdefault("too_close_to_call_with", []).append(a["city"])
    q = _quality(s, cities, start, end)
    warns = _common_warnings(start, end, q, _data_end(s))
    for c, f in frames.items():
        warns += [f"{c}: {w}" for w in _peer_warning(f)]
    if len(common) < 30:
        warns.append(f"Only {len(common)} day(s) have values for every city; comparison is weak.")
    n_st = {c: int(len(_primary_stations(s, c))) for c in cities}
    # one line per city on a date axis; days without a city value stay gaps
    chart = ChartSpec(type="line", title=f"{POLLUTANT_NAMES[pollutant]} by day: {', '.join(cities)}",
                      x={"field": "date", "type": "time"},
                      y={"field": "city_mean", "label": f"{POLLUTANT_NAMES[pollutant]} ({PM_UNITS})"},
                      series=[{"name": c, "data": [[str(d), r(x)] for d, x in zip(f.loc[f["meets_rule"], "local_date"],
                                                                               f.loc[f["meets_rule"], "city_mean"])]}
                              for c, f in frames.items()],
                      units=PM_UNITS)
    return AnalysisResult(
        kind="compare_cities", title=f"{POLLUTANT_NAMES[pollutant]} across {', '.join(cities)}", metric=pollutant,
        units=PM_UNITS, data_type="measured", source=SRC_OPENAQ, date_range={"start": str(start), "end": str(end)},
        stations={"count_by_city": n_st, "tier": "primary reference"},
        coverage={"days_in_period": days, "common_days": len(common),
                  "valid_days_by_city": {x["city"]: x["n_valid_days"] for x in rows}},
        quality=q, method="Ranking uses only days on which every city has a valid city value, so cities are "
                          "compared over the same dates. 95% range: weekly block bootstrap of those daily values "
                          "(neighbouring days are correlated). Neighbours whose ranges overlap by at least half are "
                          "too close to call.",
        warnings=warns, values={"cities": ranked, "common_days": len(common), "too_close_to_call": close}, chart=chart)


# ----------------------------------------------------------------------------- 3. Diwali AQI
def diwali_aqi(s: Store, city: str, years: tuple[int, ...] = (2024, 2025)) -> AnalysisResult:
    """MAIN Diwali comparison: official CPCB bulletin AQI levels on the festival days (bulletins dated
    D+1 and D+2, which cover the evenings of D and D+1). Percentages are withheld until approved."""
    _check(city)
    lv = s.q("SELECT * FROM diwali_aqi_levels WHERE city=? ORDER BY year, offset_days", [city])
    bl = s.q("SELECT * FROM diwali_aqi_baselines WHERE city=? ORDER BY year, \"window\"", [city])
    out, series, bands, warns = [], [], [], []
    for y in years:
        g = lv[lv["year"] == y]
        fest = g[g["role"] == "festival"]
        if fest.empty or fest["aqi"].isna().any():
            out.append({"year": y, "status": "not_available",
                        "message": f"Official AQI for Diwali {y} is not available yet." if y >= 2026
                        else f"Official AQI for Diwali {y} is missing."})
            continue
        level = float(fest["aqi"].mean())
        b = bl[bl["year"] == y]
        cands = [{"window": w.window, "description": w.description, "bulletin_dates": w.bulletin_dates,
                  "baseline_aqi": r(w.baseline_aqi),
                  "percent_change": r(w.percent_change) if APPROVED_DIWALI_BASELINE == w.window else None}
                 for w in b.itertuples()]
        out.append({
            "year": y, "status": "ok", "diwali_date": str(C.diwali_date(y)),
            "festival_bulletins": [{"bulletin_date": _d(x.bulletin_date), "evening_of": _d(x.evening_of),
                                    "reporting_period": _period_label(x.bulletin_date),
                                    "aqi": r(x.aqi, 0), "category": x.aqi_category,
                                    "prominent_pollutant": x.prominent_pollutant,
                                    "stations": int(x.no_stations) if pd.notna(x.no_stations) else None,
                                    "source": getattr(x, "source", None) or SRC_BULLETIN}
                                   for x in fest.itertuples()],
            "festival_level_aqi": r(level), "festival_level_category": category(level),
            "pre_festival_week_aqi": r(g[(g["offset_days"] >= -7) & (g["offset_days"] <= -1)]["aqi"].mean()),
            "baseline_candidates": cands, **_pre_trend(g),
            "percent_status": "approved" if APPROVED_DIWALI_BASELINE else
                              "not shown by default (ask for a percentage to get the D-7..D-1 comparison)"})
        # x = bulletin day relative to Diwali (bulletin dated D+1 -> +1); each point carries its bulletin
        # date and CPCB's 16:00-16:00 reporting period so no value is shown on the wrong calendar day
        series.append({"name": f"Diwali {y}", "data": [
            {"x": int(x.offset_days) + 1, "aqi": r(x.aqi, 0), "category": x.aqi_category,
             "bulletin_date": _d(x.bulletin_date), "reporting_period": _period_label(x.bulletin_date)}
            for x in g.itertuples()]})
        bands.append({"label": f"Diwali {y} festival bulletins ({_d(fest['bulletin_date'].iat[0])}, "
                               f"{_d(fest['bulletin_date'].iat[-1])})", "start": 1, "end": 2})
    warns += ["This is official AQI (an index of several pollutants), not a PM2.5 or PM10 concentration.",
              "Each bulletin covers 16:00 IST on the previous day to 16:00 IST on its date, so the bulletin dated "
              "D+1 reports Diwali evening.",
              "City AQI is CPCB's average over whichever stations reported; the station mix changes daily."]
    if APPROVED_DIWALI_BASELINE is None:
        warns.append("Percentage changes are withheld: they vary strongly with the baseline window "
                     "(see baseline_candidates).")
    if city != "Delhi":
        stt = s.q("SELECT p.year, p.status, r.user_message FROM diwali_pm_status p JOIN data_status_reasons r "
                  "USING (reason_code) WHERE p.city=? AND p.metric='pm25'", [city]) \
            if {"diwali_pm_status", "data_status_reasons"} <= set(s.tables) else pd.DataFrame()
        for o in out:
            m = stt[stt["year"] == o["year"]]
            if len(m):
                o["measured_pm_status"] = m["status"].iat[0]
                warns.append(m["user_message"].iat[0].format(year=o["year"]) +
                             " Measured PM is not used for this Diwali answer.")
    if any(o.get("pre_festival_trend") == "rising" for o in out):
        warns.append("AQI was already rising in the days before Diwali, so the festival level cannot be "
                     "attributed to Diwali alone.")
    warns.append(CAUSAL_WARNING)
    chart = ChartSpec(type="line", title=f"{city}: official CPCB AQI by bulletin date around Diwali",
                      x={"field": "x", "label": "Bulletin day relative to Diwali (bulletin D+1 reports "
                                                "Diwali evening; each bulletin = 24 h to 4 PM IST)",
                         "tooltip_fields": ["bulletin_date", "reporting_period", "category"]},
                      y={"field": "aqi", "label": "AQI (index)"}, series=series, units="index (0-500)",
                      bands=bands, colour_scale="cpcb_aqi",
                      notes=["Each point is one CPCB bulletin: the 24 hours from 4 PM the previous day to 4 PM on "
                             "the bulletin date.", f"AQI category colours: {AQI_COLOURS}"])
    n_st = [x["stations"] for o in out if o.get("festival_bulletins") for x in o["festival_bulletins"]]
    used = [y for y in years if any(o["year"] == y and o["status"] == "ok" for o in out)]
    srcs = sorted(set(lv.loc[lv["year"].isin(used) & lv["aqi"].notna(), "source"].dropna())) \
        if "source" in lv else []
    if any(x != SRC_BULLETIN for x in srcs):
        warns.append("Bulletins after 25 Oct 2026 are read from CPCB's own bulletin PDFs (cpcb.gov.in); earlier ones "
                     "from UrbanEmissions' copy of the same bulletins. Both report CPCB's official values.")
    return AnalysisResult(
        kind="diwali_aqi", title=f"Diwali air quality in {city} (official AQI)", metric="aqi",
        units="index (0-500)", data_type="official measured AQI (city average)",
        source="; ".join(srcs) if srcs else SRC_BULLETIN,
        date_range={"start": str(C.diwali_date(min(years)) - timedelta(days=14)),
                    "end": str(C.diwali_date(max(years)) + timedelta(days=4))},
        stations={"bulletin_station_counts": n_st, "note": "stations chosen by CPCB for the city bulletin"},
        coverage={"years_available": [o["year"] for o in out if o["status"] == "ok"]},
        quality={"note": "Bulletins are published by CPCB; OpenAQ gaps do not affect them."},
        method="Festival days are Diwali (D) and D+1 (verified dates in events.json). Festival level = mean of "
               "bulletins dated D+1 and D+2. Baseline candidates are listed but no percentage is reported "
               "until a baseline window is approved.",
        warnings=warns, values={"years": out}, chart=chart)


def diwali_aqi_percent(s: Store, city: str, year: int) -> AnalysisResult:
    """ONLY when a user explicitly asks for a percentage. Official AQI, festival level vs the week
    before (D-7..D-1). Single figure only if W1, W2, W3 agree within 25 points; else a range.
    Never for PM concentrations."""
    _check(city)
    bl = s.q("SELECT * FROM diwali_aqi_baselines WHERE city=? AND year=?", [city, year]).set_index("window")
    lv = s.q("SELECT * FROM diwali_aqi_levels WHERE city=? AND year=? ORDER BY offset_days", [city, year])
    src = lv["source"].dropna().unique().tolist() if "source" in lv else []
    base = {"kind": "diwali_aqi_percent", "title": f"Diwali {year} AQI change in {city} (official AQI)",
            "metric": "aqi", "units": "% change in AQI index", "data_type": "official measured AQI (city average)",
            "source": "; ".join(sorted(src)) or SRC_BULLETIN}
    fest = lv[lv["role"] == "festival"]
    if bl.empty or fest.empty or fest["aqi"].isna().any() or bl.loc[list(PERCENT_STABILITY_WINDOWS), "baseline_aqi"].isna().any():
        return AnalysisResult(**base, date_range={"start": None, "end": None}, stations={}, coverage={}, quality={},
                              method="", warnings=[f"Official AQI for Diwali {year} is not available, so no "
                                                   "percentage can be given."], values={"status": "not_available"})
    pcts = {w: float(bl.at[w, "percent_change"]) for w in PERCENT_STABILITY_WINDOWS}
    spread = max(pcts.values()) - min(pcts.values())
    stable = spread <= PERCENT_MAX_SPREAD_PP
    w2 = bl.loc[PERCENT_BASELINE]
    vals = {"status": "ok", "year": year, "festival_level_aqi": r(w2.festival_aqi),
            "baseline_window": "D-7..D-1 (week before Diwali)", "baseline_bulletin_dates": w2.bulletin_dates,
            "baseline_aqi": r(w2.baseline_aqi), "stable": stable, "spread_between_windows_pp": r(spread),
            "percent_change": r(pcts[PERCENT_BASELINE]) if stable else None,
            "percent_range": None if stable else [r(min(pcts.values())), r(max(pcts.values()))],
            "windows": [{"window": w, "bulletin_dates": bl.at[w, "bulletin_dates"], "baseline_aqi": r(bl.at[w, "baseline_aqi"]),
                         "percent_change": r(p)} for w, p in pcts.items()],
            "festival_bulletins": [_d(b) for b in fest["bulletin_date"]], **_pre_trend(lv)}
    warns = ["Percentage change in the official AQI index, not in PM2.5 or PM10 concentration.",
             CAUSAL_WARNING]
    if not stable:
        warns.insert(0, f"The change depends strongly on which days are used as the baseline (windows differ by "
                        f"{r(spread)} points), so only a range is given.")
    if vals.get("pre_festival_trend") == "rising":
        warns.append("AQI was already rising before Diwali.")
    return AnalysisResult(**base, date_range={"start": str(C.diwali_date(year) - timedelta(days=13)),
                                              "end": _d(fest["bulletin_date"].iat[-1])},
                          stations={"note": "stations chosen by CPCB for the city bulletin"},
                          coverage={"baseline_days": int(w2.n_days)}, quality={},
                          method="Festival level = mean of bulletins dated D+1 and D+2. Baseline = mean of bulletins "
                                 "for the evenings D-7..D-1. A single percentage is shown only when the D-14..D-8, "
                                 "D-7..D-1 and D-3..D-1 baselines give percentages within 25 points of each other; "
                                 "otherwise the range is shown.", warnings=warns, values=vals)


# ----------------------------------------------------------------------------- 4. Delhi PM
def delhi_pm_context(s: Store, year: int) -> AnalysisResult:
    """SUPPORTING context only: Delhi OpenCity PM around Diwali (fixed panel), with blank rates.
    Never a percentage change."""
    t = s.q("SELECT * FROM delhi_pm_diwali_support WHERE year=? ORDER BY pollutant", [year])
    warns = []
    if not t.empty and t["source"].iat[0] == SRC_OPENAQ:
        return _delhi_pm_openaq(t, year)
    if t.empty:
        msg = (f"Measured PM context for Delhi Diwali {year} is not available "
               "(2024 and 2025 come from the OpenCity panel; 2026 from OpenAQ once its festival days are published).")
        return AnalysisResult(kind="delhi_pm_context", title=f"Delhi PM around Diwali {year}", metric="pm25/pm10",
                              units=PM_UNITS, data_type="measured", source="CPCB via OpenCity",
                              date_range={"start": None, "end": None}, stations={}, coverage={}, quality={},
                              method="", warnings=[msg], values={"status": "not_available"})
    vals = []
    for x in t.itertuples():
        vals.append({"pollutant": x.pollutant, "panel_stations": int(x.panel_stations),
                     "baseline_mean_lower_bound": r(x.baseline_mean_lower_bound),
                     "festival_mean_lower_bound": r(x.festival_mean_lower_bound),
                     "blank_share_diwali_night": r(x.blank_diwali_night_panel * 100),
                     "blank_share_both_festival_nights": r(x.blank_festival_nights_panel * 100),
                     "blank_share_baseline_nights": r(x.blank_baseline_nights_panel * 100),
                     "proven_above_999_share_festival_nights":
                         r(x.proven_over_999_festival_nights_panel * 100) if pd.notna(x.proven_over_999_festival_nights_panel) else None,
                     "percent_change": None})
    warns.append(t["warning"].iat[0])
    warns.append("Supporting context only: the main Diwali comparison is official AQI. No percentage change is "
                 "given because the blank share differs between years.")
    if year < 2025:
        warns.append("For 2024 it cannot be proven which blanks were above 999 (no second source).")
    D = C.diwali_date(year)
    return AnalysisResult(
        kind="delhi_pm_context", title=f"Delhi measured PM around Diwali {year} (supporting)", metric="pm25/pm10",
        units=PM_UNITS, data_type="measured (values > 999 blank in source)", source="CPCB via OpenCity",
        date_range={"start": str(D - timedelta(days=14)), "end": str(D + timedelta(days=1))},
        stations={"panel_stations": {v["pollutant"]: v["panel_stations"] for v in vals},
                  "note": "same stations in 2024 and 2025"},
        coverage={"blank_definition": t["blank_definition"].iat[0]}, quality={},
        method="Fixed panel of stations passing coverage in both years (both festival days valid, >= 5 of 7 "
               "baseline days). Baseline = D-14..D-8; festival = D, D+1. Values are lower bounds.",
        warnings=warns, values={"year": year, "pollutants": vals})


NOT_COMPARABLE = ("Do not compare these 2026 values with Diwali 2024 or 2025: those came from OpenCity, which blanks "
                  "every reading above 999 µg/m³ (so they are lower bounds), from a different station panel. OpenAQ "
                  "keeps readings above 999 µg/m³.")
NOT_COMPARABLE_FULL = NOT_COMPARABLE + (" Supporting context only; the main Diwali result is official AQI. "
                                        "No percentage change is given.")


def _delhi_pm_openaq(t: pd.DataFrame, year: int) -> AnalysisResult:
    """Diwali 2026 Delhi PM from OpenAQ: SUPPORTING context only, not lower bounds, never compared with the
    OpenCity years and never a percentage."""
    vals = [{"pollutant": x.pollutant, "panel_stations": int(x.panel_stations),
             "baseline_mean": r(x.baseline_mean) if pd.notna(x.baseline_mean) else None,
             "festival_mean": r(x.festival_mean),
             "hours_above_999_festival_nights": int(x.hours_above_999_festival_nights),
             "valid_hours_festival_nights": int(x.valid_hours_festival_nights),
             "percent_change": None} for x in t.itertuples()]
    lq = sorted({d for x in t["low_quality_dates"].fillna("") for d in x.split(",") if d})
    thin = sorted({h for x in t["festival_night_hours_under_half_stations"].fillna("") for h in x.split(",") if h})
    warns = [NOT_COMPARABLE_FULL]                    # same text as the required warning, so it shows once
    if (t["status"] == "baseline_incomplete").any():
        warns.append("No baseline is given: OpenAQ had a network-wide outage on baseline days, so no Delhi station "
                     "has at least 5 of 7 valid baseline days. Festival-day values use stations valid on both "
                     "festival days.")
    if thin:
        warns.append(f"On the festival nights fewer than half of Delhi's stations reported in {len(thin)} hours "
                     f"(from {thin[0]} to {thin[-1]} IST), when smoke usually peaks, so festival-day values are "
                     "likely underestimates.")
    if lq:
        warns.append("OpenAQ has data gaps (network-wide or across Delhi) on " + ", ".join(lq) + "; values for those "
                     "days are less complete.")
    D = C.diwali_date(year)
    return AnalysisResult(
        kind="delhi_pm_context", title=f"Delhi measured PM around Diwali {year} (supporting, OpenAQ)",
        metric="pm25/pm10", units=PM_UNITS, data_type="measured (OpenAQ; values above 999 kept)", source=SRC_OPENAQ,
        date_range={"start": str(D - timedelta(days=14)), "end": str(D + timedelta(days=1))},
        stations={"panel_stations": {v["pollutant"]: v["panel_stations"] for v in vals},
                  "note": f"OpenAQ primary stations passing coverage around Diwali {year}"},
        coverage={"low_quality_dates": lq, "festival_night_hours_under_half_stations": thin}, quality={},
        method="Stations with both festival days valid and >= 5 of 7 baseline days valid; if none qualifies, the "
               "baseline is withheld and festival-day values use stations valid on both festival days. Baseline = "
               "D-14..D-8; festival = D, D+1 (local IST dates). Values are station-day means averaged over those stations.",
        warnings=warns, values={"year": year, "source": "OpenAQ", "values_are_lower_bounds": False,
                                "comparable_with_2024_2025": False, "pollutants": vals,
                                "festival_days": f"{D}..{D + timedelta(days=1)}"})


# ----------------------------------------------------------------------------- 5. unusual days
def unusual_days(s: Store, city: str, pollutant: str, start: date, end: date,
                 window: int = 15, threshold: float = 3.0) -> AnalysisResult:
    """Rolling-median detection: each day is compared with the median of the surrounding `window`
    days (excluding itself). Robust scale = 1.4826 x median absolute deviation of all residuals.
    Unusual if |residual| > threshold x scale."""
    _check(city, pollutant)
    half = window // 2
    cd = _city_days(s, city, pollutant, start - timedelta(days=half), end + timedelta(days=half))
    v = cd[cd["meets_rule"]][["local_date", "city_mean", "severity"]].copy()
    v["local_date"] = pd.to_datetime(v["local_date"])
    v = v.set_index("local_date").sort_index()
    warns = []
    if len(v) < window * 2:
        warns.append(f"Only {len(v)} valid days; at least {window * 2} are recommended for this method.")
    if v.empty:
        return _empty_unusual(city, pollutant, start, end, warns, window, threshold)
    full = v["city_mean"].reindex(pd.date_range(v.index.min(), v.index.max(), freq="D"))
    med = []
    for t in full.index:
        nb = full[(full.index >= t - pd.Timedelta(days=half)) & (full.index <= t + pd.Timedelta(days=half))
                  & (full.index != t)].dropna()
        med.append(nb.median() if len(nb) >= max(3, half) else np.nan)
    v["rolling_median"] = pd.Series(med, index=full.index).reindex(v.index)
    v["residual"] = v["city_mean"] - v["rolling_median"]
    in_period = v[(v.index.date >= start) & (v.index.date <= end)].dropna(subset=["residual"])
    mad = float(np.median(np.abs(in_period["residual"]))) if len(in_period) else np.nan
    scale = 1.4826 * mad if mad and not np.isnan(mad) else np.nan
    days = []
    if scale and not np.isnan(scale):
        z = in_period["residual"] / scale
        for t, row in in_period[z.abs() > threshold].iterrows():
            days.append({"date": t.date(), "value": r(row["city_mean"]), "rolling_median": r(row["rolling_median"]),
                         "difference": r(row["residual"]), "robust_z": r(z[t], 2),
                         "direction": "unusually high" if row["residual"] > 0 else "unusually low",
                         "data_quality": row["severity"], "peer_outlier_over_25pct": _is_major(cd, t)})
    lowq = [d for d in days if d["data_quality"] in ("moderate", "severe")]
    if lowq:
        warns.append(f"{len(lowq)} flagged day(s) fall on dates with moderate/severe data gaps.")
    q = _quality(s, [city], start, end)
    warns += _common_warnings(start, end, q, _data_end(s))
    po = [d for d in days if d["peer_outlier_over_25pct"]]
    if po:
        warns.append(f"{len(po)} unusual day(s) depend on one peer-outlier station (> 25% effect): "
                     + ", ".join(str(d["date"]) for d in po[:5]) + ".")
    series = [[str(t.date()), r(x)] for t, x in in_period["city_mean"].items()]
    chart = ChartSpec(type="line", title=f"{city} {POLLUTANT_NAMES[pollutant]} with unusual days",
                      x={"field": "date", "type": "time"}, y={"field": "value", "label": f"{POLLUTANT_NAMES[pollutant]} ({PM_UNITS})"},
                      series=[{"name": "daily city value", "data": series},
                              {"name": "rolling median", "data": [[str(t.date()), r(x)] for t, x in in_period["rolling_median"].items()]},
                              {"name": "unusual days", "type": "markers", "data": [[str(d["date"]), d["value"]] for d in days]}],
                      units=PM_UNITS)
    cd_period = cd[(pd.to_datetime(cd["local_date"]).dt.date >= start) & (pd.to_datetime(cd["local_date"]).dt.date <= end)]
    return AnalysisResult(
        kind="unusual_days", title=f"Unusual {POLLUTANT_NAMES[pollutant]} days in {city}", metric=pollutant,
        units=PM_UNITS, data_type="measured", source=SRC_OPENAQ, date_range={"start": str(start), "end": str(end)},
        stations={"count": int(len(_primary_stations(s, city))), "tier": "primary reference"},
        coverage=_coverage_block(cd_period, start, end), quality=q,
        method=(f"Each day's city value is compared with the median of the {window} surrounding days "
                f"(the day itself excluded). The typical spread is 1.4826 x the median absolute difference "
                f"across the period. A day is unusual when its difference is more than {threshold} times that "
                f"spread. Unusual does not mean wrong or explained."),
        warnings=warns, values={"window_days": window, "threshold": threshold, "robust_scale": r(scale, 2),
                                "n_days_tested": int(len(in_period)), "unusual_days": days}, chart=chart)


def _empty_unusual(city, pollutant, start, end, warns, window, threshold):
    return AnalysisResult(kind="unusual_days", title=f"Unusual {POLLUTANT_NAMES[pollutant]} days in {city}",
                          metric=pollutant, units=PM_UNITS, data_type="measured", source=SRC_OPENAQ,
                          date_range={"start": str(start), "end": str(end)}, stations={}, coverage={}, quality={},
                          method="rolling median", warnings=warns + ["No valid city values in this period."],
                          values={"window_days": window, "threshold": threshold, "unusual_days": []})


# ----------------------------------------------------------------------------- 6. weather
def _spearman(a: pd.Series, b: pd.Series) -> float:
    return float(np.corrcoef(a.rank(), b.rank())[0, 1]) if len(a) > 2 else np.nan


def _strength(rho: float) -> str:
    a = abs(rho)
    return "very weak" if a < 0.1 else "weak" if a < 0.3 else "moderate" if a < 0.5 else "strong"


def weather_relationship(s: Store, city: str, pollutant: str, variable: str, start: date, end: date) -> AnalysisResult:
    """Association (not cause) between daily city PM and one weather variable."""
    _check(city, pollutant)
    if variable not in WEATHER_VARS:
        raise ValueError(f"variable must be one of {list(WEATHER_VARS)}")
    name, wunit = WEATHER_VARS[variable]
    cd = _city_days(s, city, pollutant, start, end)
    w = s.q(f"SELECT local_date, {variable} AS x, preliminary, grid_lat, grid_lon, attribution FROM weather_daily "
            "WHERE city=? AND local_date BETWEEN ? AND ?", [city, start, end])
    j = cd[cd["meets_rule"] & (cd["severity"] != "severe")][["local_date", "city_mean"]].merge(
        w[~w["preliminary"]], on="local_date")
    warns = ["Weather is modelled reanalysis for one grid cell near the city centre; PM is measured at stations. "
             "They are compared, never combined into one number.",
             "This is an association, not evidence that weather causes the change. Season, emissions and "
             "other weather conditions move together."]
    rho = _spearman(j["city_mean"], j["x"]) if len(j) else np.nan
    ci = ST.spearman_ci(float(rho), len(j)) if len(j) else None
    bins = []
    if len(j) >= 20:
        if variable == "precipitation_sum_mm":
            for lab, m in (("dry (< 1 mm)", j["x"] < 1), ("rain (>= 1 mm)", j["x"] >= 1)):
                bins.append({"group": lab, "n_days": int(m.sum()), "mean_pm": r(j.loc[m, "city_mean"].mean())})
        else:
            j["q"] = pd.qcut(j["x"], 4, labels=["lowest 25%", "25-50%", "50-75%", "highest 25%"], duplicates="drop")
            for lab, g in j.groupby("q", observed=True):
                bins.append({"group": f"{name} {lab} ({r(g['x'].min())}-{r(g['x'].max())} {wunit})",
                             "n_days": int(len(g)), "mean_pm": r(g["city_mean"].mean())})
            if variable == "wind_speed_mean_kmh" and len(bins) >= 2:     # plain-language ends of the range
                bins[0]["label"], bins[-1]["label"] = "calm days (lowest 25% of wind)", "windy days (highest 25% of wind)"
    else:
        warns.append(f"Only {len(j)} matched days; too few for a reliable association.")
    direction = None if np.isnan(rho) else ("lower" if rho < 0 else "higher")
    more = "more rainfall" if variable == "precipitation_sum_mm" else f"higher {name}"
    statement = None if direction is None else (
        f"In {city}, days with {more} tended to have {direction} {POLLUTANT_NAMES[pollutant]} "
        f"({_strength(rho)} association, Spearman rho = {r(rho, 2)}, {len(j)} days). This is an association, "
        f"not a cause.")
    q = _quality(s, [city], start, end)
    warns += _common_warnings(start, end, q, _data_end(s)) + _peer_warning(cd)
    series = [{"name": "days", "data": [[r(a, 2), r(b)] for a, b in zip(j["x"], j["city_mean"])]}]
    if len(j) >= 20 and j["x"].nunique() > 2:                      # Theil-Sen line, calculated here (not drawn by eye)
        slope, icpt = ST.sens_slope(list(j["x"]), list(j["city_mean"]))
        x0, x1 = float(j["x"].min()), float(j["x"].max())
        series.append({"name": "fitted line (Theil-Sen)", "type": "line",
                       "data": [[r(x0, 2), r(icpt + slope * x0)], [r(x1, 2), r(icpt + slope * x1)]]})
    chart = ChartSpec(type="scatter", title=f"{city}: {POLLUTANT_NAMES[pollutant]} vs {name}",
                      x={"field": variable, "label": f"{name} ({wunit})"},
                      y={"field": "city_mean", "label": f"{POLLUTANT_NAMES[pollutant]} ({PM_UNITS})"},
                      series=series, units=PM_UNITS)
    return AnalysisResult(
        kind="weather_relationship", title=f"{POLLUTANT_NAMES[pollutant]} and {name} in {city}", metric=pollutant,
        units=f"{PM_UNITS}; {name} in {wunit}", data_type="measured PM + modelled weather (reanalysis)",
        source=f"{SRC_OPENAQ}; {w['attribution'].iat[0] if len(w) else 'Open-Meteo'}",
        date_range={"start": str(start), "end": str(end)},
        stations={"count": int(len(_primary_stations(s, city))), "weather_grid":
                  {"lat": r(w['grid_lat'].iat[0], 3), "lon": r(w['grid_lon'].iat[0], 3)} if len(w) else None},
        coverage={"matched_days": int(len(j)), "days_in_period": (end - start).days + 1,
                  "excluded": "days without a city value, severe-gap days, preliminary weather days"},
        quality=q, method="Spearman rank correlation between daily city PM and the daily weather value; "
                          "days grouped into quartiles (or dry/rain) to show average PM per group.",
        warnings=warns, values={"spearman_rho": r(rho, 3), "strength": None if np.isnan(rho) else _strength(rho),
                                "rho_range95_low": r(ci[0], 3) if ci else None, "rho_range95_high": r(ci[1], 3) if ci else None,
                                "n_days": int(len(j)), "groups": bins, "statement": statement}, chart=chart)


# ----------------------------------------------------------------------------- 7. coverage
def coverage_summary(s: Store, city: str, start: date, end: date) -> AnalysisResult:
    _check(city)
    st = s.q("SELECT tier, COUNT(DISTINCT location_id) n FROM stations WHERE city=? GROUP BY tier", [city])
    sd = s.q("SELECT pollutant, COUNT(*) n, AVG(CAST(is_valid_day AS INT)) valid_share, "
             "SUM(n_flagged_hours_excluded) flagged_hours, SUM(CAST(flag_pm25_gt_pm10 AS INT)) impossible, "
             "SUM(CAST(flag_peer_outlier_day AS INT)) peer_outliers FROM station_daily "
             "WHERE city=? AND tier='primary' AND source=? AND local_date BETWEEN ? AND ? GROUP BY pollutant",
             [city, SRC_OPENAQ, start, end])
    cd = s.q("SELECT pollutant, AVG(CAST(meets_rule AS INT)) meets, COUNT(*) n FROM city_daily "
             "WHERE city=? AND local_date BETWEEN ? AND ? GROUP BY pollutant", [city, start, end])
    q = _quality(s, [city], start, end)
    days = (end - start).days + 1
    per = []
    for p in C.POLLUTANTS:
        a = sd[sd["pollutant"] == p]
        b = cd[cd["pollutant"] == p]
        per.append({"pollutant": p, "station_days": int(a["n"].iat[0]) if len(a) else 0,
                    "valid_station_day_share": r(a["valid_share"].iat[0], 3) if len(a) else None,
                    "days_with_city_value": int(round(b["meets"].iat[0] * b["n"].iat[0])) if len(b) else 0,
                    "share_of_days_with_city_value": r((b["meets"].iat[0] * b["n"].iat[0]) / days, 3) if len(b) else 0,
                    "flagged_hours_excluded": int(a["flagged_hours"].iat[0] or 0) if len(a) else 0,
                    "impossible_pm25_gt_pm10_station_days": int(a["impossible"].iat[0] or 0) if len(a) else 0,
                    "peer_outlier_station_days_flagged": int(a["peer_outliers"].iat[0] or 0) if len(a) else 0})
    warns = _common_warnings(start, end, q, _data_end(s))
    chart = calendar_quality_chart(s, city, start, end)
    return AnalysisResult(
        kind="coverage_summary", title=f"Data coverage and quality for {city}", metric="pm25/pm10", units=PM_UNITS,
        data_type="measured", source=SRC_OPENAQ, date_range={"start": str(start), "end": str(end)},
        stations={"by_tier": dict(zip(st["tier"], st["n"].astype(int)))},
        coverage={"by_pollutant": per, "days_in_period": days}, quality=q,
        method="Valid station-day: >= 16 valid IST hours after excluding flagged hours. City value: >= max(3, 50%) "
               "of primary stations valid. Severity from network-wide gaps: minor 1-2 h, moderate 3-7 h or a 6-23 h "
               "run, severe >= 8 h or part of a >= 24 h run.",
        warnings=warns, values={"pollutants": per}, chart=chart)


# ----------------------------------------------------------------------------- 8. charts
def calendar_quality_chart(s: Store, city: str, start: date, end: date) -> ChartSpec:
    dq = s.q("SELECT local_date, severity FROM date_quality WHERE source=? AND city=? AND local_date BETWEEN ? AND ? "
             "ORDER BY local_date", [SRC_OPENAQ, city, start, end])
    return ChartSpec(type="calendar_heatmap", title=f"{city}: data-quality severity by day",
                     x={"field": "date", "type": "time"}, y={"field": "severity", "type": "category"},
                     series=[{"name": "severity", "data": [[_d(d), sv] for d, sv in zip(dq["local_date"], dq["severity"])]}],
                     units="severity level")


def aqi_calendar_chart(s: Store, city: str, year: int) -> ChartSpec:
    """Calendar heatmap of official AQI with CPCB category colours (colours carry data meaning)."""
    _check(city)
    a = s.q("SELECT bulletin_date, aqi, aqi_category FROM city_daily_aqi WHERE city=? AND YEAR(bulletin_date)=? "
            "ORDER BY bulletin_date", [city, year])
    bands = []
    if str(year) in C.EVENTS["diwali"]:
        F = C.bulletin_dates_for(C.festival_days(year))
        bands.append({"label": f"Diwali {year} (bulletins)", "start": str(F[0]), "end": str(F[-1])})
    return ChartSpec(type="calendar_heatmap", title=f"{city}: official AQI {year}",
                     x={"field": "bulletin_date", "type": "time"}, y={"field": "aqi"},
                     series=[{"name": "AQI", "data": [[_d(d), r(v, 0), c] for d, v, c in
                                                      zip(a["bulletin_date"], a["aqi"], a["aqi_category"])]}],
                     units="index (0-500)", bands=bands, colour_scale="cpcb_aqi",
                     notes=["Bulletin date X covers 16:00 IST on X-1 to 16:00 IST on X.",
                            f"AQI category colours: {AQI_COLOURS}"])


# ----------------------------------------------------------------------------- home: latest available values
def latest_city_values(s: Store, pollutant: str = "pm25", days: int = 7) -> dict:
    """Each city's measured city value on the latest date every city has one, plus the `days` days up to it.
    Read-only, no LLM. A day without a valid city value (fewer stations than the rule needs) is None, so the
    sparkline shows a gap. Map position = mean coordinates of the city's primary stations."""
    _check(pollutant=pollutant)
    cd = s.q("SELECT city, local_date, city_mean, n_valid_stations, n_primary_stations, meets_rule "
             "FROM city_daily WHERE pollutant=?", [pollutant])
    cd["local_date"] = pd.to_datetime(cd["local_date"]).dt.date
    ok = cd[cd.meets_rule]
    end = min(ok[ok.city == c].local_date.max() for c in C.CITIES)
    week = [end - timedelta(days=i) for i in range(days - 1, -1, -1)]
    st = s.q("SELECT city, location_id, AVG(lat) AS lat, AVG(lon) AS lon FROM stations WHERE tier='primary' "
             "GROUP BY city, location_id")
    cities = []
    for c in C.CITIES:
        x = ok[ok.city == c].set_index("local_date")
        row = x.loc[end]
        pos = st[st.city == c]
        cities.append({
            "city": c, "value": r(float(row.city_mean)), "stations_reporting": int(row.n_valid_stations),
            "stations_total": int(row.n_primary_stations), "primary_stations": int(len(pos)),
            "lat": round(float(pos.lat.mean()), 4), "lon": round(float(pos.lon.mean()), 4),
            "series": [{"date": str(d), "value": r(float(x.loc[d, "city_mean"])) if d in x.index else None} for d in week]})
    return {"date": str(end), "start": str(week[0]), "pollutant": pollutant, "units": PM_UNITS,
            "data_type": "measured", "source": SRC_OPENAQ,
            "method": "24-hour city average of primary reference stations (IST day); a day counts only when enough "
                      "stations have at least 16 valid hours.",
            "cities": sorted(cities, key=lambda v: -v["value"])}


# ----------------------------------------------------------------------------- explore: stations over 30 days
TIER_LABEL = {"primary": "Reference monitor", "supporting_single_station": "Reference monitor (US consulate, supporting)",
              "low_cost": "Low-cost sensor"}


def explore_data(s: Store, pollutant: str = "pm25", days: int = 30) -> dict:
    """Every monitoring station with data in the latest `days` available days: metadata plus each day's
    24-hour mean and valid hours. A station-day needs >= 16 valid hours for a value (otherwise `v` is None and
    `h` says how many hours there were); no row at all means no data that day. Read-only, no LLM.
    City values per day use the same rule as everywhere else (None when too few stations)."""
    _check(pollutant=pollutant)
    end = date.fromisoformat(latest_city_values(s, pollutant)["date"])
    dates = [end - timedelta(days=i) for i in range(days - 1, -1, -1)]
    sd = s.q("SELECT location_id, local_date, valid_hours, is_valid_day, daily_mean FROM station_daily "
             "WHERE pollutant=? AND local_date BETWEEN ? AND ?", [pollutant, dates[0], end])
    sd["local_date"] = pd.to_datetime(sd["local_date"]).dt.date
    # one sensor per location and pollutant; if a location ever had two, keep its fullest day
    sd = sd.sort_values("valid_hours", ascending=False).drop_duplicates(["location_id", "local_date"])
    meta = s.q("SELECT location_id, ANY_VALUE(city) AS city, ANY_VALUE(tier) AS tier, ANY_VALUE(station_name) AS name, "
               "ANY_VALUE(provider) AS provider, AVG(lat) AS lat, AVG(lon) AS lon, MIN(km_from_centre) AS km, "
               "MAX(location_last_utc) AS last_utc FROM stations GROUP BY location_id")
    meta = meta[meta.location_id.isin(sd.location_id.unique())].sort_values(["city", "km"])
    idx = {d: i for i, d in enumerate(dates)}
    stations = []
    for m in meta.itertuples():
        v: list = [None] * days
        h: list = [None] * days
        for x in sd[sd.location_id == m.location_id].itertuples():
            i = idx[x.local_date]
            h[i] = int(x.valid_hours)
            v[i] = r(float(x.daily_mean)) if x.is_valid_day and pd.notna(x.daily_mean) else None
        stations.append({"id": int(m.location_id), "city": m.city, "name": m.name, "provider": m.provider,
                         "tier": m.tier, "type": TIER_LABEL.get(m.tier, m.tier), "lat": round(float(m.lat), 5),
                         "lon": round(float(m.lon), 5), "km_from_centre": r(float(m.km)), "last_reading_utc": m.last_utc,
                         "values": v, "valid_hours": h})
    cd = s.q("SELECT city, local_date, city_mean, meets_rule, n_valid_stations FROM city_daily "
             "WHERE pollutant=? AND local_date BETWEEN ? AND ?", [pollutant, dates[0], end])
    cd["local_date"] = pd.to_datetime(cd["local_date"]).dt.date
    cities = {}
    for c in C.CITIES:
        x = cd[cd.city == c].set_index("local_date")
        cities[c] = {"values": [r(float(x.loc[d, "city_mean"])) if d in x.index and bool(x.loc[d, "meets_rule"]) else None for d in dates],
                     "stations_reporting": [int(x.loc[d, "n_valid_stations"]) if d in x.index else 0 for d in dates]}
    return {"pollutant": pollutant, "units": PM_UNITS, "data_type": "measured", "source": SRC_OPENAQ,
            "dates": [str(d) for d in dates], "min_valid_hours": C.MIN_VALID_HOURS_PER_DAY, "cities": cities,
            "stations": stations}
