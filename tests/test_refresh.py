"""Data refresh pieces: CPCB bulletin PDFs, OpenAQ API top-up merging, sensor date cut-off, weather append."""
from datetime import date
from pathlib import Path

import pandas as pd
import pytest

from backend.pipeline import build, config as C, cpcb_bulletins as P, weather as W

PDFS = C.RAW / "bulletins" / "cpcb_pdfs"
UE = C.RAW / "bulletins" / "aqi-bulletins.parquet"


def test_pollutant_subscripts_are_rejoined_and_sorted_like_urbanemissions():
    assert P._pollutants("PM , PM\n2.5 10") == "PM10, PM2.5"
    assert P._pollutants("O , PM\n3 2.5") == "O3, PM2.5"
    assert P._pollutants("CO , O\n3") == "CO, O3"
    assert P._pollutants("PM\n10") == "PM10"


def test_pdf_url_is_base64_of_the_downloads_path():
    assert P.url_for(date(2026, 11, 9)).endswith("RG93bmxvYWRzL0FRSV9CdWxsZXRpbl8yMDI2MTEwOS5wZGY=")


@pytest.mark.skipif(not (PDFS / "AQI_Bulletin_20261025.pdf").exists() or not UE.exists(),
                    reason="raw bulletin files are not committed")
def test_pdf_reader_matches_urbanemissions_on_overlapping_dates():
    pdf = P.load(date(2026, 10, 20), date(2026, 10, 25), None, download=False)
    ue = pd.read_parquet(UE)
    ue["date"] = pd.to_datetime(ue["date"]).dt.date
    m = pdf.merge(ue, on=["date", "city"], suffixes=("_pdf", "_ue"))
    assert len(m) > 1400
    assert (m.aqi_pdf == m.aqi_ue).all() and (m.aqi_category_pdf == m.aqi_category_ue).all()
    assert (m.no_stations_pdf == m.no_stations_ue).all()
    assert (m.prominent_pollutant_pdf.fillna("") == m.prominent_pollutant_ue.fillna("")).all()


@pytest.mark.skipif(not (PDFS / "AQI_Bulletin_20261109.pdf").exists(), reason="raw bulletin files are not committed")
def test_diwali_2026_festival_bulletins_read_from_cpcb_pdfs():
    x = P.parse(PDFS / "AQI_Bulletin_20261109.pdf", ["Delhi"]).iloc[0]
    assert (x.aqi, x.aqi_category, x.no_stations, x.total_stations) == (344.0, "Very Poor", 47, 59)


def test_api_files_fill_only_days_the_archive_lacks():
    a, b = Path("arch-8"), Path("api-8")
    paths = {1: [(date(2026, 11, 8), a)]}
    api = {1: [(date(2026, 11, 8), b), (date(2026, 11, 9), Path("api-9"))], 2: [(date(2026, 11, 9), Path("x"))]}
    merged, used = build.merge_api(paths, api)
    assert merged[1] == [(date(2026, 11, 8), a), (date(2026, 11, 9), Path("api-9"))]     # archive wins on 8 Nov
    assert sorted(used) == ["1:2026-11-09", "2:2026-11-09"]


def test_snapshot_last_date_does_not_cut_off_active_sensors():
    ts = lambda s: pd.Timestamp(s, tz=C.IST)
    st = pd.DataFrame({"location_id": [1, 2], "tier": "primary",
                       "sensor_first": [ts("2026-10-01")] * 2,
                       "sensor_last": [ts("2026-11-03 09:00"), ts("2026-10-10")]})   # 2 stopped long before
    days = build.location_days(st, date(2026, 11, 1), date(2026, 11, 11))
    assert days[1][-1] == date(2026, 11, 11) and 2 not in days


