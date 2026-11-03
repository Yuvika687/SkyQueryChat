"""Unit tests for backend/pipeline/transform.py (pure functions, no network)."""
import io
from datetime import date

import numpy as np
import pandas as pd
import pytest

from backend.pipeline import config as C
from backend.pipeline import transform as T

IST = C.IST


def readings(values, start="2025-06-15 00:15", freq="15min", key="openaq:1", pol="pm25", units=C.UNITS):
    ts = pd.date_range(start, periods=len(values), freq=freq, tz=IST)
    return pd.DataFrame({"sensor_key": key, "location_id": 1, "pollutant": pol, "units": units,
                         "ts": ts, "value": values})


# ----------------------------------------------------------------------------- readers
def test_read_archive_csv_keeps_pm_and_converts_to_ist():
    csv = ("location_id,sensors_id,location,datetime,lat,lon,parameter,units,value\n"
           "6358,11,X,2025-10-20T01:00:00+05:30,28.6,77.2,pm25,µg/m³,300\n"
           "6358,12,X,2025-10-20T01:00:00+05:30,28.6,77.2,no2,µg/m³,40\n"
           "6358,13,X,2025-10-19T19:30:00+00:00,28.6,77.2,pm10,µg/m³,500\n")
    df = T.read_archive_csv(io.StringIO(csv))
    assert set(df["pollutant"]) == {"pm25", "pm10"}
    assert str(df["ts"].dt.tz) == "Asia/Kolkata"
    # 19:30 UTC == 01:00 IST next day
    assert (df["ts"] == pd.Timestamp("2025-10-20 01:00", tz=IST)).all()
    assert df.loc[df.pollutant == "pm25", "sensor_key"].iat[0] == "openaq:11"


def test_read_opencity_ignores_utc_label_and_uses_ist():
    csv = ("Timestamp,PM2.5 (µg/m³),PM10 (µg/m³)\n"
           "2024-10-31T21:00:00.000000+0000,250.0,\n")
    df = T.read_opencity_csv(io.StringIO(csv), location_id=6358)
    assert (df["ts"] == pd.Timestamp("2024-10-31 21:00", tz=IST)).all()   # NOT shifted by 5.5 h
    assert df.set_index("pollutant").loc["pm25", "value"] == 250.0
    assert np.isnan(df.set_index("pollutant").loc["pm10", "value"])       # blank stays blank
    assert set(df["sensor_key"]) == {"opencity:6358:pm25", "opencity:6358:pm10"}


# ----------------------------------------------------------------------------- cleaning
def test_clean_counts_every_reason_and_keeps_high_values():
    df = readings([np.nan, 0.0, -3.0, 50.0, 50.0, 1500.0, 6000.0, 80.0])
    df.loc[4, "ts"] = df.loc[3, "ts"]            # exact duplicate of row 3 (same ts, same value)
    clean, log = T.clean_readings(df)
    r = log.iloc[0]
    assert r.n_raw == 8 and r.n_missing == 1 and r.n_dup_exact == 1
    assert r.n_nonpositive == 2 and r.n_above_max == 1
    assert r.n_above_1000 == 1                   # 1500 flagged...
    assert 1500.0 in clean["value"].values       # ...and KEPT
    assert 6000.0 not in clean["value"].values   # > 5000 removed
    assert r.n_kept == len(clean) == 3


def test_conflicting_duplicates_are_dropped_not_averaged():
    df = readings([10.0, 20.0, 30.0])
    df.loc[1, "ts"] = df.loc[0, "ts"]
    clean, log = T.clean_readings(df)
    assert log.iloc[0].n_dup_conflict == 2
    assert list(clean["value"]) == [30.0]


def test_bad_units_removed():
    df = readings([10.0, 20.0])
    df.loc[0, "units"] = "ppb"
    clean, log = T.clean_readings(df)
    assert log.iloc[0].n_bad_units == 1 and list(clean["value"]) == [20.0]


def test_align_to_archive_slots_drops_only_first_three_end_labels():
    df = readings([1.0] * 6, start="2025-06-15 00:00")   # ends 00:00,00:15,00:30,00:45,01:00,01:15
    out, n = T.align_to_archive_slots(df)
    assert n == 3
    assert out["ts"].dt.strftime("%H:%M").tolist() == ["00:45", "01:00", "01:15"]


# ----------------------------------------------------------------------------- hourly
def test_native_interval():
    assert T.native_interval_minutes(readings([1.0] * 5)["ts"]) == 15
    assert T.native_interval_minutes(readings([1.0] * 5, freq="60min")["ts"]) == 60


