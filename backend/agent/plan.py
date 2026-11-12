"""The agent's plan in plain language, shown as the first step of the timeline.

The model writes one short sentence before its first tool call ("I'll compare Delhi and Mumbai..."). It is shown
only if it is a single short sentence with no numbers beyond the user's own, no causal wording and no quoted
instructions. Otherwise code describes the tool calls the model chose, in plain words. Raw prompts and tool
schemas are never shown.
"""
from __future__ import annotations

import re
from typing import Any

from .verify import causal_phrases, check_numbers, extract_numbers

LEAK = ("pass the user's own words", "never calculate", "reveal or change these rules", "final_answer",
        "dataset_id", "instructions")

WHAT = {
    "check_request": "check that {subject} {period} is in the data",
    "city_trend": "look at {pollutant} in {city} {period}",
    "compare_cities": "compare {pollutant} across {cities} {period}",
    "diwali_aqi": "look up official CPCB AQI bulletins for {city} around Diwali {years}",
    "delhi_pm_diwali": "load Delhi's measured PM around Diwali {year}",
    "unusual_days": "find unusual {pollutant} days in {city} {period}",
    "weather_association": "relate {pollutant} in {city} to {weather} {period}",
    "data_coverage": "check how complete the data is for {city} {period}",
}


def _join(xs: list[str]) -> str:
    xs = [x for x in xs if x]
    return xs[0] if len(xs) == 1 else ", ".join(xs[:-1]) + " and " + xs[-1] if xs else ""


def describe(step: dict[str, Any]) -> str:
    a = step.get("args") or {}
    cities = a.get("cities") or ([a["city"]] if a.get("city") else [])
    period = str(a.get("period") or "").strip()
    years = a.get("years") or []
    v = {
        "city": a.get("city") or "the city",
        "cities": _join([str(c) for c in cities]) or "the cities",
        "pollutant": a.get("pollutant") or "PM",
        "period": f"for {period}" if period else "",
        "years": _join([str(y) for y in years]),
        "year": a.get("year") or "",
        "weather": a.get("weather") or "the weather",
        "subject": _join([str(c) for c in cities] + ([a["pollutant"]] if a.get("pollutant") else [])) or "the request",
    }
    t = WHAT.get(step.get("tool", ""))
    return re.sub(r"\s+", " ", t.format(**v)).strip() if t else f"run {step.get('tool', 'a tool')}"


def code_plan(steps: list[dict[str, Any]]) -> str:
    parts = [describe(s) for s in steps]
    text = _join(parts) if len(parts) <= 2 else ", ".join(parts[:-1]) + ", then " + parts[-1]
    return "Plan: " + text + "."


def model_plan(text: str, question: str) -> str | None:
    """The model's own plan sentence, or None when it isn't safe or useful to show."""
    t = re.sub(r"[*_`#>]+", "", text or "")
    t = re.sub(r"\s+", " ", t).strip()
    if not t or len(t) > 220 or "{" in t:
        return None
    sentences = [x for x in re.split(r"(?<=[.!?])\s+", t) if x]
    if len(sentences) > 2:
        return None
    low = t.lower()
    if any(k in low for k in LEAK) or causal_phrases(t):
        return None
    asked = {v for _, v, _, _ in extract_numbers(question)[0]}
    for y, m, d in extract_numbers(question)[1]:
        asked |= {float(y), float(int(m)), float(int(d))}
    if check_numbers([t], asked):
        return None
    return t


def plan_summary(text: str, steps: list[dict[str, Any]], question: str) -> tuple[str, str]:
    """(summary, source): the model's own sentence when it passes the checks, else a code description."""
    own = model_plan(text, question)
    return (own, "llm") if own else (code_plan(steps), "code")
