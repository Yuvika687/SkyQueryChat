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
    k = load()
    a, q = k["assistant"], k["aqi"]
    cats = []
    for c in q["categories"]:
        pm25 = _rng(c["pm25_24h_ugm3"]) if "pm25_24h_ugm3" in c else f"above {c['pm25_24h_ugm3_above']}"
        pm10 = _rng(c["pm10_24h_ugm3"]) if "pm10_24h_ugm3" in c else f"above {c['pm10_24h_ugm3_above']}"
        cats.append(f"{c['category']}: AQI {_rng(c['aqi'])}, PM2.5 {pm25}, PM10 {pm10} µg/m³ (24 h); "
                    f"CPCB health statement: \"{c['health_statement']}\"")
    s = k["standards_24h"]
    lines = [
        f"About you: {a['name']}, {a['role']}: {', '.join(a['cities'])}; pollutants {' and '.join(a['pollutants'])}.",
        "You can answer: " + "; ".join(a["abilities"]) + ".",
        "How answers work: " + a["how_answers_work"],
        "You cannot: " + "; ".join(a["cannot_do"]) + ".",
        "AQI: " + q["what"] + " " + q["bulletin"],
        "CPCB categories: " + " | ".join(cats) + f" (source: {q['health_source']}).",
        "Glossary: " + " ".join(f"{t}: {v}" for t, v in k["glossary"].items()),
        f"24-hour standards: India NAAQS PM2.5 {s['india_naaqs']['pm25_ugm3']}, PM10 {s['india_naaqs']['pm10_ugm3']} µg/m³; "
        f"WHO guideline PM2.5 {s['who_guideline']['pm25_ugm3']}, PM10 {s['who_guideline']['pm10_ugm3']} µg/m³.",
        "Sources: " + " ".join(f"{x['name']} ({x['type']}): {x['what']}." for x in k["sources"]),
        "Method: " + " ".join(k["method"]),
        "Known limits: " + " ".join(k["known_limits"]),
    ]
    return "\n".join(lines)


def allowed(windows: dict | None = None) -> set[float]:
    """Numbers a non-data answer may use: everything in knowledge.json plus the live data windows (dates)."""
    facts = {k: v for k, v in load().items() if not k.startswith("_")}     # the file's own note is not a fact
    payload = [facts] + ([{k: str(v) for k, v in windows.items()}] if windows else [])
    return allowed_numbers(payload) | {0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0}
