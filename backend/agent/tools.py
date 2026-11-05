"""Typed tools around the deterministic analysis functions. Python computes every number; tools
return a dataset_id plus a compact summary (never raw tables). No tool runs arbitrary code."""
from __future__ import annotations

from datetime import date
from typing import Any, Literal

from pydantic_ai import RunContext

from backend.analysis import functions as F
from . import resolver as R
from .session import RunDeps, data_type_of

Pollutant = Literal["pm25", "pm10"]
WeatherVar = Literal["temperature", "humidity", "wind", "rain"]
Intent = Literal["trend", "compare", "diwali", "unusual_days", "weather", "coverage", "follow_up", "other"]
WEATHER_COL = {"temperature": "temperature_mean_c", "humidity": "relative_humidity_mean_pct",
               "wind": "wind_speed_mean_kmh", "rain": "precipitation_sum_mm"}
MAX_WARNINGS = 5


# ----------------------------------------------------------------------------- compaction
def _base(d: dict) -> dict:
    st = d.get("stations") or {}
    stations = {k: v for k, v in st.items() if k in ("count", "count_by_city", "tier", "panel_stations",
                                                       "bulletin_station_counts", "note")}
    return {"title": d["title"], "data_type": d["data_type"], "data_category": data_type_of(d["data_type"]),
            "source": d["source"], "units": d["units"], "date_range": d["date_range"], "stations": stations,
            "warnings": d["warnings"][:MAX_WARNINGS]}


def compact(d: dict) -> dict:
    k, v = d["kind"], d["values"]
    out = _base(d)
    cov = d.get("coverage") or {}
    if k == "city_trend":
        periods = v["periods"]
        out["coverage"] = {x: cov.get(x) for x in ("days_in_period", "days_with_city_value",
                                                  "share_of_days_with_city_value", "flagged_hours_excluded")}
        out["summary"] = v["summary"]
        out["periods"] = periods if len(periods) <= 24 else []
        if len(periods) > 24:
            out["note"] = f"{len(periods)} periods; use freq='M' for a list, or the chart for detail."
        out["freq"] = v["freq"]
    elif k == "compare_cities":
        out["coverage"] = cov
        out["cities"] = v["cities"]
    elif k == "diwali_aqi":
        years = []
        for y in v["years"]:
            if y["status"] != "ok":
                years.append(y)
                continue
            years.append({k2: y.get(k2) for k2 in ("year", "status", "diwali_date", "festival_bulletins",
                                                   "festival_level_aqi", "festival_level_category",
                                                   "pre_festival_week_aqi", "pre_festival_trend",
                                                   "aqi_d7_to_d5_mean", "aqi_d3_to_d1_mean")})
        out["years"] = years
        out["percent"] = "not shown by default; use diwali_aqi_percent_change only if the user asks"
    elif k == "unusual_days":
        days = sorted(v.get("unusual_days", []), key=lambda x: -abs(x.get("robust_z") or 0))
        out["method"] = d["method"]
        out["n_days_tested"] = v.get("n_days_tested")
        out["n_unusual_days"] = len(days)
        out["strongest_unusual_days"] = days[:8]
        out["coverage"] = {x: cov.get(x) for x in ("days_in_period", "days_with_city_value")}
    elif k == "weather_relationship":
        out["coverage"] = {"matched_days": cov.get("matched_days"), "days_in_period": cov.get("days_in_period")}
        out.update({x: v.get(x) for x in ("spearman_rho", "strength", "n_days", "groups", "statement")})
        out["wording"] = "association only: use 'associated with', never cause words"
    elif k == "coverage_summary":
        out["coverage"] = {"by_pollutant": v["pollutants"], "days_in_period": cov.get("days_in_period")}
        out["quality"] = {x: d["quality"].get(x) for x in ("severity_counts", "n_severe_dates", "worst_severity")}
        out["stations"] = d["stations"]
    else:   # diwali_aqi_percent, delhi_pm_context
        out["values"] = v
        out["method"] = d.get("method")
    return out


def _store(ctx: RunContext[RunDeps], name: str, res) -> dict:
    d = res.to_dict()
    deps = ctx.deps
    ds = deps.session.add_dataset(d, compact(d))
    deps.run_datasets.append(ds)
    c = deps.session.compact[ds]
    deps.event("tool_result", f"{name}: {d['title']}", dataset_id=ds, data_type=c["data_category"],
               warnings=len(d["warnings"]))
    return c


