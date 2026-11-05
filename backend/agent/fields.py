"""Named result fields. Tools send the model only {field: value}; code keeps the label and unit so
metric cards are built from tool results, never from model-written numbers."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

PN = {"pm25": "PM2.5", "pm10": "PM10"}
PRIORITY = ("not available", "not yet", "no measured", "incomplete", "peer outlier", "already rising",
            "before 2025-02-18", "not a pm2.5", "severe", "too few", "weak", "lower bounds", "999")


@dataclass
class Field:
    value: Any
    label: str
    unit: str = ""


def _per(d: dict) -> str:
    dr = d.get("date_range") or {}
    return f"{dr.get('start')} to {dr.get('end')}" if dr.get("start") else ""


def fields_for(d: dict, ctx: dict) -> dict[str, Field]:
    k, v, u = d["kind"], d["values"], d["units"]
    city = ctx.get("city", "")
    P = PN.get(d.get("metric"), d.get("metric", ""))
    per = _per(d)
    f: dict[str, Field] = {}
    cov = d.get("coverage") or {}
    if k == "city_trend":
        s = v.get("summary") or {}
        if s:
            f["mean"] = Field(s["mean_of_daily_values"], f"{city} mean {P}, {per}", u)
            f["median"] = Field(s["median"], f"{city} median daily {P}, {per}", u)
            f["highest_value"] = Field(s["highest_day"]["value"], f"{city} highest daily {P} ({s['highest_day']['date']})", u)
            f["highest_date"] = Field(str(s["highest_day"]["date"]), "date of highest day")
            f["lowest_value"] = Field(s["lowest_day"]["value"], f"{city} lowest daily {P} ({s['lowest_day']['date']})", u)
            f["lowest_date"] = Field(str(s["lowest_day"]["date"]), "date of lowest day")
        f["days_with_data"] = Field(cov.get("days_with_city_value"), f"{city} days with a city value", "days")
        f["days_in_period"] = Field(cov.get("days_in_period"), "days in period", "days")
        sh = cov.get("share_of_days_with_city_value")
        f["coverage_pct"] = Field(round(sh * 100, 1) if sh is not None else None, f"{city} share of days with data", "%")
        f["stations"] = Field((d.get("stations") or {}).get("count"), f"{city} primary stations", "stations")
        periods = v.get("periods", [])
        if len(periods) <= 24:
            for p in periods:
                f[f"mean_{p['period']}"] = Field(p["mean"], f"{city} {P} mean, {p['period']}", u)
    elif k == "compare_cities":
        for c in v["cities"]:
            f[f"{c['city']}_mean"] = Field(c["mean_common_days"], f"{c['city']} mean {P} (common days), {per}", u)
            f[f"{c['city']}_rank"] = Field(c["rank_highest_first"], f"{c['city']} rank (1 = highest {P})", "")
            f[f"{c['city']}_valid_days"] = Field(c["n_valid_days"], f"{c['city']} days with data", "days")
        f["common_days"] = Field(v["common_days"], "days with data for every city", "days")
    elif k == "diwali_aqi":
        for y in v["years"]:
            yr = y["year"]
            if y["status"] != "ok":
                f[f"{yr}_status"] = Field(y.get("message", "not available"), f"Diwali {yr}")
                continue
            f[f"{yr}_festival_aqi"] = Field(y["festival_level_aqi"], f"{city} official AQI, Diwali {yr} (mean of festival bulletins)", u)
            f[f"{yr}_category"] = Field(y["festival_level_category"], f"AQI category, Diwali {yr}")
            for b in y["festival_bulletins"]:
                f[f"{yr}_bulletin_{b['bulletin_date']}"] = Field(
                    b["aqi"], f"{city} official AQI, bulletin {b['bulletin_date']} ({b['reporting_period']})", u)
            f[f"{yr}_pre_week_aqi"] = Field(y["pre_festival_week_aqi"], f"{city} official AQI, week before Diwali {yr}", u)
            f[f"{yr}_pre_trend"] = Field(y.get("pre_festival_trend"), f"AQI trend before Diwali {yr}")
            if y.get("measured_pm_status"):
                f[f"{yr}_measured_pm"] = Field(y["measured_pm_status"], f"measured PM, Diwali {yr}")
        for yr, p in (v.get("percent") or {}).items():
            pv = p["values"]
            if pv.get("status") != "ok":
                f[f"{yr}_pct_status"] = Field("not available", f"AQI % change, Diwali {yr}")
                continue
            if pv["stable"]:
                f[f"{yr}_pct_change"] = Field(pv["percent_change"], f"{city} official AQI change vs week before, Diwali {yr}", "%")
            else:
                f[f"{yr}_pct_low"] = Field(pv["percent_range"][0], f"{city} AQI change, lowest of 3 baselines, Diwali {yr}", "%")
                f[f"{yr}_pct_high"] = Field(pv["percent_range"][1], f"{city} AQI change, highest of 3 baselines, Diwali {yr}", "%")
            f[f"{yr}_pct_baseline_aqi"] = Field(pv["baseline_aqi"], f"{city} AQI, week before Diwali {yr}", u)
    elif k == "delhi_pm_context":
        for p in v.get("pollutants", []):
            n = PN[p["pollutant"]]
            f[f"{p['pollutant']}_festival_lower_bound"] = Field(p["festival_mean_lower_bound"], f"Delhi {n} festival days, lower bound", "µg/m³")
            f[f"{p['pollutant']}_baseline_lower_bound"] = Field(p["baseline_mean_lower_bound"], f"Delhi {n} baseline days, lower bound", "µg/m³")
            f[f"{p['pollutant']}_blank_pct_diwali_night"] = Field(p["blank_share_diwali_night"], f"Delhi {n} blank readings, Diwali night", "%")
        if v.get("status") == "not_available":
            f["status"] = Field("not available", "Delhi measured PM, Diwali")
    elif k == "unusual_days":
        days = sorted(v.get("unusual_days", []), key=lambda x: -abs(x.get("robust_z") or 0))
        f["days_tested"] = Field(v.get("n_days_tested"), "days tested", "days")
        f["unusual_count"] = Field(len(days), f"{city} unusual {P} days", "days")
        f["high_count"] = Field(sum(x["direction"] == "unusually high" for x in days), "unusually high days", "days")
        f["low_count"] = Field(sum(x["direction"] == "unusually low" for x in days), "unusually low days", "days")
        f["window_days"] = Field(v.get("window_days"), "rolling median window", "days")
        f["threshold"] = Field(v.get("threshold"), "threshold (x typical spread)", "")
        for i, x in enumerate(days[:6], 1):
            f[f"day{i}"] = Field(f"{x['date']} {x['direction'].split()[1]} {x['value']} (median {x['rolling_median']})"
                                 + (" peer-outlier" if x.get("peer_outlier_over_25pct") else ""), f"unusual day {i}")
            f[f"day{i}_value"] = Field(x["value"], f"{city} {P} on {x['date']} ({x['direction']})", u)
    elif k == "weather_relationship":
        wu = u.split("; ")[-1] if "; " in u else ""
        f["rho"] = Field(v.get("spearman_rho"), f"{city} Spearman rho, {P} vs {d['title'].split(' and ')[-1].split(' in ')[0]}", "")
        f["strength"] = Field(v.get("strength"), "association strength")
        f["days"] = Field(v.get("n_days"), "matched days", "days")
        for i, g in enumerate(v.get("groups", []), 1):
            key = "dry" if g["group"].startswith("dry") else "rain" if g["group"].startswith("rain") else f"q{i}"
            f[f"{key}_mean"] = Field(g["mean_pm"], f"{city} mean {P}, {g['group']}", "µg/m³")
            f[f"{key}_days"] = Field(g["n_days"], f"days, {g['group']}", "days")
            if key.startswith("q"):
                f[f"{key}_group"] = Field(g["group"], f"group {i}")
        f["statement"] = Field(v.get("statement"), "association statement")
        _ = wu
    elif k == "coverage_summary":
        for p in v["pollutants"]:
            n = p["pollutant"]
            f[f"{n}_days_with_value"] = Field(p["days_with_city_value"], f"{city} {PN[n]} days with a city value", "days")
            sh = p["share_of_days_with_city_value"]
            f[f"{n}_share_pct"] = Field(round(sh * 100, 1) if sh is not None else None, f"{city} {PN[n]} share of days", "%")
            f[f"{n}_flagged_hours_excluded"] = Field(p["flagged_hours_excluded"], f"{PN[n]} flagged hours excluded", "hours")
            f[f"{n}_impossible_days_excluded"] = Field(p["impossible_pm25_gt_pm10_station_days"], "impossible station-days excluded", "station-days")
            f[f"{n}_peer_outlier_days"] = Field(p["peer_outlier_station_days_flagged"], "peer-outlier station-days (flagged)", "station-days")
        f["primary_stations"] = Field((d["stations"].get("by_tier") or {}).get("primary"), f"{city} primary stations", "stations")
        f["severe_days"] = Field(d["quality"].get("n_severe_dates"), "days with severe network gaps", "days")
        f["days_in_period"] = Field(cov.get("days_in_period"), "days in period", "days")
    return {k2: x for k2, x in f.items() if x.value is not None}


def notes_for(warnings: list[str], n: int = 2, width: int = 170) -> list[str]:
    pri = [w for w in warnings if any(p in w.lower() for p in PRIORITY)]
    rest = [w for w in warnings if w not in pri]
    out = []
    for w in pri + rest:
        out.append(w if len(w) <= width else w[: width - 1] + "…")
        if len(out) == n:
            break
    return out


TYPE_SHORT = {"measured": "measured PM", "official_aqi": "official CPCB AQI (index, not a concentration)",
              "mixed": "measured PM + modelled weather", "modelled": "modelled"}
