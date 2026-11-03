"""Tests for network-gap detection, fault flags and publication-tail logic."""
from datetime import date

import pandas as pd

from backend.pipeline import config as C
from backend.pipeline import quality as Q

IST = C.IST
START = pd.Timestamp("2025-10-20", tz=IST)
END = pd.Timestamp("2025-10-21", tz=IST)


def _active(n):
    return pd.DataFrame({"sensor_key": [f"s{i}" for i in range(n)],
                         "first": pd.Timestamp("2025-01-01", tz=IST),
                         "last": pd.Timestamp("2026-01-01", tz=IST)})


def _hourly(n, missing_hours):
    hours = pd.date_range(START, END, freq="h", inclusive="left")
    rows = [{"sensor_key": f"s{i}", "hour": h} for i in range(n) for h in hours if h.hour not in missing_hours]
    return pd.DataFrame(rows)


def test_network_gap_detected_and_merged_into_runs():
    cov = Q.network_coverage(_hourly(5, {10, 11, 12, 20}), _active(5), START, END)
    runs = Q.gap_runs(cov)
    assert list(runs["hours"]) == [3, 1]
    assert runs["gap_start"].iat[0] == START + pd.Timedelta(hours=10)
    dq = Q.date_quality(cov)
    assert dq["gap_hours"].iat[0] == 4 and bool(dq["low_quality"].iat[0])


def test_partial_outage_below_half_is_gap_above_half_is_not():
    h = _hourly(4, set())
    h = h[~((h.hour.dt.hour == 5) & h.sensor_key.isin(["s0", "s1", "s2"]))]   # 1/4 report at 05
    h = h[~((h.hour.dt.hour == 6) & h.sensor_key.isin(["s0"]))]               # 3/4 report at 06
    cov = Q.network_coverage(h, _active(4), START, END).set_index(pd.Index(range(24)))
    assert cov.loc[5, "is_gap"] and not cov.loc[6, "is_gap"]


def test_inactive_sensors_do_not_create_gaps():
    act = _active(5)
    act.loc[3:, "last"] = pd.Timestamp("2025-06-01", tz=IST)   # 2 sensors retired earlier
    cov = Q.network_coverage(_hourly(3, set()), act, START, END)
    assert not cov["is_gap"].any() and (cov["n_active"] == 3).all()


def test_too_few_active_sensors_never_flag():
    cov = Q.network_coverage(_hourly(2, {3}), _active(2), START, END)
    assert not cov["is_gap"].any()


def test_recurring_gap_hours():
    cov = Q.network_coverage(_hourly(5, {0}), _active(5), START, END)
    rec = Q.recurring_gap_hours(cov)
    assert rec.loc[0] == 1.0 and rec.loc[1] == 0.0


def _series(values, key="openaq:1"):
    return pd.DataFrame({"source": "x", "sensor_key": key, "pollutant": "pm25",
                         "hour": pd.date_range(START, periods=len(values), freq="h"), "value": values})


def test_flatline_flags_runs_of_six_identical_hours_only():
    h = _series([5, 7, 7, 7, 7, 7, 7, 8, 9, 9, 9])
    f = Q.flag_flatlines(h, 6)
    assert f.tolist() == [False] + [True] * 6 + [False] * 4


def test_flatline_does_not_cross_time_gaps():
    h = _series([7] * 6)
    h.loc[3:, "hour"] += pd.Timedelta(hours=5)
    assert not Q.flag_flatlines(h, 6).any()


def test_isolated_spike_flagged_but_regional_rise_not():
    peers = pd.DataFrame({"sensor_key": [f"s{i}" for i in range(5)], "city": "Delhi"})
    base = pd.concat([_series([50, 50, 50, 50, 50], key=f"s{i}") for i in range(5)], ignore_index=True)
    spike = base.copy()
    spike.loc[(spike.sensor_key == "s0") & (spike.hour == START + pd.Timedelta(hours=2)), "value"] = 900
    f = Q.flag_isolated_spikes(spike, peers, 3, 3.0, 250.0, 0.5)
    assert f.sum() == 1
    regional = base.copy()
    regional.loc[regional.hour == START + pd.Timedelta(hours=2), "value"] = 900   # everyone rises
    assert Q.flag_isolated_spikes(regional, peers, 3, 3.0, 250.0, 0.5).sum() == 0


def test_publication_tail():
    pres = pd.DataFrame({"local_date": [date(2026, 10, d) for d in (28, 29, 30, 31)],
                         "share": [0.9, 0.0, 0.8, 0.1]})   # 29th is a mid-range outage, 31st unpublished
    assert Q.publication_tail(pres) == date(2026, 10, 30)
