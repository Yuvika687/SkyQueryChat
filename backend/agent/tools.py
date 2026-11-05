"""Typed tools around the deterministic analysis functions. Python computes every number; a tool
returns {id, type, period, fields, notes} — named values only, never raw tables. No tool runs code.
Cities, pollutants and periods may be passed in the user's own words; the resolver handles them."""
from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic_ai import RunContext

from backend.analysis import functions as F
from . import resolver as R
from .fields import TYPE_SHORT, fields_for, notes_for
from .session import RunDeps, data_type_of

WeatherVar = Literal["temperature", "humidity", "wind", "rain"]
WEATHER_COL = {"temperature": "temperature_mean_c", "humidity": "relative_humidity_mean_pct",
               "wind": "wind_speed_mean_kmh", "rain": "precipitation_sum_mm"}


def _payload(ds: str, d: dict, fields: dict) -> dict:
    dr = d.get("date_range") or {}
    out = {"id": ds, "type": TYPE_SHORT[data_type_of(d["data_type"])], "units": d["units"],
           "fields": {k: f.value for k, f in fields.items()}}
    if dr.get("start"):
        out["period"] = f"{dr['start']}..{dr['end']}"
    notes = notes_for(d["warnings"])
    if notes:
        out["notes"] = notes
    return out


def _store(ctx: RunContext[RunDeps], name: str, res, fctx: dict) -> dict:
    d = res.to_dict() if hasattr(res, "to_dict") else res
    deps = ctx.deps
    fields = fields_for(d, fctx)
    ds = deps.session.add_dataset(d, fields)
    payload = _payload(ds, d, fields)
    deps.session.compact[ds] = payload
    deps.run_datasets.append(ds)
    deps.event("tool_result", f"{name}: {d['title']}", dataset_id=ds, data_type=data_type_of(d["data_type"]),
               fields=len(fields), warnings=len(d["warnings"]))
    return payload


def _err(ctx: RunContext[RunDeps], name: str, e: Exception) -> dict:
    msg = str(e) if isinstance(e, ValueError) else "The analysis could not be completed for these inputs."
    ctx.deps.event("tool_error", f"{name} failed", error=msg)
    return {"error": msg}


def _call(ctx: RunContext[RunDeps], name: str, args: dict, fn) -> dict:
    ctx.deps.tools_called.append(name)
    ctx.deps.event("tool_call", name, args=args)
    c = ctx.deps.session.context
    for k in ("city", "cities", "pollutant", "period", "years", "weather"):
        if args.get(k) is not None:
            c[k] = args[k]
    try:
        res, fctx = fn()
        return _store(ctx, name, res, fctx)
    except Exception as e:     # never leak tracebacks to the model or the user
        return _err(ctx, name, e)


def _city(c: str) -> str:
    r = R.resolve_city(c)
    if not r.get("city"):
        raise ValueError(r["message"])
    return r["city"]


def _period(period: str | None) -> tuple[date, date, list[str]]:
    r = R.resolve_period(period or "all data")
    if not r.get("start"):
        raise ValueError(r["message"])
    return date.fromisoformat(r["start"]), date.fromisoformat(r["end"]), r.get("notes", [])


def _pol(p: str | None) -> str:
    r = R.resolve_pollutant(p or "PM2.5")
    if r.get("pollutant") not in ("pm25", "pm10"):
        raise ValueError(r.get("message") or "Only PM2.5 and PM10 here; official AQI is used for Diwali.")
    return r["pollutant"]


def _noted(res, notes: list[str]):
    res.warnings = notes + res.warnings
    return res


# ----------------------------------------------------------------------------- tools
def check_request(ctx: RunContext[RunDeps], cities: list[str] | None = None, pollutant: str | None = None,
                  period: str | None = None, event: str | None = None) -> dict:
    """Check unclear or unsupported cities, pollutant, period or event, and data availability."""
    deps = ctx.deps
    deps.tools_called.append("check_request")
    deps.event("tool_call", "check_request", args={"cities": cities, "pollutant": pollutant, "period": period, "event": event})
    out = R.resolve(cities, pollutant, period, event)
    slim = {"cities": out["cities"], "unsupported": out["unsupported_cities"], "supported": out["supported_cities"]}
    for k in ("pollutant", "period", "event"):
        x = {kk: vv for kk, vv in out[k].items() if kk != "input" and vv}
        if x:
            slim[k] = x
    deps.session.other_payloads.append(slim)
    deps.event("tool_result", "check_request", unsupported=out["unsupported_cities"])
    return slim