def _err(ctx: RunContext[RunDeps], name: str, e: Exception) -> dict:
    if isinstance(e, ValueError):
        msg = str(e)
    else:
        msg = "The analysis could not be completed for these inputs."
    ctx.deps.event("tool_error", f"{name} failed", error=msg)
    return {"error": msg, "supported_cities": R.SUPPORTED_CITIES, "pollutants": ["pm25", "pm10"]}


def _call(ctx: RunContext[RunDeps], name: str, args: dict, fn) -> dict:
    ctx.deps.tools_called.append(name)
    ctx.deps.event("tool_call", name, args=args)
    c = ctx.deps.session.context
    for k in ("city", "cities", "pollutant", "period", "years", "weather"):
        if args.get(k) is not None:
            c[k] = args[k]
    try:
        return _store(ctx, name, fn())
    except Exception as e:     # never leak tracebacks to the model or the user
        return _err(ctx, name, e)


def _date(s: str) -> date:
    return date.fromisoformat(s)


def _city(c: str) -> str:
    r = R.resolve_city(c)
    if not r.get("city"):
        raise ValueError(r["message"])
    return r["city"]


# ----------------------------------------------------------------------------- tools
def resolve_request(ctx: RunContext[RunDeps], intent: Intent, plan: str, cities: list[str] | None = None,
                    pollutant: str | None = None, period: str | None = None, event: str | None = None) -> dict:
    """Check an unclear or possibly unsupported city, pollutant, period or event, and data availability.
    Pass the user's words and a one-sentence plan."""
    deps = ctx.deps
    deps.tools_called.append("resolve_request")
    deps.event("plan", plan[:300], intent=intent)
    out = R.resolve(cities, pollutant, period, event)
    slim = {"cities": out["cities"], "unsupported_cities": out["unsupported_cities"],
            "supported_cities": out["supported_cities"]}
    for k in ("pollutant", "period", "event"):
        if any(v for kk, v in out[k].items() if kk != "input"):
            slim[k] = {kk: v for kk, v in out[k].items() if kk != "input"}
    notes = [c.get("note") for c in out["city_details"] if c.get("note")]
    if notes:
        slim["notes"] = notes
    deps.session.other_payloads.append(slim)
    ctx_update = {k: v for k, v in {"cities": out["cities"] or None,
                                     "pollutant": out["pollutant"].get("pollutant"),
                                     "period": out["period"] if out["period"].get("start") else None,
                                     "event": out["event"] if out["event"].get("event") else None}.items() if v}
    deps.session.context.update(ctx_update)
    deps.event("tool_result", "resolve_request", unsupported=out["unsupported_cities"])
    return slim


def _period(period: str | None) -> tuple[date, date, list[str]]:
    r = R.resolve_period(period or "all data")
    if not r.get("start"):
        raise ValueError(r["message"])
    return _date(r["start"]), _date(r["end"]), r.get("notes", [])


def _pol(p: str | None) -> str:
    r = R.resolve_pollutant(p or "PM2.5")
    if r.get("pollutant") not in ("pm25", "pm10"):
        raise ValueError(r.get("message") or "This tool needs PM2.5 or PM10 (official AQI is only available for Diwali).")
    return r["pollutant"]


def _with_notes(fn, notes_holder: list):
    def run():
        res = fn()
        res.warnings = notes_holder + res.warnings
        return res
    return run


def city_trend(ctx: RunContext[RunDeps], city: str, pollutant: str = "PM2.5", period: str = "all data",
               freq: Literal["M", "W", "D"] = "M") -> dict:
    """Measured PM trend for one city: monthly (M), weekly (W) or daily (D) means with coverage.
    city/pollutant/period may be the user's words, e.g. 'Bombay', 'PM10', 'winter 2025', 'last 30 days'."""
    def go():
        s, e, n = _period(period)
        return _with_notes(lambda: F.city_trend(ctx.deps.session.store, _city(city), _pol(pollutant), s, e, freq), n)()
    return _call(ctx, "city_trend", locals_(city=city, pollutant=pollutant, period=period, freq=freq), go)


def compare_cities(ctx: RunContext[RunDeps], cities: list[str], pollutant: str = "PM2.5",
                   period: str = "all data") -> dict:
    """Compare measured PM across 2-6 cities on days when every city has data; ranked highest first."""
    def go():
        s, e, n = _period(period)
        return _with_notes(lambda: F.compare_cities(ctx.deps.session.store, [_city(c) for c in cities],
                                                    _pol(pollutant), s, e), n)()
    return _call(ctx, "compare_cities", locals_(cities=cities, pollutant=pollutant, period=period), go)


