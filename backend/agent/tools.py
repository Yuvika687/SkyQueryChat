"""Typed tools around the deterministic analysis functions. Python computes every number; a tool
returns {id, type, period, fields, notes} — named values only, never raw tables. No tool runs code.
Cities, pollutants and periods may be passed in the user's own words; the resolver handles them."""
from __future__ import annotations

import re
from datetime import date
from typing import Literal

from pydantic_ai import RunContext, Tool
from pydantic_ai.tools import ToolDefinition

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
    rq = dict(fctx.pop("resolved", None) or {})
    dr = d.get("date_range") or {}
    rq.setdefault("start", dr.get("start"))
    rq.setdefault("end", dr.get("end"))
    d["resolved"] = {"tool": name, **rq}
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


ALL_DATA = {"all", "all data", "all available data", "entire period", "whole period", "overall"}
POL_NAME = {"pm25": "PM2.5", "pm10": "PM10"}


def _city(c: str, assume: list[str] | None = None) -> str:
    r = R.resolve_city(c)
    if not r.get("city"):
        raise ValueError(r["message"])
    if assume is not None and c.strip().lower() != r["city"].lower():
        assume.append(f"read '{c.strip()}' as {r['city']}")
    return r["city"]


def _period(period: str | None, assume: list[str] | None = None) -> tuple[date, date, list[str]]:
    r = R.resolve_period(period or "all data")
    if not r.get("start"):
        raise ValueError(r["message"])
    if assume is not None:
        if not period or period.strip().lower() in ALL_DATA:
            assume.append(f"no period stated: used all measured data ({r['start']} to {r['end']})")
        assume += [n for n in r.get("notes", []) if "taken as" in n or "no year" in n or "relative to" in n
                   or "latest" in n]
    return date.fromisoformat(r["start"]), date.fromisoformat(r["end"]), r.get("notes", [])


def _pol(p: str | None, assume: list[str] | None = None) -> str:
    if not p and assume is not None:
        assume.append("pollutant not stated: used PM2.5")
    r = R.resolve_pollutant(p or "PM2.5")
    if r.get("pollutant") not in ("pm25", "pm10"):
        raise ValueError(r.get("message") or "Only PM2.5 and PM10 here; official AQI is used for Diwali.")
    return r["pollutant"]


def _rq(cities: list[str], pollutant: str, start=None, end=None, assume=None) -> dict:
    out = {"cities": cities, "pollutant": pollutant, "assumptions": list(dict.fromkeys(assume or []))}
    if start is not None:
        out.update(start=str(start), end=str(end))
    return out


def auto_freq(start, end) -> str:
    """Chart granularity only (the summary uses daily values either way): a 30-day question gets a daily line."""
    if start is None or end is None:
        return "M"
    days = (end - start).days + 1
    return "D" if days <= 92 else "W" if days <= 366 else "M"


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


def city_trend(ctx: RunContext[RunDeps], city: str, pollutant: str | None = None, period: str | None = None,
               freq: Literal["M", "W", "D"] | None = None) -> dict:
    """Measured PM trend for one city: mean, median, highest/lowest day, coverage, period means.
    pollutant defaults to PM2.5; period defaults to all data; freq defaults to daily for up to 92 days,
    weekly up to a year, else monthly."""
    def go():
        a = []
        s, e, n = _period(period, a)
        c, p = _city(city, a), _pol(pollutant, a)
        f = freq or auto_freq(s, e)
        return _noted(F.city_trend(ctx.deps.session.store, c, p, s, e, f), n), \
            {"city": c, "resolved": _rq([c], POL_NAME[p], s, e, a)}
    return _call(ctx, "city_trend", dict(city=city, pollutant=pollutant, period=period, freq=freq), go)


def compare_cities(ctx: RunContext[RunDeps], cities: list[str], pollutant: str | None = None,
                   period: str | None = None) -> dict:
    """Compare measured PM across 2-6 cities on days when every city has data; rank 1 = highest.
    pollutant defaults to PM2.5; period defaults to all data."""
    def go():
        a = []
        s, e, n = _period(period, a)
        cs, p = [_city(c, a) for c in cities], _pol(pollutant, a)
        return _noted(F.compare_cities(ctx.deps.session.store, cs, p, s, e), n), \
            {"resolved": _rq(cs, POL_NAME[p], s, e, a)}
    return _call(ctx, "compare_cities", dict(cities=cities, pollutant=pollutant, period=period), go)


