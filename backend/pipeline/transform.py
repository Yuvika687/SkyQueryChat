"""Pure transformation functions: raw readings -> clean readings -> hourly -> daily -> city.

Every function is deterministic and side-effect free so it can be unit-tested.
Nothing here invents values: missing stays missing, invalid values are removed and counted.

Canonical reading schema (one row per sensor reading):
    sensor_key  str   "openaq:<sensor_id>" or "opencity:<location_id>:<pollutant>"
    location_id int   OpenAQ location id
    pollutant   str   "pm25" | "pm10"
    units       str
    ts          datetime64[ns, Asia/Kolkata]   END of the reading interval, IST
                (verified: OpenAQ archive ts == API period.datetimeTo; OpenCity uses the same labels)
    value       float
"""
from __future__ import annotations

import math

import numpy as np
import pandas as pd

from . import config as C

READING_COLS = ["sensor_key", "location_id", "pollutant", "units", "ts", "value"]


# --------------------------------------------------------------------------- readers
def read_archive_csv(path_or_buf) -> pd.DataFrame:
    """OpenAQ S3 archive file (one location, one IST day). Timestamps carry +05:30."""
    df = pd.read_csv(path_or_buf, compression="infer")
    df = df[df["parameter"].isin(C.POLLUTANTS)]
    out = pd.DataFrame({
        "sensor_key": "openaq:" + df["sensors_id"].astype(str),
        "location_id": df["location_id"].astype("int64"),
        "pollutant": df["parameter"],
        "units": df["units"],
        "ts": pd.to_datetime(df["datetime"], utc=True).dt.tz_convert(C.IST),
        "value": pd.to_numeric(df["value"], errors="coerce"),
    })
    return out[READING_COLS].reset_index(drop=True)


OPENCITY_COLS = {"pm25": "PM2.5 (µg/m³)", "pm10": "PM10 (µg/m³)"}


def read_opencity_csv(path_or_buf, location_id: int) -> pd.DataFrame:
    """OpenCity Delhi CPCB file. Timestamps are labelled +0000 but are IST
    (verified against OpenAQ archive), so the label is ignored and IST is applied."""
    df = pd.read_csv(path_or_buf, usecols=["Timestamp", *OPENCITY_COLS.values()])
    ts = pd.to_datetime(df["Timestamp"].str[:19]).dt.tz_localize(C.IST)
    parts = []
    for pol, col in OPENCITY_COLS.items():
        parts.append(pd.DataFrame({
            "sensor_key": f"opencity:{location_id}:{pol}",
            "location_id": location_id,
            "pollutant": pol,
            "units": C.UNITS,
            "ts": ts,
            "value": pd.to_numeric(df[col], errors="coerce"),
        }))
    return pd.concat(parts, ignore_index=True)[READING_COLS]


def align_to_archive_slots(df: pd.DataFrame) -> tuple[pd.DataFrame, int]:
    """Until ~Aug 2026 OpenAQ (archive and API) is missing the readings whose interval
    ENDS at 00:00, 00:15 and 00:30 IST (verified 2026-11-03). Use this ONLY when a
    comparison mixes OpenCity with old-format OpenAQ data: it drops the same slots from
    the OpenCity side so both use identical intervals. Returns (df, n_dropped)."""
    minute_of_day = df["ts"].dt.hour * 60 + df["ts"].dt.minute
    drop = minute_of_day < 45
    return df[~drop].reset_index(drop=True), int(drop.sum())


