"""Wording rules: the code-written trend fallback always states the trend result, and answers and suggestions never
imply live data ("latest available", never "right now" / "today" / "currently")."""
import json
import re
from pathlib import Path

from backend.agent import verify as V
from backend.agent.lead import _trend_sentence

ROOT = Path(__file__).resolve().parents[1]


def test_trend_fallback_states_the_trend_result_including_no_clear_trend():
    assert _trend_sentence({"status": "no clear trend", "p_value": 0.21}) == " There was no clear trend over the period."
    assert _trend_sentence({"status": "increasing", "change_over_period": 135.9, "period_days": 30}) == \
        " It rose by about 135.9 µg/m³ over these 30 days (short periods include seasonal change)."
    assert _trend_sentence({"status": "decreasing", "slope_per_month": -0.56}) == " It fell by about 0.56 µg/m³ per month."
    assert _trend_sentence({"status": "not enough data"}).startswith(" There were not enough days")


def test_wording_that_implies_live_data_is_rejected():
    assert V.banned_wording("How is Delhi's air right now? Currently poor; today it rose.") == ["right now", "Currently", "today"]
    assert V.banned_wording("How was Delhi's air on the latest available day?") == []


def test_no_suggested_question_on_the_site_implies_live_data():
    src = ROOT / "frontend" / "src"
    texts = []
    for f in list(src.rglob("*.ts")) + list(src.rglob("*.tsx")):
        if ".test." in f.name:
            continue
        texts += re.findall(r'"([A-Z][^"]{12,}\?)"', f.read_text(encoding="utf-8"))   # question strings
    sugg = json.loads((ROOT / "evals" / "suggestions.json").read_text(encoding="utf-8"))
    texts += [t for q in sugg["questions"] for t in q["turns"]]
    bad = [t for t in texts if V.banned_wording(t) and re.search(r"right now|today|currently|at the moment", t, re.I)]
    assert texts and not bad, bad