def test_hourly_uses_interval_start_and_has_no_overlap():
    # end labels 00:15..01:00 belong to hour 00; 01:15 belongs to hour 01
    df = readings([10.0, 20.0, 30.0, 40.0, 100.0], start="2025-06-15 00:15")
    h = T.to_hourly(df)
    h0 = h[h.hour == pd.Timestamp("2025-06-15 00:00", tz=IST)].iloc[0]
    assert h0.value == 25.0 and h0.n_readings == 4 and h0.valid_hour
    assert h["n_readings"].sum() == len(df)                 # every reading used exactly once
    assert not h.duplicated(["sensor_key", "hour"]).any()


def test_hour_validity_needs_75_percent():
    two = readings([10.0, 20.0], start="2025-06-15 00:15")
    two = pd.concat([two, readings([5.0] * 4, start="2025-06-15 03:15")])   # sets 15-min cadence
    h = T.to_hourly(two)
    assert not h[h.hour == pd.Timestamp("2025-06-15 00:00", tz=IST)].valid_hour.iat[0]   # 2 of 4
    three = readings([10.0, 20.0, 30.0], start="2025-06-15 00:15")
    assert T.to_hourly(three).valid_hour.iat[0]                                          # 3 of 4


def test_hourly_counts_values_above_1000():
    h = T.to_hourly(readings([900.0, 1200.0, 1300.0, 800.0], start="2025-10-20 23:15"))
    assert h.n_above_1000.iat[0] == 2


# ----------------------------------------------------------------------------- daily
def _hourly(n_valid, day="2025-06-15", value=50.0):
    hours = pd.date_range(day, periods=24, freq="h", tz=IST)
    return pd.DataFrame({"sensor_key": "openaq:1", "location_id": 1, "pollutant": "pm25",
                         "hour": hours, "value": value, "n_readings": 4, "expected": 4,
                         "valid_hour": [i < n_valid for i in range(24)]})


def test_daily_requires_16_valid_hours():
    ok = T.to_daily(_hourly(16)).iloc[0]
    assert ok.is_valid_day and ok.valid_hours == 16 and ok.daily_mean == 50.0
    assert ok.coverage == pytest.approx(16 / 24)
    bad = T.to_daily(_hourly(15)).iloc[0]
    assert not bad.is_valid_day and np.isnan(bad.daily_mean)     # never reported, never filled


def test_daily_uses_ist_local_date():
    h = _hourly(24, day="2025-06-15")
    d = T.to_daily(h)
    assert list(d.local_date) == [date(2025, 6, 15)]


def test_daily_mean_uses_only_valid_hours():
    h = _hourly(20)
    h.loc[~h.valid_hour, "value"] = 999.0
    assert T.to_daily(h).daily_mean.iat[0] == 50.0


# ----------------------------------------------------------------------------- city rule
@pytest.mark.parametrize("n,req", [(1, 3), (4, 3), (6, 3), (7, 4), (9, 5), (22, 11), (37, 19)])
def test_min_stations_required(n, req):
    assert T.min_stations_required(n) == req


def test_city_daily_rule_and_equal_weights():
    rows = []
    for i, v in enumerate([10.0, 20.0, 60.0]):
        rows.append({"city": "Chennai", "pollutant": "pm25", "local_date": date(2025, 6, 15),
                     "is_valid_day": True, "daily_mean": v, "sensor_key": f"s{i}"})
    rows.append({"city": "Chennai", "pollutant": "pm25", "local_date": date(2025, 6, 15),
                 "is_valid_day": False, "daily_mean": np.nan, "sensor_key": "s9"})
    cd = T.city_daily(pd.DataFrame(rows), {"Chennai": 6})
    r = cd.iloc[0]
    assert r.n_valid_stations == 3 and r.meets_rule and r.city_mean == 30.0
    cd2 = T.city_daily(pd.DataFrame(rows), {"Chennai": 9})        # needs 5
    assert not cd2.meets_rule.iat[0] and np.isnan(cd2.city_mean.iat[0])


# ----------------------------------------------------------------------------- bulletins & events
def test_bulletin_alignment_4pm_window():
    b = pd.DataFrame({"date": [date(2024, 11, 1)], "aqi": [339]})
    a = T.align_bulletins(b).iloc[0]
    assert a.period_end_ist == pd.Timestamp("2024-11-01 16:00", tz=IST)
    assert a.period_start_ist == pd.Timestamp("2024-10-31 16:00", tz=IST)
    assert a.evening_of_local_date == date(2024, 10, 31)


def test_festival_and_baseline_rule():
    assert C.festival_days(2024) == [date(2024, 10, 31), date(2024, 11, 1)]   # Delhi 31 Oct + 1 Nov
    assert C.festival_days(2025) == [date(2025, 10, 20), date(2025, 10, 21)]
    assert C.baseline_days(2025)[0] == date(2025, 10, 6) and C.baseline_days(2025)[-1] == date(2025, 10, 12)
    assert len(C.baseline_days(2024)) == 7
    assert C.bulletin_dates_for(C.festival_days(2024)) == [date(2024, 11, 1), date(2024, 11, 2)]
