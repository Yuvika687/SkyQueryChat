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


# ----------------------------------------------------------------------------- Day 2 rule changes
def _multi(values_by_sensor: dict[str, list[float]], start="2025-06-15 00:00", spike=None):
    rows = []
    for k, vals in values_by_sensor.items():
        hours = pd.date_range(start, periods=len(vals), freq="h", tz=IST)
        for i, (h, v) in enumerate(zip(hours, vals)):
            rows.append({"source": "S", "sensor_key": k, "location_id": int(k[-1]), "pollutant": "pm25", "hour": h,
                         "value": v, "valid_hour": True, "flag_flatline": False,
                         "flag_spike": bool(spike and (k, i) in spike)})
    return pd.DataFrame(rows)


CITY = pd.DataFrame({"sensor_key": ["s1", "s2", "s3", "s4"], "city": "Delhi"})


def test_uncorroborated_spike_is_not_supported():
    h = _multi({"s1": [40, 40, 900, 40], "s2": [40] * 4, "s3": [45] * 4, "s4": [50] * 4}, spike={("s1", 2)})
    assert not Dv.supported_spikes(h, CITY)["supported"].any()


def test_spike_corroborated_by_neighbour_within_one_hour_is_kept():
    # s2 reads 600 one hour later (>= 50% of 900 and > 2x the city median) -> real local plume
    h = _multi({"s1": [40, 40, 900, 40], "s2": [40, 40, 45, 600], "s3": [45] * 4, "s4": [50] * 4}, spike={("s1", 2)})
    out = Dv.supported_spikes(h, CITY)
    assert out["supported"].sum() == 1 and out.loc[out["supported"], "support_reason"].iat[0] == "corroborated"


def test_corroborating_station_must_itself_be_unflagged():
    h = _multi({"s1": [40, 40, 900, 40], "s2": [40, 40, 600, 40], "s3": [45] * 4, "s4": [50] * 4},
               spike={("s1", 2), ("s2", 2)})
    assert not Dv.supported_spikes(h, CITY)["supported"].any()


def test_spike_on_verified_diwali_night_is_kept():
    # Hyderabad-like case: 592 at 22:00 on Diwali 2025 while neighbours rose only to ~130
    h = _multi({"s1": [55, 592, 74], "s2": [44, 131, 55], "s3": [40, 133, 57], "s4": [59, 78, 75]},
               start="2025-10-20 21:00", spike={("s1", 1)})
    out = Dv.supported_spikes(h, CITY)
    assert out.loc[out["supported"], "support_reason"].tolist() == ["festival_night"]
    day = h.assign(spike_supported=out["supported"], n_readings=4, n_above_1000=0, expected=4)
    assert Dv.daily_with_flag_rule(day.drop(columns=["source"]))["n_supported_spike_hours_kept"].sum() == 1


def test_festival_night_window_is_18_to_06():
    s, e = Dv.festival_night_hours((2025,))[0]
    assert str(s) == "2025-10-20 18:00:00+05:30" and str(e) == "2025-10-21 06:00:00+05:30"


@pytest.mark.parametrize("pm25,pm10,flag", [(110.0, 100.0, False),    # within 20%
                                            (119.0, 100.0, False),    # within 20%
                                            (125.0, 100.0, True),     # > 20% and > 20 ug/m3
                                            (35.0, 20.0, False),      # +75% but only +15 ug/m3
                                            (45.0, 20.0, True)])      # > 20 ug/m3 above
def test_pm_tolerance_is_max_of_20pct_and_20ug(pm25, pm10, flag):
    d = _daily([{"location_id": 1, "local_date": date(2025, 8, 17), "pollutant": "pm25", "daily_mean": pm25},
                {"location_id": 1, "local_date": date(2025, 8, 17), "pollutant": "pm10", "daily_mean": pm10}])
    assert Dv.pm25_exceeds_pm10(d).tolist() == [flag, flag]


def _pm_hourly(pm25, pm10):
    hours = pd.date_range("2025-08-17", periods=24, freq="h", tz=IST)
    rows = []
    for p, vals in (("pm25", pm25), ("pm10", pm10)):
        for h, v in zip(hours, vals):
            rows.append({"source": "S", "location_id": 1, "pollutant": p, "hour": h, "value": v,
                         "valid_hour": not np.isnan(v), "flag_flatline": False, "flag_spike": False})
    return pd.DataFrame(rows)


def test_pm_check_matched_hours_catch_fault_hidden_by_different_hours():
    # PM2.5 faulty (300) only in hours 0-17, where PM10 also reports (100); daily means look fine
    # because PM10 also has 6 extra very high hours that PM2.5 lacks.
    pm25 = [300.0] * 18 + [np.nan] * 6
    pm10 = [100.0] * 18 + [2000.0] * 6
    d = _daily([{"location_id": 1, "local_date": date(2025, 8, 17), "pollutant": "pm25", "daily_mean": 300.0},
                {"location_id": 1, "local_date": date(2025, 8, 17), "pollutant": "pm10", "daily_mean": 575.0}])
    assert not Dv.pm25_exceeds_pm10(d).any()                                  # daily means alone miss it
    assert Dv.pm25_exceeds_pm10(d, _pm_hourly(pm25, pm10)).all()              # matched hours catch it


def test_pm_check_daily_means_catch_fault_in_unmatched_hours():
    # Real case (Bengaluru 6973, 2025-05-15): fine on 16 matched hours, ~400 on 6 hours without PM10
    pm25 = [12.7] * 16 + [400.0] * 6 + [np.nan] * 2
    pm10 = [31.9] * 16 + [np.nan] * 8
    d = _daily([{"location_id": 1, "local_date": date(2025, 8, 17), "pollutant": "pm25", "daily_mean": 118.3},
                {"location_id": 1, "local_date": date(2025, 8, 17), "pollutant": "pm10", "daily_mean": 31.9}])
    assert Dv.pm25_exceeds_pm10(d, _pm_hourly(pm25, pm10)).all()


def test_peer_outliers_are_flag_only_not_excluded():
    rows = [{"location_id": i, "local_date": date(2025, 8, 17), "pollutant": "pm25", "daily_mean": v}
            for i, v in enumerate([288.0, 30.0, 35.0, 28.0, 40.0])]
    d = _daily(rows)
    assert Dv.peer_outlier_days(d).iat[0] and d["is_valid_day"].all()       # flag does not touch validity


def test_manifest_records_diwali_percent_as_approved_on_request_range():
    import json
    from pathlib import Path
    from backend.pipeline import derive as D
    m = json.loads((Path(__file__).resolve().parents[1] / "data" / "app" / "manifest.json").read_text())
    assert m["diwali_percent_status"] == D.MANIFEST_PERCENT_STATUS == "approved_on_request_range"
    assert m["diwali_percent_note"] == D.MANIFEST_PERCENT_NOTE and "range" in m["diwali_percent_note"]
    assert D.PERCENT_STATUS == "pending_user_approval"          # per-window baselines unchanged
