"""Derive step: severity levels, default flag rule, impossible PM2.5>PM10, peer outliers,
Diwali AQI tables (percent pending) and blank-rate definitions."""
from datetime import date, timedelta

import numpy as np
import pandas as pd
import pytest

from backend.pipeline import config as C
from backend.pipeline import derive as Dv

IST = C.IST


@pytest.mark.parametrize("gh,run,expected", [(0, 0, "none"), (1, 1, "minor"), (2, 2, "minor"),
                                             (3, 3, "moderate"), (2, 6, "moderate"), (8, 8, "severe"),
                                             (1, 30, "severe")])
def test_classify_severity(gh, run, expected):
    assert Dv.classify_severity(gh, run) == expected


def test_severity_table_unions_network_and_city_gaps_and_counts_cities():
    t = lambda s: pd.Timestamp(s, tz=IST)
    gaps = pd.DataFrame([
        {"source": "S", "scope": "all_cities", "gap_start": t("2025-10-20 10:00"), "gap_end": t("2025-10-20 14:00")},
        {"source": "S", "scope": "Delhi", "gap_start": t("2025-10-20 20:00"), "gap_end": t("2025-10-21 00:00")},
        {"source": "S", "scope": "all_cities", "gap_start": t("2026-01-10 18:00"), "gap_end": t("2026-01-12 18:00")},
    ])
    days = [date(2025, 10, 20), date(2025, 10, 22), date(2026, 1, 11)]
    sev = Dv.severity_table(gaps, {"Delhi": days, "Mumbai": days}, "S").set_index(["city", "local_date"])
    assert sev.loc[("Delhi", date(2025, 10, 20)), "gap_hours"] == 8          # 4 network + 4 city
    assert sev.loc[("Delhi", date(2025, 10, 20)), "severity"] == "severe"
    assert sev.loc[("Mumbai", date(2025, 10, 20)), "severity"] == "moderate"  # only the 4 network hours
    assert sev.loc[("Mumbai", date(2025, 10, 22)), "severity"] == "none"
    assert sev.loc[("Mumbai", date(2026, 1, 11)), "longest_run_hours"] == 48
    assert sev.loc[("Mumbai", date(2026, 1, 11)), "severity"] == "severe"
    assert sev.loc[("Delhi", date(2025, 10, 20)), "n_cities_affected"] == 2


def _hourly(values, flat=None, spike=None):
    hours = pd.date_range("2025-06-15", periods=len(values), freq="h", tz=IST)
    return pd.DataFrame({"sensor_key": "openaq:1", "location_id": 1, "pollutant": "pm25", "hour": hours,
                         "value": values, "n_readings": 4, "n_above_1000": 0, "expected": 4, "valid_hour": True,
                         "flag_flatline": flat if flat is not None else False,
                         "flag_spike": spike if spike is not None else False})


def test_default_rule_excludes_flagged_hours_but_keeps_all_hours_value():
    vals = [50.0] * 24
    vals[5] = 950.0
    spike = [i == 5 for i in range(24)]
    d = Dv.daily_with_flag_rule(_hourly(vals, spike=spike)).iloc[0]
    assert d.daily_mean == 50.0 and d.valid_hours == 23
    assert d.daily_mean_all_hours == pytest.approx(np.mean(vals))
    assert d.n_flagged_hours_excluded == 1


def test_default_rule_can_invalidate_a_day():
    flat = [i < 10 for i in range(24)]
    d = Dv.daily_with_flag_rule(_hourly([20.0] * 24, flat=flat)).iloc[0]
    assert not d.is_valid_day and np.isnan(d.daily_mean) and d.valid_hours_all == 24


def _daily(rows):
    return pd.DataFrame([{"source": "S", "city": "Chennai", "is_valid_day": True, **r} for r in rows])


def test_pm25_greater_than_pm10_flags_both_rows():
    d = _daily([{"location_id": 1, "local_date": date(2025, 8, 17), "pollutant": "pm25", "daily_mean": 1553.0},
                {"location_id": 1, "local_date": date(2025, 8, 17), "pollutant": "pm10", "daily_mean": 44.0},
                {"location_id": 2, "local_date": date(2025, 8, 17), "pollutant": "pm25", "daily_mean": 30.0},
                {"location_id": 2, "local_date": date(2025, 8, 17), "pollutant": "pm10", "daily_mean": 28.0}])
    assert Dv.pm25_exceeds_pm10(d).tolist() == [True, True, False, False]   # 30 vs 28 is measurement error


def test_peer_outlier_day():
    rows = [{"location_id": i, "local_date": date(2025, 8, 17), "pollutant": "pm25", "daily_mean": v}
            for i, v in enumerate([288.0, 30.0, 35.0, 28.0, 40.0])]
    assert Dv.peer_outlier_days(_daily(rows)).tolist() == [True, False, False, False, False]
    regional = [{**r, "daily_mean": 300.0 + i} for i, r in enumerate(rows)]     # whole city high
    assert not Dv.peer_outlier_days(_daily(regional)).any()


def test_diwali_aqi_table_levels_and_pending_percent():
    D = C.diwali_date(2025)
    rows = [{"city": "Delhi", "bulletin_date": D + timedelta(days=k), "aqi": 100.0 if k <= -7 else 300.0,
             "aqi_category": "x", "prominent_pollutant": "PM2.5", "no_stations": 35} for k in range(-20, 6)]
    levels, base = Dv.diwali_aqi_table(pd.DataFrame(rows), years=(2025,))
    fest = levels[levels.role == "festival"]
    assert [str(d) for d in fest.bulletin_date] == ["2025-10-21", "2025-10-22"]
    assert set(base.percent_status) == {"pending_user_approval"}
    w1 = base.set_index("window").loc["W1_d14_d8"]
    assert w1.bulletin_dates == "2025-10-07..2025-10-13" and w1.baseline_aqi == 100.0


def test_blank_rate_definition_uses_interval_start_and_night_window():
    ts = pd.date_range("2025-10-20 18:15", "2025-10-21 06:00", freq="15min", tz=IST)   # 48 slots
    raw = pd.DataFrame({"location_id": 1, "pollutant": "pm25", "ts": ts,
                        "value": [np.nan if i < 12 else 50.0 for i in range(len(ts))]})
    assert Dv.blank_rates(raw, {1}, "pm25", [date(2025, 10, 20)]) == pytest.approx(12 / 48)
