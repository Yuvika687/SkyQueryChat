"""Warnings that must reach the user whatever the model writes. Code picks them from each tool
result's type and flags, so the answer never depends on the model remembering them."""
from __future__ import annotations

from backend.analysis.functions import CAUSAL_WARNING

TEXT = {
    "source_limit_999": "Values above 999 µg/m³ are blank in this source (CPCB via OpenCity), so these PM "
                        "values are lower bounds. Supporting context only; the main Diwali result is official AQI.",
    "aqi_not_concentration": "Official AQI is an index of several pollutants, not a PM2.5 or PM10 concentration.",
    "not_causal": CAUSAL_WARNING,
    "modelled_weather": "Weather values are modelled (Open-Meteo reanalysis), not measured.",
    "association_not_cause": "This is an association, not a cause.",
}


def required_warnings(full: dict) -> list[dict]:
    """[{code, text}] for one stored tool result."""
    kind, dt = full.get("kind", ""), str(full.get("data_type", "")).lower()
    warns = full.get("warnings") or []
    out = []
    if kind == "delhi_pm_context" or "999" in dt:
        out.append("source_limit_999")
    if "aqi" in kind or "official" in dt:
        out.append("aqi_not_concentration")
    if kind.startswith("diwali"):
        out.append("not_causal")
    if "modelled" in dt:
        out.append("modelled_weather")
    if kind.startswith("weather"):
        out.append("association_not_cause")
    res = [{"code": c, "text": TEXT[c]} for c in out]
    for w in warns:                                   # data-specific ones keep their own wording
        lw = w.lower()
        if "peer outlier" in lw and "25%" in w:
            res.append({"code": "peer_outlier", "text": w})
        elif "incomplete" in lw and "measured pm" in lw:
            res.append({"code": "pm_incomplete", "text": w})
        elif "not yet available" in lw or "not available" in lw or "no measured pm data" in lw:
            res.append({"code": "no_data", "text": w})
    return res