def diwali_aqi(ctx: RunContext[RunDeps], city: str, years: list[int], percent: bool = False) -> dict:
    """Official CPCB AQI levels, categories and bulletin dates for Diwali (2024, 2025, 2026).
    percent=true ONLY if the user explicitly asks for a percentage change."""
    def go():
        a = []
        c = _city(city, a)
        ys = tuple(sorted({int(y) for y in years}))
        d = F.diwali_aqi(ctx.deps.session.store, c, ys).to_dict()
        if percent:
            d["values"]["percent"] = {}
            for y in ys:
                p = F.diwali_aqi_percent(ctx.deps.session.store, c, y).to_dict()
                d["values"]["percent"][y] = p
                d["warnings"] = [w for w in p["warnings"] if w not in d["warnings"]] + d["warnings"]
        dr = d.get("date_range") or {}
        a.append("Diwali " + ", ".join(str(y) for y in ys) + ": festival bulletins D+1 and D+2 (CPCB 4 PM-to-4 PM)")
        return d, {"city": c, "resolved": _rq([c], "AQI (official CPCB)", dr.get("start"), dr.get("end"), a)}
    return _call(ctx, "diwali_aqi", dict(city=city, years=years, percent=percent), go)


PM_ASKED = re.compile(r"\bpm\s*(2\.?5|10)?\b|particulate", re.I)
PM_HIDDEN = ("Delhi's measured PM around Diwali is shown only when the user asks about PM. "
             "Answer from the official AQI (diwali_aqi).")


async def only_if_pm_asked(ctx: RunContext[RunDeps], tool_def: ToolDefinition) -> ToolDefinition | None:
    """Default Diwali answers use the official AQI only: the Delhi PM tool is offered to the model only when
    this question mentions PM (e.g. "PM2.5", "pm10", "particulate")."""
    return tool_def if PM_ASKED.search(ctx.deps.question) else None


def delhi_pm_diwali(ctx: RunContext[RunDeps], year: int) -> dict:
    """Only when the user asks about PM: Delhi measured PM around Diwali 2024/2025 (OpenCity, lower bounds) or
    2026 (OpenAQ; not comparable with earlier years). Never a %."""
    def go():
        if not PM_ASKED.search(ctx.deps.question):
            raise ValueError(PM_HIDDEN)            # backstop; the tool is normally not offered (only_if_pm_asked)
        res = F.delhi_pm_context(ctx.deps.session.store, int(year))
        return res, {"city": "Delhi", "resolved": _rq(["Delhi"], "PM2.5 and PM10", res.date_range.get("start"),
                                                       res.date_range.get("end"),
                                                       [f"Diwali {year}: baseline D-14..D-8, festival D and D+1"])}
    return _call(ctx, "delhi_pm_diwali", dict(year=year), go)


def unusual_days(ctx: RunContext[RunDeps], city: str, pollutant: str | None = None, period: str | None = None) -> dict:
    """Unusually high/low measured PM days (15-day rolling median method). Defaults: PM2.5, all data."""
    def go():
        a = []
        s, e, n = _period(period, a)
        c, p = _city(city, a), _pol(pollutant, a)
        return _noted(F.unusual_days(ctx.deps.session.store, c, p, s, e), n), \
            {"city": c, "resolved": _rq([c], POL_NAME[p], s, e, a)}
    return _call(ctx, "unusual_days", dict(city=city, pollutant=pollutant, period=period), go)


def weather_association(ctx: RunContext[RunDeps], city: str, weather: WeatherVar, pollutant: str | None = None,
                        period: str | None = None) -> dict:
    """Association (not cause) between measured PM and modelled weather. Defaults: PM2.5, all data."""
    def go():
        a = []
        s, e, n = _period(period, a)
        c, p = _city(city, a), _pol(pollutant, a)
        return _noted(F.weather_relationship(ctx.deps.session.store, c, p, WEATHER_COL[weather], s, e), n), \
            {"city": c, "resolved": _rq([c], f"{POL_NAME[p]} vs {weather} (modelled)", s, e, a)}
    return _call(ctx, "weather_association", dict(city=city, weather=weather, pollutant=pollutant, period=period), go)


def data_coverage(ctx: RunContext[RunDeps], city: str, period: str | None = None) -> dict:
    """Stations, coverage, exclusions and data-quality severity for a city. Period defaults to all data."""
    def go():
        a = []
        s, e, n = _period(period, a)
        c = _city(city, a)
        return _noted(F.coverage_summary(ctx.deps.session.store, c, s, e), n), \
            {"city": c, "resolved": _rq([c], "PM2.5 and PM10", s, e, a)}
    return _call(ctx, "data_coverage", dict(city=city, period=period), go)


TOOLS = [check_request, city_trend, compare_cities, diwali_aqi, Tool(delhi_pm_diwali, prepare=only_if_pm_asked),
         unusual_days, weather_association, data_coverage]
