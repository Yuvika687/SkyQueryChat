"""Typed result envelope shared by every analysis function, plus chart specifications.

Every number an answer may quote lives in `values` (or `chart`), produced by Python.
"""
from __future__ import annotations

import math
from dataclasses import asdict, dataclass, field
from datetime import date
from typing import Any

# CPCB AQI category colours (used ONLY for data meaning). Verified 2026-11-06 against the fill colours in
# CPCB "About National Air Quality Index" (cpcb.gov.in, About_AQI.pdf).
AQI_COLOURS = {"Good": "#00B050", "Satisfactory": "#92D050", "Moderate": "#FFFF00",
               "Poor": "#FF6500", "Very Poor": "#FF0000", "Severe": "#C00000"}


@dataclass
class ChartSpec:
    type: str                                   # "line" | "bar" | "calendar_heatmap" | "scatter"
    title: str
    x: dict[str, Any]
    y: dict[str, Any]
    series: list[dict[str, Any]]
    units: str
    bands: list[dict[str, Any]] = field(default_factory=list)   # e.g. festival periods
    colour_scale: str | None = None            # "cpcb_aqi" when colours carry AQI meaning
    notes: list[str] = field(default_factory=list)


@dataclass
class AnalysisResult:
    kind: str
    title: str
    metric: str
    units: str
    data_type: str
    source: str
    date_range: dict[str, str | None]
    stations: dict[str, Any]
    coverage: dict[str, Any]
    quality: dict[str, Any]
    method: str
    warnings: list[str]
    values: dict[str, Any]
    chart: ChartSpec | None = None

    def to_dict(self) -> dict[str, Any]:
        return _clean(asdict(self))


def _clean(x):
    """JSON-safe: NaN -> None, dates -> ISO strings, numpy scalars -> Python."""
    if isinstance(x, dict):
        return {k: _clean(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [_clean(v) for v in x]
    if isinstance(x, date):
        return x.isoformat()
    if hasattr(x, "item") and not isinstance(x, (str, bytes)):
        try:
            x = x.item()
        except (ValueError, AttributeError):
            pass
    if isinstance(x, float) and math.isnan(x):
        return None
    return x


def r(x: float | None, nd: int = 1):
    """Round for presentation; keeps None/NaN as None."""
    if x is None:
        return None
    try:
        if math.isnan(x):
            return None
    except TypeError:
        return x
    return round(float(x), nd)