# --------------------------------------------------------------------------- cleaning
def clean_readings(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Remove (never alter) bad readings and count each reason per sensor.

    Returns (clean_df, log_df). log_df has one row per sensor_key with counts:
    n_raw, n_missing, n_dup_exact, n_dup_conflict, n_bad_units, n_nonpositive,
    n_above_max (> 5000, removed), n_above_1000 (kept, flagged), n_kept.
    """
    d = df.copy()
    log = d.groupby("sensor_key").size().rename("n_raw").to_frame()

    def count(mask, name):
        log[name] = d[mask].groupby("sensor_key").size().reindex(log.index, fill_value=0)

    m = d["value"].isna(); count(m, "n_missing"); d = d[~m]
    dup_all = d.duplicated(["sensor_key", "ts", "value"], keep="first")
    count(dup_all, "n_dup_exact"); d = d[~dup_all]
    conflict = d.duplicated(["sensor_key", "ts"], keep=False)
    count(conflict, "n_dup_conflict"); d = d[~conflict]   # same time, different values: drop all
    m = d["units"] != C.UNITS; count(m, "n_bad_units"); d = d[~m]
    m = d["value"] <= C.VALUE_MIN_EXCLUSIVE; count(m, "n_nonpositive"); d = d[~m]
    m = d["value"] > C.VALUE_MAX_INCLUSIVE; count(m, "n_above_max"); d = d[~m]
    count(d["value"] > C.FLAG_HIGH, "n_above_1000")    # flagged, KEPT
    log["n_kept"] = d.groupby("sensor_key").size().reindex(log.index, fill_value=0)
    return d.sort_values(["sensor_key", "ts"]).reset_index(drop=True), log.reset_index()


# --------------------------------------------------------------------------- hourly
def native_interval_minutes(ts: pd.Series) -> int:
    """Typical reporting interval of a sensor in minutes (median spacing, 1..60)."""
    u = ts.drop_duplicates().sort_values()
    if len(u) < 2:
        return 60
    med = u.diff().dropna().dt.total_seconds().median() / 60
    return int(min(60, max(1, round(med))))


def to_hourly(clean: pd.DataFrame) -> pd.DataFrame:
    """Aggregate clean readings into IST clock hours with no overlapping windows.
    Timestamps label the END of each interval, so a reading belongs to the hour in which
    its interval STARTS: hour = floor(ts - native_interval, hour)."""
    if clean.empty:
        return pd.DataFrame(columns=["sensor_key", "location_id", "pollutant", "hour", "value",
                                     "n_readings", "n_above_1000", "expected", "valid_hour"])
    out = []
    for key, g in clean.groupby("sensor_key", sort=False):
        interval = native_interval_minutes(g["ts"])
        expected = max(1, 60 // interval)
        start = g["ts"] - pd.Timedelta(minutes=interval)
        h = g.assign(hour=start.dt.floor("h"), hi=g["value"] > C.FLAG_HIGH).groupby("hour").agg(
            value=("value", "mean"), n_readings=("value", "size"), n_above_1000=("hi", "sum"))
        h["expected"] = expected
        h["valid_hour"] = h["n_readings"] >= math.ceil(C.MIN_VALID_READING_FRACTION_PER_HOUR * expected)
        h = h.reset_index()
        h.insert(0, "sensor_key", key)
        h.insert(1, "location_id", g["location_id"].iat[0])
        h.insert(2, "pollutant", g["pollutant"].iat[0])
        out.append(h)
    return pd.concat(out, ignore_index=True)


# --------------------------------------------------------------------------- daily
def to_daily(hourly: pd.DataFrame) -> pd.DataFrame:
    """One row per sensor and IST local date. daily_mean is the mean of VALID hours and
    is only reported when valid_hours >= MIN_VALID_HOURS_PER_DAY; otherwise it is NaN."""
    h = hourly.assign(local_date=hourly["hour"].dt.date)
    vh = h[h["valid_hour"]]
    extra = {c: (c, "sum") for c in ("n_above_1000", "flag_flatline", "flag_spike") if c in h}
    agg = h.groupby(["sensor_key", "location_id", "pollutant", "local_date"]).agg(
        hours_with_data=("hour", "size"), **extra)
    v = vh.groupby(["sensor_key", "location_id", "pollutant", "local_date"]).agg(
        valid_hours=("hour", "size"), mean_valid=("value", "mean"),
        max_hourly=("value", "max"))
    d = agg.join(v, how="left").reset_index()
    d["valid_hours"] = d["valid_hours"].fillna(0).astype("int64")
    for c in extra:
        d[c] = d[c].astype("int64")
    d = d.rename(columns={"n_above_1000": "n_readings_above_1000",
                          "flag_flatline": "n_flatline_hours", "flag_spike": "n_spike_hours"})
    d["coverage"] = d["valid_hours"] / 24.0
    d["is_valid_day"] = d["valid_hours"] >= C.MIN_VALID_HOURS_PER_DAY
    d["daily_mean"] = np.where(d["is_valid_day"], d["mean_valid"], np.nan)
    d["max_hourly"] = np.where(d["is_valid_day"], d["max_hourly"], np.nan)
    return d.drop(columns=["mean_valid"])


# --------------------------------------------------------------------------- city
def min_stations_required(n_primary: int) -> int:
    return max(C.CITY_MIN_STATIONS_ABS, math.ceil(C.CITY_MIN_STATIONS_FRACTION * n_primary))


def city_daily(daily: pd.DataFrame, n_primary_by_city: dict[str, int]) -> pd.DataFrame:
    """Equal-weight mean of valid station-days (input must already be primary stations
    with a 'city' column). City value is NaN unless enough stations are valid."""
    v = daily[daily["is_valid_day"]]
    g = v.groupby(["city", "pollutant", "local_date"]).agg(
        n_valid_stations=("daily_mean", "size"),
        city_mean=("daily_mean", "mean"),
        city_median=("daily_mean", "median"),
        station_min=("daily_mean", "min"),
        station_max=("daily_mean", "max"),
    ).reset_index()
    g["n_primary_stations"] = g["city"].map(n_primary_by_city)
    g["min_stations_required"] = g["n_primary_stations"].map(min_stations_required)
    g["meets_rule"] = g["n_valid_stations"] >= g["min_stations_required"]
    for col in ("city_mean", "city_median", "station_min", "station_max"):
        g[col] = np.where(g["meets_rule"], g[col], np.nan)
    return g


# --------------------------------------------------------------------------- bulletins
def align_bulletins(b: pd.DataFrame) -> pd.DataFrame:
    """Add the real reporting window to CPCB bulletin rows: the bulletin dated X is the
    average of 16:00 IST on X-1 to 16:00 IST on X."""
    out = b.copy()
    d = pd.to_datetime(out["date"])
    out["period_end_ist"] = (d + pd.Timedelta(hours=16)).dt.tz_localize(C.IST)
    out["period_start_ist"] = out["period_end_ist"] - pd.Timedelta(hours=24)
    # The evening/night of local day L is reported in the bulletin dated L+1.
    out["evening_of_local_date"] = (d - pd.Timedelta(days=1)).dt.date
    return out
