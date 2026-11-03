"""End-to-end build on tiny synthetic fixtures (no network): repeatability, uniqueness,
Diwali rules (AQI main, no PM % change) and proven-blank labelling."""
import json
from datetime import date, timedelta

import numpy as np
import pandas as pd
import pytest

from backend.pipeline import archive, build

DAYS = [date(2025, 10, 18) + timedelta(days=i) for i in range(5)]


def _candidates():
    def st(lid, name, s25, s10):
        return {"location_id": lid, "name": name, "provider": "CPCB", "is_reference": True,
                "km_from_centre": 1.0, "lat": 28.6, "lon": 77.2, "location_last_utc": "2026-11-01T00:00:00Z",
                "sensors": {"pm25": {"id": s25, "first": "2025-02-18T00:00:00Z", "last": "2026-11-01T00:00:00Z"},
                            "pm10": {"id": s10, "first": "2025-02-18T00:00:00Z", "last": "2026-11-01T00:00:00Z"}}}
    empty = {"partial": [], "supporting_single_station": [], "low_cost": [], "excluded": []}
    return {"cities": {"Delhi": {"primary": [st(i, f"S{i}, Delhi - DPCC", 100 + i, 200 + i) for i in range(1, 4)], **empty}}}


def _archive_file(tmp, lid, d):
    ts = pd.date_range(pd.Timestamp(d).tz_localize("Asia/Kolkata") + pd.Timedelta(minutes=45),
                       periods=93, freq="15min")                      # old format: ends 00:45..23:45
    rows = []
    for t in ts:
        v25 = 1200.0 if (lid == 1 and t.hour == 21) else 80.0 + lid   # one station > 999 at 21:xx
        rows += [(lid, 100 + lid, "x", t.isoformat(), 28.6, 77.2, "pm25", "µg/m³", v25),
                 (lid, 200 + lid, "x", t.isoformat(), 28.6, 77.2, "pm10", "µg/m³", 150.0)]
    p = tmp / f"archive/{lid}-{d:%Y%m%d}.csv.gz"
    p.parent.mkdir(parents=True, exist_ok=True)
    pd.DataFrame(rows, columns=["location_id", "sensors_id", "location", "datetime", "lat", "lon",
                                "parameter", "units", "value"]).to_csv(p, index=False, compression="gzip")
    return p


def _opencity_file(tmp, lid):
    ts = pd.date_range("2025-10-18 00:00", "2025-10-22 23:45", freq="15min")
    pm25 = np.where((lid == 1) & (ts.hour == 21), np.nan, 80.0 + lid)   # blank where OpenAQ > 999
    pm25[5] = np.nan                                                     # an ordinary blank
    df = pd.DataFrame({"Timestamp": ts.strftime("%Y-%m-%dT%H:%M:%S.000000+0000"),
                       "PM2.5 (µg/m³)": pm25, "PM10 (µg/m³)": 150.0})
    p = tmp / f"opencity/{lid}.csv"
    p.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(p, index=False)


@pytest.fixture
def env(tmp_path, monkeypatch):
    files = {(lid, d): _archive_file(tmp_path, lid, d) for lid in (1, 2, 3) for d in DAYS}
    monkeypatch.setattr(archive, "fetch", lambda lid, d, today=None: files.get((lid, d)))
    for lid in (1, 2, 3):
        _opencity_file(tmp_path, lid)
    (tmp_path / "cand.json").write_text(json.dumps(_candidates()))
    pd.DataFrame({"date": pd.to_datetime(["2025-10-10"]), "city": ["Delhi"], "no_stations": [35],
                  "aqi_category": ["Poor"], "aqi": [250], "prominent_pollutant": ["PM2.5"]}
                 ).to_parquet(tmp_path / "b.parquet")
    return tmp_path


def _run(env, out):
    return build.run(env / out, ["Delhi"], DAYS[0], DAYS[-1], date(2026, 11, 3),
                     candidates_path=env / "cand.json", opencity_dir=env / "opencity",
                     bulletin_path=env / "b.parquet", progress=False)


def test_build_is_repeatable_and_unique(env):
    m1 = _run(env, "out")
    first = {f.name: pd.read_parquet(f) for f in (env / "out").glob("*.parquet")}
    m2 = _run(env, "out")                                   # rerun into the same folder
    assert m1["rows"] == m2["rows"]
    for f in (env / "out").glob("*.parquet"):
        pd.testing.assert_frame_equal(first[f.name], pd.read_parquet(f))
    h = pd.read_parquet(env / "out/station_hourly.parquet")
    d = pd.read_parquet(env / "out/station_daily.parquet")
    assert not h.duplicated(["source", "sensor_key", "hour"]).any()
    assert not d.duplicated(["source", "sensor_key", "local_date"]).any()
    assert not list((env / "out").glob("*.tmp"))


def test_high_values_kept_and_flagged(env):
    _run(env, "out")
    log = pd.read_parquet(env / "out/cleaning_log.parquet")
    assert log.loc[log.sensor_key == "openaq:101", "n_above_1000"].iat[0] > 0
    assert log["n_above_max"].sum() == 0
    h = pd.read_parquet(env / "out/station_hourly.parquet")
    assert h["n_above_1000"].sum() == 4 * len(DAYS)        # every 1,200 reading kept and counted
    d = pd.read_parquet(env / "out/station_daily.parquet")
    assert d["n_readings_above_1000"].sum() == 4 * len(DAYS)


def test_old_format_midnight_hour_not_filled(env):
    _run(env, "out")
    h = pd.read_parquet(env / "out/station_hourly.parquet")
    oa = h[h.source.str.startswith("OpenAQ") & (h.hour.dt.hour == 0)]
    # readings ending 00:00/00:15/00:30 are absent -> hour 00 has only the intervals ending
    # 00:45 and 01:00 (2 of 4) -> never valid, never filled
    assert (oa["n_readings"] == 2).all() and not oa["valid_hour"].any()


def test_blanks_labelled_source_limit_only_when_proven(env):
    _run(env, "out")
    b = pd.read_parquet(env / "out/opencity_blanks.parquet")
    s1 = b[(b.location_id == 1) & (b.pollutant == "pm25")]
    assert s1["n_blank_source_limit_proven"].sum() == 4 * len(DAYS)    # 21:00-21:45 each day
    assert s1["n_missing_or_blank"].sum() == 1                         # the ordinary blank
    assert b[b.location_id != 1]["n_blank_source_limit_proven"].sum() == 0


def test_diwali_aqi_main_and_no_pm_percent_change(env):
    _run(env, "out")
    dw = pd.read_parquet(env / "out/diwali.parquet")
    assert dw.loc[dw.metric != "aqi", "change_pct"].isna().all()
    assert set(dw.loc[dw.metric == "aqi", "role"]) == {"main"}
    assert set(dw.loc[dw.metric != "aqi", "role"]) <= {"supporting", "status"}
    reasons = pd.read_parquet(env / "out/data_status_reasons.parquet").set_index("reason_code")
    assert reasons.loc["OPENAQ_INGESTION_GAP", "user_message"].format(year=2025) == \
        "Measured PM data is incomplete for Diwali 2025."
