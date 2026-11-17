"""Official AQI on any festival or date for any bulletin city (backend/analysis/events.py), and Diwali for non-metro
bulletin cities. Expected values are read from the real tables (they refresh daily), never hard-coded."""
from datetime import date, timedelta
from pathlib import Path

import pytest

from backend.agent.fields import fields_for
from backend.agent.required import required_warnings
from backend.analysis import events as EV
from backend.analysis import functions as F
from backend.analysis.store import Store

APP = Path(__file__).resolve().parents[1] / "data" / "app"
pytestmark = pytest.mark.skipif(not (APP / "city_aqi_all.parquet").exists(), reason="all-cities table not built")


@pytest.fixture(scope="module")
def store():
    return Store.from_dir(APP)


def _run(store, city, event=None, dates=None, years=None):
    g = EV.series(store, city)
    first, last = g["bulletin_date"].min(), g["bulletin_date"].max()
    occ = EV.event_occasions(event, years, first, last) if event else EV.date_occasions(dates, years, last)
    return EV.occasion_aqi(store, city, occ).to_dict(), g


def test_festival_aliases_resolve():
    assert EV.find_event("aqi on holi")[0] == "holi"
    assert EV.find_event("Durga Pujo in Kolkata") is None or EV.find_event("durga puja")[0] == "durga_puja"
    assert EV.find_event("new year's eve")[0] in ("new_year", "new_years_eve")
    assert EV.find_event("Bakrid 2025")[0] == "eid_ul_adha"
    assert EV.find_event("Deepavali")[0] == "diwali"
    assert EV.find_event("random words") is None


def test_level_is_mean_of_day_and_next_day_bulletins(store):
    d, g = _run(store, "Delhi", "Holi", years=[2026])
    o = d["values"]["occasions"][0]
    assert o["local_days"] == ["2026-03-04", "2026-03-04"]
    by = dict(zip(g["bulletin_date"], g["aqi"]))
    want = [by[date(2026, 3, 4)], by[date(2026, 3, 5)]]
    assert [b["aqi"] for b in o["bulletins"]] == [int(x) for x in want]
    assert o["level_aqi"] == round(sum(want) / 2, 1)
    pre = [by[date(2026, 3, 4) - timedelta(days=k)] for k in range(1, 8) if date(2026, 3, 4) - timedelta(days=k) in by]
    assert o["week_before_aqi"] == round(sum(pre) / len(pre), 1)


def test_any_bulletin_city_and_date_without_year(store):
    d, g = _run(store, "Rohtak", dates=["9 November"])
    o = d["values"]["occasions"][0]
    last = g["bulletin_date"].max()
    y = last.year if date(last.year, 11, 9) <= last else last.year - 1
    assert o["local_days"][0] == f"{y}-11-09" and d["values"]["is_metro"] is False
    f = fields_for(d, {"city": "Rohtak"})
    assert f[f"{y}_level_aqi"].value == o["level_aqi"]
    assert any(w["code"] == "pm_only_six_metros" for w in required_warnings(d))
    assert any(w["code"] == "not_causal_occasion" for w in required_warnings(d))


def test_future_occasion_is_not_yet(store):
    d, _ = _run(store, "Delhi", "Christmas", years=[2030])
    assert d["values"]["occasions"][0]["status"] == "not_yet"


def test_unknown_festival_lists_known_ones(store):
    with pytest.raises(ValueError, match="festival calendar"):
        _run(store, "Delhi", "Some Unknown Mela")


def test_long_span_points_to_official_aqi(store):
    with pytest.raises(ValueError, match="official_aqi"):
        _run(store, "Delhi", dates=["1 September 2026 to 30 November 2026"])


def test_diwali_for_a_non_metro_bulletin_city(store):
    t = store.tables["city_aqi_all"]
    r = t[t["city"] == "Rohtak"]
    if r.empty:
        pytest.skip("Rohtak not in the bulletin table")
    d = F.diwali_aqi(store, "Rohtak", (2025, 2026)).to_dict()
    ys = {y["year"]: y for y in d["values"]["years"]}
    by = {str(k)[:10]: v for k, v in zip(r["bulletin_date"], r["aqi"])}
    for y, (b1, b2) in {2025: ("2025-10-21", "2025-10-22"), 2026: ("2026-11-09", "2026-11-10")}.items():
        if b1 in by and b2 in by:
            assert ys[y]["status"] == "ok"
            assert ys[y]["festival_level_aqi"] == round((by[b1] + by[b2]) / 2, 1)
