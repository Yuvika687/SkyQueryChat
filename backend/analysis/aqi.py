"""CPCB National AQI sub-index for PM2.5 and PM10 (24-hour average concentrations, µg/m³).

Used ONLY to cross-check our measured PM against official bulletin AQI. A "PM-only AQI
estimate" is not the official AQI: the official value uses up to 8 pollutants.
Top band: CPCB defines 401-500 for PM2.5 > 250 and PM10 > 430; the upper concentrations
used for interpolation (380 / 510) follow the CPCB AQI calculator convention. Capped at 500.
"""
from __future__ import annotations

import numpy as np

# (C_lo, C_hi, I_lo, I_hi)
BREAKPOINTS = {
    "pm25": [(0, 30, 0, 50), (30, 60, 50, 100), (60, 90, 100, 200), (90, 120, 200, 300),
             (120, 250, 300, 400), (250, 380, 400, 500)],
    "pm10": [(0, 50, 0, 50), (50, 100, 50, 100), (100, 250, 100, 200), (250, 350, 200, 300),
             (350, 430, 300, 400), (430, 510, 400, 500)],
}


def sub_index(pollutant: str, conc: float) -> float:
    if conc is None or np.isnan(conc) or conc < 0:
        return np.nan
    for c_lo, c_hi, i_lo, i_hi in BREAKPOINTS[pollutant]:
        if conc <= c_hi:
            return i_lo + (i_hi - i_lo) * (conc - c_lo) / (c_hi - c_lo)
    return 500.0


CATEGORIES = [(50, "Good"), (100, "Satisfactory"), (200, "Moderate"), (300, "Poor"),
              (400, "Very Poor"), (500, "Severe")]


def category(aqi: float) -> str | None:
    if aqi is None or np.isnan(aqi):
        return None
    for hi, name in CATEGORIES:
        if aqi <= hi:
            return name
    return "Severe"