def city_trend(ctx: RunContext[RunDeps], city: str, pollutant: str = "PM2.5", period: str = "all data",
               freq: Literal["M", "W", "D"] = "M") -> dict:
    """Measured PM trend for one city: mean, median, highest/lowest day, coverage, period means."""
    def go():
        s, e, n = _period(period)
        c = _city(city)
        return _noted(F.city_trend(ctx.deps.session.store, c, _pol(pollutant), s, e, freq), n), {"city": c}
    return _call(ctx, "city_trend", dict(city=city, pollutant=pollutant, period=period, freq=freq), go)


def compare_cities(ctx: RunContext[RunDeps], cities: list[str], pollutant: str = "PM2.5", period: str = "all data") -> dict:
    """Compare measured PM across 2-6 cities on days when every city has data; rank 1 = highest."""
    def go():
        s, e, n = _period(period)
        return _noted(F.compare_cities(ctx.deps.session.store, [_city(c) for c in cities], _pol(pollutant), s, e), n), {}
    return _call(ctx, "compare_cities", dict(cities=cities, pollutant=pollutant, period=period), go)


def diwali_aqi(ctx: RunContext[RunDeps], city: str, years: list[int], percent: bool = False) -> dict:
    """Official CPCB AQI levels, categories and bulletin dates for Diwali (2024, 2025, 2026).
    percent=true ONLY if the user explicitly asks for a percentage change."""
    def go():
        c = _city(city)
        ys = tuple(sorted({int(y) for y in years}))
        d = F.diwali_aqi(ctx.deps.session.store, c, ys).to_dict()
        if percent:
            d["values"]["percent"] = {}
            for y in ys:
                p = F.diwali_aqi_percent(ctx.deps.session.store, c, y).to_dict()
                d["values"]["percent"][y] = p
                d["warnings"] = [w for w in p["warnings"] if w not in d["warnings"]] + d["warnings"]
        return d, {"city": c}
    return _call(ctx, "diwali_aqi", dict(city=city, years=years, percent=percent), go)


def delhi_pm_diwali(ctx: RunContext[RunDeps], year: int) -> dict:
    """Supporting context only: Delhi measured PM around Diwali 2024/2025 (lower bounds). Never a %."""
    return _call(ctx, "delhi_pm_diwali", dict(year=year),
                 lambda: (F.delhi_pm_context(ctx.deps.session.store, int(year)), {"city": "Delhi"}))


def unusual_days(ctx: RunContext[RunDeps], city: str, pollutant: str = "PM2.5", period: str = "all data") -> dict:
    """Unusually high/low measured PM days (15-day rolling median method)."""
    def go():
        s, e, n = _period(period)
        c = _city(city)
        return _noted(F.unusual_days(ctx.deps.session.store, c, _pol(pollutant), s, e), n), {"city": c}
    return _call(ctx, "unusual_days", dict(city=city, pollutant=pollutant, period=period), go)


def weather_association(ctx: RunContext[RunDeps], city: str, weather: WeatherVar, pollutant: str = "PM2.5",
                        period: str = "all data") -> dict:
    """Association (not cause) between measured PM and modelled weather."""
    def go():
        s, e, n = _period(period)
        c = _city(city)
        return _noted(F.weather_relationship(ctx.deps.session.store, c, _pol(pollutant), WEATHER_COL[weather], s, e), n), {"city": c}
    return _call(ctx, "weather_association", dict(city=city, weather=weather, pollutant=pollutant, period=period), go)


def data_coverage(ctx: RunContext[RunDeps], city: str, period: str = "all data") -> dict:
    """Stations, coverage, exclusions and data-quality severity for a city."""
    def go():
        s, e, n = _period(period)
        c = _city(city)
        return _noted(F.coverage_summary(ctx.deps.session.store, c, s, e), n), {"city": c}
    return _call(ctx, "data_coverage", dict(city=city, period=period), go)


TOOLS = [check_request, city_trend, compare_cities, diwali_aqi, delhi_pm_diwali, unusual_days,
         weather_association, data_coverage]