def test_weather_append_keeps_existing_rows_and_skips_unfilled_days(monkeypatch):
    def fake(city, start, end, cache_name=None):
        return {"utc_offset_seconds": 19800, "latitude": 1.0, "longitude": 2.0,
                "daily_units": {api: unit for api, (_, unit) in W.VARIABLES.items()},
                "daily": {"time": ["2026-11-03", "2026-11-04", "2026-11-05"],
                          **{api: [99.0, 1.0, None] for api in W.VARIABLES}}}
    monkeypatch.setattr(W, "fetch_city", fake)
    old = pd.DataFrame({"city": C.CITIES, "local_date": date(2026, 11, 3), "temperature_mean_c": 20.0})
    out, new = W.append(old, date(2026, 11, 3), date(2026, 11, 5), date(2026, 11, 12))
    assert (out[out.local_date == date(2026, 11, 3)]["temperature_mean_c"] == 20.0).all()   # not overwritten
    assert set(new["local_date"]) == {date(2026, 11, 4)}                                    # empty 5 Nov skipped


APP = C.ROOT / "data" / "app"


def test_each_diwali_baseline_is_the_mean_of_that_citys_own_bulletins():
    """Bengaluru and Hyderabad both give 64.6 for the 2026 week before: a real coincidence (both sum to 452 from
    different daily values). This guards against any baseline being copied across cities."""
    aqi = pd.read_parquet(APP / "city_daily_aqi.parquet")
    aqi["bulletin_date"] = pd.to_datetime(aqi["bulletin_date"]).dt.date
    b = pd.read_parquet(APP / "diwali_aqi_baselines.parquet").dropna(subset=["baseline_aqi"])
    assert len(b) > 30
    for r in b.itertuples():
        s, e = (date.fromisoformat(x) for x in r.bulletin_dates.split(".."))
        rows = aqi[(aqi.city == r.city) & (aqi.bulletin_date >= s) & (aqi.bulletin_date <= e)]
        assert len(rows) == r.n_days and rows.aqi.mean() == pytest.approx(r.baseline_aqi), (r.city, r.year, r.window)
    w = b[(b.year == 2026) & (b.window == "W2_d7_d1")].set_index("city").baseline_aqi
    assert w["Bengaluru"] == pytest.approx(w["Hyderabad"]) and w["Bengaluru"] == pytest.approx(452 / 7)


def test_opencity_step_uses_the_cache_when_raw_files_are_absent_and_never_drops_data(tmp_path):
    st = pd.DataFrame({"location_id": [1, 2]})
    with pytest.raises(RuntimeError, match="no cache"):
        build.opencity_step(st, tmp_path / "none", pd.DataFrame(), cache_dir=tmp_path / "cache", progress=False)
    cache = tmp_path / "cache"
    cache.mkdir()
    parts = {"hourly": pd.DataFrame({"v": [1.0]}), "log": pd.DataFrame({"r": ["x"]}), "blank_hours": pd.DataFrame({"n": [2]})}
    for n, df in parts.items():
        df.to_parquet(cache / f"{n}.parquet")
    h, log, blanks = build.opencity_step(st, tmp_path / "none", pd.DataFrame(), cache_dir=cache, progress=False)
    assert h.equals(parts["hourly"]) and log.equals(parts["log"]) and blanks.equals(parts["blank_hours"])


def test_refresh_checks_reject_changed_history_backwards_dates_and_oversize(tmp_path, monkeypatch):
    import importlib.util
    spec = importlib.util.spec_from_file_location("refresh_data", Path(__file__).resolve().parents[1] / "scripts" / "refresh_data.py")
    R = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(R)
    old = {"city_daily": pd.DataFrame({"city": ["Delhi"] * 2, "pollutant": ["pm25"] * 2,
                                       "local_date": [date(2026, 11, 1), date(2026, 11, 2)],
                                       "city_mean": [100.0, 110.0], "meets_rule": [True, True]})}
    new = old["city_daily"].copy()
    assert R._unchanged(old["city_daily"], new, ["city", "pollutant", "local_date"], ["city_mean", "meets_rule"],
                        date(2026, 11, 2), "local_date") == 0
    new.loc[0, "city_mean"] = 99.0
    assert R._unchanged(old["city_daily"], new, ["city", "pollutant", "local_date"], ["city_mean", "meets_rule"],
                        date(2026, 11, 2), "local_date") == 1
    # API top-up days after the previous archive end may change (archive files replace them)
    assert R._unchanged(old["city_daily"], new.assign(city_mean=[100.0, 1.0]), ["city", "pollutant", "local_date"],
                        ["city_mean", "meets_rule"], date(2026, 11, 1), "local_date") == 0
    assert R.SIZE_LIMIT_MB >= 5
