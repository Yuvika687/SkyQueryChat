"""The live answer to "compare delhi and hydrabad" once read: "12 AM, 14 Dec 2025 had the highest PM2.5 of the 568 cities
across all the measured data, averaging 384.5 µg/m³; 12 AM, 27 Sep 2026 had the lowest at 12.9 µg/m³". Causes: the
code-written fallback read the daily line chart as one bar per city (568 daily points -> "568 cities", dates as city
names), the chart wrote dates as timestamps ("2025-12-14 00:00:00" -> "12 AM"), and the run hit the token cap after a
needless check_request and data_coverage call. These tests reproduce that answer path and pin each fix."""
import asyncio
import json
import re
from datetime import date
from pathlib import Path

import pytest
from pydantic_ai.messages import ModelResponse, TextPart, ToolCallPart, ToolReturnPart
from pydantic_ai.models.function import AgentInfo, FunctionModel

from backend.agent import core, verify as V
from backend.agent.fields import Field
from backend.analysis import functions as F

APP = Path(__file__).resolve().parents[1] / "data" / "app"
pytestmark = pytest.mark.skipif(not (APP / "city_daily.parquet").exists(), reason="app tables not built")
ALL = (date(2025, 2, 18), date(2026, 11, 13))


@pytest.fixture(scope="module")
def store():
    from backend.analysis.store import Store
    return Store.from_dir(APP)


def scripted(steps):
    state = {"i": 0}

    def fn(messages, info: AgentInfo):
        step = steps[min(state["i"], len(steps) - 1)]
        state["i"] += 1
        return ModelResponse(parts=step(messages) if callable(step) else step)
    return FunctionModel(fn)


def compare_payload(messages):
    return [p.content for m in messages for p in getattr(m, "parts", [])
            if isinstance(p, ToolReturnPart) and p.tool_name == "compare_cities"][-1]


def text(**kw):
    return [TextPart(json.dumps({"kind": "data", "status": "answered", **kw}))]


def ask(store, q, steps):
    return asyncio.run(core.ask(core.build_agent(scripted(steps)), core.new_session(store), q))


def test_comparison_has_python_difference_ratio_and_named_extremes(store):
    d = F.compare_cities(store, ["Delhi", "Hyderabad"], "pm25", *ALL).to_dict()
    c = {x["city"]: x for x in d["values"]["cities"]}
    cmp = d["values"]["comparisons"][0]
    assert cmp["higher"] == "Delhi" and cmp["lower"] == "Hyderabad"
    assert cmp["difference"] == pytest.approx(c["Delhi"]["mean_common_days"] - c["Hyderabad"]["mean_common_days"], abs=0.11)
    assert cmp["ratio"] == pytest.approx(c["Delhi"]["mean_common_days"] / c["Hyderabad"]["mean_common_days"], abs=0.06)
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", c["Delhi"]["highest_day"]["date"])       # a date, never a time
    assert all(re.fullmatch(r"\d{4}-\d{2}-\d{2}", p[0]) for s in d["chart"]["series"] for p in s["data"])


def test_count_fields_have_unambiguous_names_and_units(store):
    from backend.agent.fields import fields_for
    d = F.compare_cities(store, ["Delhi", "Hyderabad"], "pm25", *ALL).to_dict()
    f = fields_for(d, {})
    assert f["n_cities"].value == 2 and f["n_cities"].unit == "cities"
    assert f["n_common_days"].unit == "days" and f["Delhi_n_valid_days"].unit == "days"
    assert f["difference_Delhi_minus_Hyderabad"].unit == "µg/m³" and f["ratio_Delhi_to_Hyderabad"].unit == "×"
    assert "Delhi" in f["Delhi_highest_day_value"].label and f["Delhi_highest_day_date"].value == "2025-12-14"
    assert not any(k in f for k in ("common_days", "Delhi_valid_days"))


def test_checker_rejects_a_day_count_written_as_cities():
    by = V.unit_numbers([Field(568, "Delhi days with data", "days"), Field(2, "cities compared", "cities")])
    assert V.unit_mismatches(["the highest PM2.5 of the 568 cities"], by) == ["568 cities"]
    assert V.unit_mismatches(["Delhi had data on 568 days; 2 cities were compared"], by) == []
    assert V.unit_mismatches(["over the last 30 days"], by, {30.0}) == []


