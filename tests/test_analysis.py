"""Analysis functions: made-up data with known answers + real-data checks recomputed independently."""
import json
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from backend.analysis import functions as F
from backend.analysis.aqi import category, sub_index
from backend.analysis.store import Store

SRC = F.SRC_OPENAQ
ENVELOPE = {"kind", "title", "metric", "units", "data_type", "source", "date_range", "stations", "coverage",
            "quality", "method", "warnings", "values", "chart"}


# ----------------------------------------------------------------------------- synthetic store
def _store(values_by_city: dict[str, list[float]], start=date(2025, 6, 1), weather=None, severities=None):
    rows, dq, st, w = [], [], [], []
    for city, vals in values_by_city.items():
        for i in range(5):
            st.append({"city": city, "tier": "primary", "location_id": hash(city) % 1000 + i, "station_name": f"{city} {i}"})
        for i, v in enumerate(vals):
            d = start + timedelta(days=i)
            sev = (severities or {}).get((city, d), "none")
            rows.append({"city": city, "pollutant": "pm25", "local_date": d, "city_mean": v,
                         "meets_rule": not np.isnan(v), "n_valid_stations": 5, "n_flagged_hours_excluded": 0,
                         "n_pm25_gt_pm10_excluded": 0, "severity": sev})
            dq.append({"source": SRC, "city": city, "local_date": d, "severity": sev, "gap_hours": 0, "extent": "none"})
            if weather is not None:
                w.append({"city": city, "local_date": d, **{k: weather[k][i] for k in weather},
                          "preliminary": False, "grid_lat": 28.6, "grid_lon": 77.2, "attribution": "Open-Meteo.com test"})
    t = {"city_daily": pd.DataFrame(rows), "date_quality": pd.DataFrame(dq), "stations": pd.DataFrame(st)}
    if w:
        t["weather_daily"] = pd.DataFrame(w)
    return Store(t)


def test_envelope_and_json_for_trend():
    s = _store({"Delhi": [100.0] * 30 + [200.0] * 31})          # June has 30 days, July 31
    res = F.city_trend(s, "Delhi", "pm25", date(2025, 6, 1), date(2025, 7, 31), "M")
    d = res.to_dict()
    assert ENVELOPE <= set(d) and json.dumps(d)
    assert [p["mean"] for p in d["values"]["periods"]] == [100.0, 200.0]
    assert d["units"] == "µg/m³" and d["data_type"] == "measured" and d["stations"]["count"] == 5
    assert d["coverage"]["days_with_city_value"] == 61


def test_trend_warns_about_period_before_data_start_and_low_coverage():
    s = _store({"Delhi": [50.0] * 5 + [np.nan] * 25})
    d = F.city_trend(s, "Delhi", "pm25", date(2025, 1, 1), date(2025, 6, 30), "M").to_dict()
    assert any("No measured OpenAQ data before 2025-02-18" in w for w in d["warnings"])
    assert any("< 70%" in w for w in d["warnings"])


def test_compare_uses_common_days_only():
    a = [100.0] * 10
    b = [10.0] * 5 + [np.nan] * 5
    s = _store({"Delhi": a, "Mumbai": b})
    d = F.compare_cities(s, ["Delhi", "Mumbai"], "pm25", date(2025, 6, 1), date(2025, 6, 10)).to_dict()
    assert d["values"]["common_days"] == 5
    top = d["values"]["cities"][0]
    assert top["city"] == "Delhi" and top["rank_highest_first"] == 1
    assert any("comparison is weak" in w for w in d["warnings"])


def test_unusual_days_finds_injected_spike_and_dip():
    rng = np.random.default_rng(1)
    vals = list(100 + rng.normal(0, 5, 90))
    vals[40], vals[60] = 220.0, 20.0
    s = _store({"Delhi": vals})
    d = F.unusual_days(s, "Delhi", "pm25", date(2025, 6, 1), date(2025, 8, 29)).to_dict()
    found = {x["date"]: x["direction"] for x in d["values"]["unusual_days"]}
    assert found["2025-07-11"] == "unusually high" and found["2025-07-31"] == "unusually low"
    top = sorted(d["values"]["unusual_days"], key=lambda x: -abs(x["robust_z"]))[:2]
    assert {x["date"] for x in top} == {"2025-07-11", "2025-07-31"}     # injected days are the strongest
    assert "median of the 15 surrounding days" in d["method"]


def test_unusual_days_flat_series_reports_nothing():
    s = _store({"Delhi": [80.0] * 60})
    d = F.unusual_days(s, "Delhi", "pm25", date(2025, 6, 1), date(2025, 7, 30)).to_dict()
    assert d["values"]["unusual_days"] == []


def test_weather_association_sign_and_language():
    n = 60
    wind = np.linspace(2, 20, n)
    pm = 200 - 8 * wind
    s = _store({"Delhi": list(pm)}, weather={"wind_speed_mean_kmh": wind, "temperature_mean_c": [25] * n,
                                             "relative_humidity_mean_pct": [50] * n, "precipitation_sum_mm": [0] * n})
    d = F.weather_relationship(s, "Delhi", "pm25", "wind_speed_mean_kmh", date(2025, 6, 1), date(2025, 7, 30)).to_dict()
    assert d["values"]["spearman_rho"] == pytest.approx(-1.0)
    assert "association, not a cause" in d["values"]["statement"]
    assert "higher wind speed" in d["values"]["statement"]
    assert d["data_type"] == "measured PM + modelled weather (reanalysis)"


