"""Verified facts for conversation answers (greetings, the project, air-quality knowledge).

The facts live in backend/config/knowledge.json. `digest()` is the compact text the model sees while it has not called
a data tool; `allowed()` is every number in the file plus the live data windows, which is all a non-data answer may
quote (backend/agent/core.py checks it with the same number checker as data answers).
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from .verify import allowed_numbers

PATH = Path(__file__).resolve().parents[1] / "config" / "knowledge.json"


@lru_cache(maxsize=1)
def load() -> dict:
    return json.loads(PATH.read_text())


def _rng(x) -> str:
    return f"{x[0]}–{x[1]}"


@lru_cache(maxsize=1)
def digest() -> str:
    """Compact facts for the prompt (about 2,000 characters)."""
    k = load()
    a, q, s = k["assistant"], k["aqi"], k["standards_24h"]
    cats = []
    for c in q["categories"]:
        pm25 = _rng(c["pm25_24h_ugm3"]) if "pm25_24h_ugm3" in c else f">{c['pm25_24h_ugm3_above']}"
        pm10 = _rng(c["pm10_24h_ugm3"]) if "pm10_24h_ugm3" in c else f">{c['pm10_24h_ugm3_above']}"
        cats.append(f"{c['category']} {_rng(c['aqi'])} (PM2.5 {pm25}, PM10 {pm10}): \"{c['health_statement']}\"")
    return "\n".join([
        f"You: {a['name']}, {a['role']} ({', '.join(a['cities'])}); PM2.5 and PM10. Can do: " + "; ".join(a["abilities"])
        + ". " + a["how_answers_work"] + " Cannot: " + "; ".join(a["cannot_do"]) + ".",
        "AQI: " + q["what"] + " " + q["bulletin"],
        "CPCB categories, AQI (24-h PM µg/m³) and CPCB health statement: " + "; ".join(cats) + ".",
        "Terms: " + " ".join(f"{t}: {v.split(':')[0]}." for t, v in k["glossary"].items()),
        f"24-h standards: India PM2.5 {s['india_naaqs']['pm25_ugm3']}, PM10 {s['india_naaqs']['pm10_ugm3']}; WHO PM2.5 "
        f"{s['who_guideline']['pm25_ugm3']}, PM10 {s['who_guideline']['pm10_ugm3']} µg/m³.",
        "Sources: " + "; ".join(f"{x['name']} ({x['type']})" for x in k["sources"]) + ".",
        "Limits: " + " ".join(k["known_limits"][:4]),
    ])


def allowed(windows: dict | None = None) -> set[float]:
    """Numbers a non-data answer may use: everything in knowledge.json plus the live data windows (dates)."""
    facts = {k: v for k, v in load().items() if not k.startswith("_")}     # the file's own note is not a fact
    payload = [facts] + ([{k: str(v) for k, v in windows.items()}] if windows else [])
    return allowed_numbers(payload) | {0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0}
