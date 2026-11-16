"""Official AQI for every CPCB bulletin city: the all-cities table, name resolution, the official_aqi analysis, its answer
fields and warnings, and the read-only endpoints. Every check runs on the real data/app tables; expected values are read
from the table itself (it refreshes daily), never hard-coded."""
import json
from datetime import date, timedelta
from pathlib import Path

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from backend.agent.fields import fields_for
from backend.agent.required import required_warnings
from backend.analysis import official_aqi as OA
from backend.analysis.store import Store
from backend.api.main import create_app
from backend.api.settings import Settings

APP = Path(__file__).resolve().parents[1] / "data" / "app"
pytestmark = pytest.mark.skipif(not (APP / "city_aqi_all.parquet").exists(), reason="all-cities table not built")


@pytest.fixture(scope="module")
def store():
    return Store.from_dir(APP)


@pytest.fixture(scope="module")
def table(store):
    t = store.tables["city_aqi_all"].copy()
    t["bulletin_date"] = pd.to_datetime(t["bulletin_date"]).dt.date
    return t


# ----------------------------------------------------------------------------- the table
def test_all_cities_table_has_every_bulletin_city_and_stays_small(table):
    assert table["city"].nunique() >= 300
    assert not table.duplicated(["city", "bulletin_date"]).any()
    assert table["aqi"].between(0, 500).all()
    assert set(table["aqi_category"].astype(str)) <= {"Good", "Satisfactory", "Moderate", "Poor", "Very Poor", "Severe"}
    assert table["bulletin_date"].min() >= date(2025, 2, 18)          # same span as the measured data
    assert (APP / "city_aqi_all.parquet").stat().st_size < 1_000_000    # data/app stays well under the 8 MB guard
    assert sum(p.stat().st_size for p in APP.iterdir()) < 8 * 1024 * 1024


def test_six_metros_match_the_six_city_bulletin_table(store, table):
    six = store.tables["city_daily_aqi"].copy()
    six["bulletin_date"] = pd.to_datetime(six["bulletin_date"]).dt.date
    m = six.merge(table, on=["city", "bulletin_date"], suffixes=("_six", "_all"))
    assert len(m) > 1000 and (m["aqi_six"] == m["aqi_all"]).all()


# ----------------------------------------------------------------------------- city names
@pytest.mark.parametrize("typed,city", [("Lucknow", "Lucknow"), ("lucknow", "Lucknow"), ("Bangalore", "Bengaluru"),
                                        ("Bombay", "Mumbai"), ("Gurgaon", "Gurugram"), ("Lucknoww", "Lucknow"),
                                        ("Banaras", "Varanasi")])
def test_resolver_understands_bulletin_names_older_names_and_misspellings(store, typed, city):
    r = OA.bulletin_cities(store).resolve(typed)
    assert r["city"] == city
    assert ("note" in r) == (typed.lower() != city.lower())         # only a different name gets a "read as" note


def test_place_not_in_the_bulletin_gets_an_honest_message_and_nearest_covered_cities(store):
    r = OA.bulletin_cities(store).resolve("Shimla")
    assert r["city"] is None and "isn't in CPCB's daily AQI bulletin" in r["message"]
    assert len(r["nearest"]) == 3 and all(c in OA.bulletin_cities(store).names for c in r["nearest"])
    assert OA.bulletin_cities(store).resolve("Atlantis")["nearest"] == []      # never an unrelated city


# ----------------------------------------------------------------------------- the analysis (Python calculates)
def test_official_aqi_values_come_from_the_table(store, table):
    g = table[table["city"] == "Lucknow"].sort_values("bulletin_date")
    last = g["bulletin_date"].max()
    p = g[g["bulletin_date"] >= last - timedelta(days=29)]
    v = OA.official_aqi(store, "Lucknow").to_dict()["values"]
    assert v["latest"]["aqi"] == int(p["aqi"].iloc[-1]) and v["latest"]["date"] == str(last)
    assert v["change_from_previous"] == int(p["aqi"].iloc[-1]) - int(p["aqi"].iloc[-2])
    assert v["summary"]["mean"] == pytest.approx(round(float(p["aqi"].mean()), 1))
    assert v["summary"]["highest"]["aqi"] == int(p["aqi"].max()) and v["summary"]["n_bulletins"] == len(p)
    assert v["summary"]["trend"]["status"] in ("increasing", "decreasing", "no clear trend", "not enough data")
    assert v["label"].startswith("Official AQI (CPCB 4 PM bulletin, ") and not v["is_metro"]


def test_answer_fields_and_required_note_for_a_non_metro_city(store):
    d = OA.official_aqi(store, "Pune").to_dict()
    f = fields_for(d, {"city": "Pune"})
    assert {"latest_aqi", "latest_category", "latest_date", "mean_aqi", "trend", "cpcb_health"} <= set(f)
    assert f["latest_aqi"].label.startswith("Pune Official AQI (CPCB 4 PM bulletin")
    codes = [w["code"] for w in required_warnings(d)]
    assert "pm_only_six_metros" in codes and "aqi_not_concentration" in codes
    assert "pm_only_six_metros" not in [w["code"] for w in required_warnings(OA.official_aqi(store, "Delhi").to_dict())]


def test_city_series_keeps_gaps_as_nulls(store, table):
    s = OA.city_series(store, "Lucknow")
    assert len(s["series"]) == 30 and s["series"][-1]["date"] == s["latest"]["date"]
    have = {r["date"] for r in s["series"] if r["aqi"] is not None}
    g = table[table["city"] == "Lucknow"]
    assert have == {str(d) for d in g["bulletin_date"] if str(d) >= s["series"][0]["date"]}


# ----------------------------------------------------------------------------- endpoints (read-only, no AI)
@pytest.fixture(scope="module")
def client(store):
    s = Settings(allowed_origins=["http://localhost:3000"], rate_per_minute=50, rate_per_day=500, question_timeout_s=20)
    with TestClient(create_app(agent_factory=lambda: None, store=store, settings=s, demo={})) as c:
        yield c


def test_cities_endpoint_lists_every_city_with_coordinates_or_none(client):
    d = client.get("/api/aqi/cities").json()
    assert d["n_cities"] >= 300 and d["n_plotted"] >= 280 and "GeoNames" in d["coordinates_source"]
    metros = {c["city"] for c in d["cities"] if c["is_metro"]}
    assert metros == {"Delhi", "Mumbai", "Kolkata", "Chennai", "Bengaluru", "Hyderabad"}
    for c in d["cities"]:
        assert (c["lat"] is None) == (c["lon"] is None)
        if c["lat"] is not None:
            assert 6 < c["lat"] < 37.5 and 68 < c["lon"] < 98     # inside India's bounding box


def test_city_endpoint_resolves_names_and_explains_unknown_places(client):
    assert client.get("/api/aqi/city/bangalore").json()["city"] == "Bengaluru"
    r = client.get("/api/aqi/city/Shimla")
    assert r.status_code == 404 and r.json()["error"]["code"] == "not_in_bulletin" and r.json()["error"]["nearest"]


def test_coordinates_file_credits_geonames():
    d = json.loads((Path(__file__).resolve().parents[1] / "backend" / "config" / "cpcb_city_coordinates.json").read_text(encoding="utf-8"))
    assert "GeoNames" in d["source"] and d["n_plotted"] + len(d["not_plotted"]) == d["n_cities"]