def test_weather_excludes_severe_days():
    n = 40
    sev = {("Delhi", date(2025, 6, 1) + timedelta(days=i)): "severe" for i in range(10)}
    s = _store({"Delhi": [50.0 + i for i in range(n)]}, severities=sev,
               weather={"wind_speed_mean_kmh": list(range(n)), "temperature_mean_c": [25] * n,
                        "relative_humidity_mean_pct": [50] * n, "precipitation_sum_mm": [0] * n})
    d = F.weather_relationship(s, "Delhi", "pm25", "wind_speed_mean_kmh", date(2025, 6, 1), date(2025, 7, 10)).to_dict()
    assert d["coverage"]["matched_days"] == 30


def test_input_validation():
    s = _store({"Delhi": [1.0]})
    with pytest.raises(ValueError):
        F.city_trend(s, "Pune", "pm25", date(2025, 6, 1), date(2025, 6, 2))
    with pytest.raises(ValueError):
        F.city_trend(s, "Delhi", "no2", date(2025, 6, 1), date(2025, 6, 2))


@pytest.mark.parametrize("pol,c,expected", [("pm25", 30, 50), ("pm25", 60, 100), ("pm25", 75, 150),
                                            ("pm25", 250, 400), ("pm25", 1000, 500), ("pm10", 100, 100),
                                            ("pm10", 175, 150), ("pm10", 430, 400)])
def test_cpcb_sub_index(pol, c, expected):
    assert sub_index(pol, c) == pytest.approx(expected)


def test_aqi_category_boundaries():
    assert [category(x) for x in (50, 51, 100, 200, 300, 400, 401)] == \
        ["Good", "Satisfactory", "Satisfactory", "Moderate", "Poor", "Very Poor", "Severe"]


# ----------------------------------------------------------------------------- real data
APP = Path(__file__).resolve().parents[1] / "data" / "app"
real = pytest.mark.skipif(not (APP / "city_daily.parquet").exists(), reason="app tables not built")


@pytest.fixture(scope="module")
def S():
    return Store.from_dir(APP)


@real
def test_real_diwali_aqi_matches_bulletins(S):
    d = F.diwali_aqi(S, "Delhi", (2024, 2025, 2026)).to_dict()
    b = pd.read_parquet(APP / "city_daily_aqi.parquet")
    b = b[b.city == "Delhi"].set_index("bulletin_date")["aqi"]
    y = {x["year"]: x for x in d["values"]["years"]}
    assert [x["bulletin_date"] for x in y[2025]["festival_bulletins"]] == ["2025-10-21", "2025-10-22"]
    assert y[2025]["festival_level_aqi"] == round((b[date(2025, 10, 21)] + b[date(2025, 10, 22)]) / 2, 1)
    assert y[2024]["festival_level_aqi"] == round((b[date(2024, 11, 1)] + b[date(2024, 11, 2)]) / 2, 1)
    assert y[2026]["status"] == "not_available"
    assert all(c["percent_change"] is None for c in y[2025]["baseline_candidates"])     # withheld
    assert d["units"] == "index (0-500)" and "not a PM2.5" in " ".join(d["warnings"])


@real
def test_real_delhi_pm_context_never_has_percent(S):
    d = F.delhi_pm_context(S, 2025).to_dict()
    assert all(p["percent_change"] is None for p in d["values"]["pollutants"])
    assert "999" in d["warnings"][0]
    assert F.delhi_pm_context(S, 2026).to_dict()["values"]["status"] == "not_available"


@real
def test_real_trend_matches_independent_recomputation(S):
    d = F.city_trend(S, "Delhi", "pm25", date(2025, 11, 1), date(2025, 11, 30), "M").to_dict()
    cd = pd.read_parquet(APP / "city_daily.parquet")
    x = cd[(cd.city == "Delhi") & (cd.pollutant == "pm25") & cd.meets_rule
           & (cd.local_date >= date(2025, 11, 1)) & (cd.local_date <= date(2025, 11, 30))]
    assert d["values"]["periods"][0]["mean"] == round(x.city_mean.mean(), 1)
    assert d["values"]["periods"][0]["n_valid_days"] == len(x)
    assert d["stations"]["count"] == 37


@real
def test_real_compare_and_coverage_are_consistent(S):
    cities = ["Delhi", "Mumbai", "Kolkata", "Chennai", "Bengaluru", "Hyderabad"]
    d = F.compare_cities(S, cities, "pm10", date(2025, 12, 1), date(2025, 12, 31)).to_dict()
    assert {c["city"] for c in d["values"]["cities"]} == set(cities)
    assert d["values"]["cities"][0]["city"] == "Delhi"                  # Delhi highest PM10 in December
    cov = F.coverage_summary(S, "Chennai", date(2025, 3, 1), date(2025, 12, 31)).to_dict()
    assert cov["stations"]["by_tier"]["primary"] == 6
    assert cov["chart"]["type"] == "calendar_heatmap"


@real
def test_real_weather_relationship_mumbai_rain(S):
    d = F.weather_relationship(S, "Mumbai", "pm10", "precipitation_sum_mm", date(2025, 3, 1), date(2026, 10, 30)).to_dict()
    groups = {g["group"]: g for g in d["values"]["groups"]}
    assert groups["rain (>= 1 mm)"]["mean_pm"] < groups["dry (< 1 mm)"]["mean_pm"]
    assert -1 <= d["values"]["spearman_rho"] <= 1 and d["coverage"]["matched_days"] > 300


@real
def test_real_unusual_days_are_reproducible(S):
    a = F.unusual_days(S, "Mumbai", "pm10", date(2025, 3, 1), date(2026, 10, 30)).to_dict()
    b = F.unusual_days(S, "Mumbai", "pm10", date(2025, 3, 1), date(2026, 10, 30)).to_dict()
    assert a == b and a["values"]["n_days_tested"] > 300