def test_the_bad_answer_is_sent_back_and_the_fallback_now_reads_correctly(store):
    """Reproduce the failing path: the model's answers keep failing the checks, so the code-written lead is used."""
    bad = lambda m: text(answer="2025-12-14 had the highest PM2.5 of the 568 cities, averaging 384.5 µg/m³.",  # noqa: E731
                         cards=[f"{compare_payload(m)['id']}.Delhi_range_low"])
    out, deps = ask(store, "compare delhi and hydrabad",
                    [[ToolCallPart("compare_cities", {"cities": ["delhi", "hydrabad"]})], bad, bad, bad, bad])
    problems = " ".join(p for f in deps.verification_failures for p in f["problems"])
    assert "568 cities" in problems                                       # the checker caught the wrong unit word
    assert out.verification["answer_source"] == "code_fallback"
    assert out.answer == ("Delhi's PM2.5 was higher than Hyderabad's across all the measured data (18 Feb 2025 – 13 Nov "
                          "2026): 82.8 against 32.8 µg/m³, 50.0 µg/m³ higher (2.5 times Hyderabad's level), on the 526 "
                          "days with data for both cities.")
    assert not re.search(r"\b(?:AM|PM)\b|00:00|568", out.answer)


def test_token_cap_after_the_data_is_computed_gives_the_code_lead_not_an_error(store):
    def spend(m):                       # a model that keeps calling tools until the run's token cap stops it
        return [ToolCallPart("data_coverage", {"city": "Delhi"})]
    out, _ = asyncio.run(core.ask(core.build_agent(scripted(
        [[ToolCallPart("compare_cities", {"cities": ["Delhi", "Hyderabad"]})], spend])),
        core.new_session(store), "compare delhi and hyderabad", max_tokens=300))
    assert out.status == "answered" and out.verification["answer_source"] == "code_fallback"
    assert out.answer.startswith("Delhi's PM2.5 was higher than Hyderabad's")


def test_range_cards_become_the_citys_own_card_and_only_levels_are_levels(store):
    def ans(m):
        ds = compare_payload(m)["id"]
        return text(answer="Delhi's PM2.5 was 2.5 times Hyderabad's over all available data (18 Feb 2025 – 13 Nov 2026): "
                           "82.8 against 32.8 µg/m³, 50.0 µg/m³ higher, on 526 common days.",
                    cards=[f"{ds}.Delhi_range_low", f"{ds}.Hyderabad_range_high", f"{ds}.difference_Delhi_minus_Hyderabad",
                           f"{ds}.ratio_Delhi_to_Hyderabad"])
    out, deps = ask(store, "compare delhi and hyderabad", [[ToolCallPart("compare_cities", {"cities": ["Delhi", "Hyderabad"]})], ans])
    by = {c.field: c for c in out.cards}
    fs = deps.session.fields[by["Delhi_mean"].dataset_id]
    assert list(by) == ["Delhi_mean", "Hyderabad_mean", "difference_Delhi_minus_Hyderabad", "ratio_Delhi_to_Hyderabad"]
    assert by["Delhi_mean"].role == "level" and by["Delhi_mean"].range95 == [fs["Delhi_range_low"].value, fs["Delhi_range_high"].value]
    assert by["difference_Delhi_minus_Hyderabad"].role == "difference" and by["ratio_Delhi_to_Hyderabad"].role == "ratio"
    assert out.verification["answer_source"] == "llm" and out.verification["retries"] == 0


def test_six_city_fallback_leads_with_the_top_two_and_short_years_are_the_users_own(store):
    assert 26.0 in V.user_safe_numbers("Compare PM2.5 in all six cities over winter 2025-26.")
    bad = lambda m: text(answer="Delhi was highest at 987.6 µg/m³.")       # noqa: E731  (an invented number, every time)
    out, _ = ask(store, "Compare PM2.5 in all six cities over winter 2025-26.",
                 [[ToolCallPart("compare_cities", {"cities": ["Delhi", "Mumbai", "Kolkata", "Chennai", "Bengaluru", "Hyderabad"],
                                                   "period": "winter 2025-26"})], bad, bad, bad, bad])
    assert out.verification["answer_source"] == "code_fallback"
    assert [c.field for c in out.cards][:2] == ["Delhi_mean", "Kolkata_mean"]
    assert out.answer.startswith("Delhi had the highest PM2.5 of the six cities")
