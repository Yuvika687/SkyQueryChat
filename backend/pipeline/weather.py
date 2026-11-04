"""Daily weather from the Open-Meteo Historical Weather API (reanalysis = MODELLED data).

Kept separate from pollution data. Local dates come from timezone=Asia/Kolkata.
Licence: CC BY 4.0 (non-commercial free tier). Attribution is stored with the data.
"""
from __future__ import annotations

import json
from datetime import date, timedelta
from pathlib import Path

import pandas as pd

from . import config as C
from .net import get

URL = "https://archive-api.open-meteo.com/v1/archive"
VARIABLES = {  # API name -> (column, expected unit)
    "temperature_2m_mean": ("temperature_mean_c", "°C"),
    "relative_humidity_2m_mean": ("relative_humidity_mean_pct", "%"),
    "wind_speed_10m_mean": ("wind_speed_mean_kmh", "km/h"),
    "precipitation_sum": ("precipitation_sum_mm", "mm"),
}
SOURCE = "Open-Meteo Historical Weather API (reanalysis; Copernicus C3S ERA5 family)"
ATTRIBUTION = ("Weather data by Open-Meteo.com (https://open-meteo.com/), CC BY 4.0; "
               "reanalysis from the Copernicus Climate Change Service (C3S).")
PRELIMINARY_DAYS = 7     # most recent days may be revised by later reanalysis
CACHE = C.RAW / "weather"


def fetch_city(city: str, start: date, end: date) -> dict:
    lat, lon = C.CITY_CENTRES[city]
    r = get(URL, params={"latitude": lat, "longitude": lon, "start_date": str(start), "end_date": str(end),
                         "daily": ",".join(VARIABLES), "timezone": "Asia/Kolkata"})
    r.raise_for_status()
    j = r.json()
    CACHE.mkdir(parents=True, exist_ok=True)
    (CACHE / f"{city}.json").write_text(json.dumps(j))
    return j


def parse(city: str, j: dict, fetched_on: date) -> pd.DataFrame:
    """Tidy one city's response. Fails loudly if units or timezone are not as expected."""
    if j.get("utc_offset_seconds") != 19800:
        raise ValueError(f"{city}: expected IST (19800 s), got {j.get('utc_offset_seconds')}")
    units = j["daily_units"]
    for api, (_, unit) in VARIABLES.items():
        if units.get(api) != unit:
            raise ValueError(f"{city}: unit for {api} is {units.get(api)!r}, expected {unit!r}")
    d = pd.DataFrame(j["daily"])
    out = pd.DataFrame({"city": city, "local_date": pd.to_datetime(d["time"]).dt.date})
    for api, (col, _) in VARIABLES.items():
        out[col] = pd.to_numeric(d[api], errors="coerce")
    out["grid_lat"], out["grid_lon"] = j["latitude"], j["longitude"]
    out["preliminary"] = out["local_date"] > fetched_on - timedelta(days=PRELIMINARY_DAYS)
    out["data_type"] = "modelled (reanalysis)"
    out["source"] = SOURCE
    out["attribution"] = ATTRIBUTION
    return out


def build(start: date, end: date, fetched_on: date, use_cache: bool = False) -> pd.DataFrame:
    parts = []
    for city in C.CITIES:
        f = CACHE / f"{city}.json"
        j = json.loads(f.read_text()) if (use_cache and f.exists()) else fetch_city(city, start, end)
        parts.append(parse(city, j, fetched_on))
    w = pd.concat(parts, ignore_index=True)
    if w.duplicated(["city", "local_date"]).any():
        raise AssertionError("weather_daily has duplicate city-dates")
    return w


UNITS = {col: unit for _, (col, unit) in VARIABLES.items()}
