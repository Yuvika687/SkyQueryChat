"""Code-written headline (backend/agent/lead.py): analyst wording, numbers only from the answer's tool results."""
import json
from pathlib import Path

import pytest

from backend.agent.lead import headline, period_phrase
from backend.agent.verify import allowed_numbers, check_numbers, extract_numbers

ROOT = Path(__file__).resolve().parents[1]
DEMO = ROOT / "data" / "app" / "demo_answers.json"
FIX = ROOT / "frontend" / "src" / "test" / "fixtures"


def _demo():
    return {a["question"]: a["final"] for a in json.loads(DEMO.read_text())["answers"]}


def _fixture(name: str) -> dict:
    ev = {}
    for blk in (FIX / name).read_text().split("\n\n"):
        e = [x[7:] for x in blk.splitlines() if x.startswith("event: ")]
        d = [x[6:] for x in blk.splitlines() if x.startswith("data: ")]
        if e and d:
            ev[e[0]] = json.loads("".join(d))
    a = ev["answer"]
    return {"status": a["status"], "cards": ev["cards"], "chart": ev["chart"], "coverage": ev["sources"]["coverage"],
            "sources": ev["sources"]["sources"], "resolved_query": a["resolved_query"]}


def _numbers_ok(final: dict, text: str) -> bool:
    payload = {k: final.get(k) for k in ("cards", "chart", "coverage", "sources", "resolved_query")}
    return not check_numbers([text], allowed_numbers([payload]))


@pytest.mark.skipif(not DEMO.exists(), reason="demo answers not built")
def test_every_saved_answer_headline_uses_only_tool_numbers():
    for q, f in _demo().items():
        h = headline(f)
        if f["status"] != "answered":
            assert h is None, q
            continue
        assert h and _numbers_ok(f, h), q
        assert "ranked" not in h and "mean of" not in h and "rank" not in h.lower()


def test_comparison_reads_like_an_analyst():
    h = headline(_fixture("compare-live.sse"))
    assert h == ("Delhi's PM2.5 was higher than Mumbai's over the latest 30 days available (1–30 Oct 2026): "
                 "73.0 µg/m³ against 43.7 µg/m³, averaged on the 24 days with valid data for both.")


@pytest.mark.skipif(not DEMO.exists(), reason="demo answers not built")
def test_diwali_uses_whole_bulletin_aqi_and_names_the_category():
    h = headline(_demo()["How bad was Delhi's air on Diwali 2025?"])
    assert h.startswith("Delhi's air was Very Poor over Diwali 2025")
    assert all(dec == 0 for _, _, dec, _ in extract_numbers(h)[0])        # AQI as whole numbers
    assert "caus" not in h


@pytest.mark.skipif(not DEMO.exists(), reason="demo answers not built")
def test_six_city_ranking_spells_out_small_counts():
    h = headline(_demo()["Which of the six cities had the highest PM2.5 in winter 2025?"])
    assert "of the six cities in winter" in h and "Hyderabad had the lowest" in h


def test_number_not_in_tool_results_drops_the_headline():
    f = _fixture("compare-live.sse")
    f["chart"]["series"][0]["data"][0][1] = 12.345            # chart no longer matches cards/coverage …
    f["cards"] = []
    f["coverage"] = {}
    tampered = headline(f)                                   # … but the chart point itself is still a tool value
    assert tampered is None or _numbers_ok(f, tampered)
    f2 = _fixture("compare-live.sse")
    f2["coverage"] = {"ds1": {"common_days": 999}}           # numbers come from the payload: still consistent
    assert "999 days" in headline(f2)


def test_not_answered_has_no_headline():
    f = _fixture("compare-live.sse")
    f["status"] = "unavailable"
    assert headline(f) is None


def test_latest_days_phrase_only_when_relative_to_latest_data():
    rq = {"start_date": "2026-10-01", "end_date": "2026-10-30", "assumptions": ["relative to the latest data (2026-10-30)"]}
    assert period_phrase(rq, {30.0}) == "over the latest 30 days available (1–30 Oct 2026)"
    assert period_phrase(rq, set()) == "over the latest days available (1–30 Oct 2026)"
    assert period_phrase({"start_date": "2025-11-01", "end_date": "2025-11-30", "assumptions": []}, set()) == "in November 2025"
    assert period_phrase({"start_date": "2025-03-05", "end_date": "2025-06-30", "assumptions": []}, set()) == "between 5 Mar and 30 Jun 2025"


def test_short_trend_periods_get_a_daily_chart():
    from datetime import date
    from backend.agent.tools import auto_freq
    assert auto_freq(date(2026, 10, 1), date(2026, 10, 30)) == "D"
    assert auto_freq(date(2025, 3, 1), date(2025, 12, 31)) == "W"
    assert auto_freq(date(2025, 2, 18), date(2026, 10, 30)) == "M"
    assert auto_freq(None, None) == "M"


def test_resolver_note_survives_when_the_model_passes_explicit_dates():
    from backend.agent.core import _carry_period_notes
    from backend.agent.schemas import FinalAnswer, ResolvedQuery
    f = FinalAnswer(status="answered", answer="x", resolved_query=ResolvedQuery(
        city="Kolkata", cities=["Kolkata"], pollutant="PM2.5", start_date="2026-10-01", end_date="2026-10-30"))
    checks = [{"period": {"start": "2026-10-01", "end": "2026-10-30", "notes": ["relative to the latest data (2026-10-30)"]}}]
    _carry_period_notes(f, checks)
    assert f.resolved_query.assumptions == ["relative to the latest data (2026-10-30)"]
    g = FinalAnswer(status="answered", answer="x", resolved_query=ResolvedQuery(start_date="2025-11-01", end_date="2025-11-30"))
    _carry_period_notes(g, checks)                                   # different dates: nothing carried over
    assert g.resolved_query.assumptions == []