def diwali_official_aqi(ctx: RunContext[RunDeps], city: str, years: list[int]) -> dict:
    """MAIN Diwali result: official CPCB AQI levels, categories and bulletin dates on the festival days
    (years 2024, 2025, 2026). No percentages."""
    ys = tuple(sorted({int(y) for y in years}))
    return _call(ctx, "diwali_official_aqi", locals_(city=city, years=list(ys)),
                 lambda: F.diwali_aqi(ctx.deps.session.store, _city(city), ys))


def diwali_aqi_percent_change(ctx: RunContext[RunDeps], city: str, year: int) -> dict:
    """ONLY if the user explicitly asks for a percentage change in Diwali AQI. Official AQI vs the week
    before; a single value only when baselines agree, otherwise a range. Never for PM."""
    return _call(ctx, "diwali_aqi_percent_change", locals_(city=city, year=year),
                 lambda: F.diwali_aqi_percent(ctx.deps.session.store, _city(city), int(year)))


def delhi_pm_diwali_context(ctx: RunContext[RunDeps], year: int) -> dict:
    """Supporting context only: Delhi measured PM around Diwali 2024/2025 (lower bounds: the source
    blanks values above 999). Never a percentage."""
    return _call(ctx, "delhi_pm_diwali_context", locals_(year=year),
                 lambda: F.delhi_pm_context(ctx.deps.session.store, int(year)))


def unusual_days(ctx: RunContext[RunDeps], city: str, pollutant: str = "PM2.5", period: str = "all data") -> dict:
    """Unusually high/low measured PM days (15-day rolling median method, explained in the result)."""
    def go():
        s, e, n = _period(period)
        return _with_notes(lambda: F.unusual_days(ctx.deps.session.store, _city(city), _pol(pollutant), s, e), n)()
    return _call(ctx, "unusual_days", locals_(city=city, pollutant=pollutant, period=period), go)


def weather_association(ctx: RunContext[RunDeps], city: str, weather: WeatherVar, pollutant: str = "PM2.5",
                        period: str = "all data") -> dict:
    """Association (never cause) between measured PM and modelled weather: temperature, humidity, wind or rain."""
    def go():
        s, e, n = _period(period)
        return _with_notes(lambda: F.weather_relationship(ctx.deps.session.store, _city(city), _pol(pollutant),
                                                          WEATHER_COL[weather], s, e), n)()
    return _call(ctx, "weather_association", locals_(city=city, weather=weather, pollutant=pollutant, period=period), go)


def data_coverage(ctx: RunContext[RunDeps], city: str, period: str = "all data") -> dict:
    """Stations, coverage, excluded hours and data-quality severity for a city and period."""
    def go():
        s, e, n = _period(period)
        return _with_notes(lambda: F.coverage_summary(ctx.deps.session.store, _city(city), s, e), n)()
    return _call(ctx, "data_coverage", locals_(city=city, period=period), go)


def dataset_details(ctx: RunContext[RunDeps], dataset_id: str,
                    part: Literal["all_unusual_days", "periods", "diwali_context_days", "station_ids"]) -> dict:
    """More detail from an earlier result (max 30 rows), e.g. for follow-up questions."""
    deps = ctx.deps
    deps.tools_called.append("dataset_details")
    deps.event("tool_call", "dataset_details", args={"dataset_id": dataset_id, "part": part})
    d = deps.session.datasets.get(dataset_id)
    if d is None:
        return {"error": f"unknown dataset_id {dataset_id}"}
    v = d["values"]
    if part == "all_unusual_days":
        rows = v.get("unusual_days", [])
    elif part == "periods":
        rows = v.get("periods", [])
    elif part == "diwali_context_days":
        rows = [p for s in (d.get("chart") or {}).get("series", []) for p in s.get("data", []) if isinstance(p, dict)]
    else:
        rows = (d.get("stations") or {}).get("location_ids", [])
    payload = {"dataset_id": dataset_id, "part": part, "rows": rows[:30], "n_rows": len(rows)}
    deps.session.other_payloads.append(payload)
    return payload


def locals_(**kw) -> dict[str, Any]:
    return kw


TOOLS = [resolve_request, city_trend, compare_cities, diwali_official_aqi, diwali_aqi_percent_change,
         delhi_pm_diwali_context, unusual_days, weather_association, data_coverage, dataset_details]
