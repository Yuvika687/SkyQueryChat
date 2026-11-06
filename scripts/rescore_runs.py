"""Re-score saved runs with the 2026-11-06 checks, WITHOUT changing their published first-pass scores.

  python scripts/rescore_runs.py            # writes evals/rescored/<run>.json and a summary table

Two separate extras per turn:
  resolved_ok   - the city / pollutant / dates the tools used match the question (stricter).
                  Rebuilt from stored tool-call arguments when the run saved them, otherwise from the
                  answer's stored sources (marked "from_sources").
  pass_lenient  - wording/alias scoring: 'Bangalore' counts for Bengaluru, 'unavailable' for
                  'not available', and warnings code now always shows (e.g. the 999 limit) count as included.
The original pass/fail stays the headline; these numbers are reported beside it, never instead of it.
"""
import importlib.util
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from backend.agent import resolver as R  # noqa: E402
from backend.agent.required import TEXT as REQ_TEXT  # noqa: E402

spec = importlib.util.spec_from_file_location("run_eval", ROOT / "scripts" / "run_eval.py")
E = importlib.util.module_from_spec(spec)
spec.loader.exec_module(E)

RUNS = ROOT / "evals" / "runs"
OUT = ROOT / "evals" / "rescored"
POL = {"pm25": "PM2.5", "pm10": "PM10"}
TOOL_REQUIRED = {"delhi_pm_diwali": ["source_limit_999"], "diwali_aqi": ["aqi_not_concentration", "not_causal"],
                 "weather_association": ["modelled_weather", "association_not_cause"]}


def from_args(events: list) -> dict | None:
    items = []
    for e in events:
        if not isinstance(e, dict) or e.get("type") != "tool_call":
            continue
        a = (e.get("detail") or {}).get("args") or {}
        tool = e.get("title")
        if tool in ("check_request", None):
            continue
        cities = [R.resolve_city(c).get("city") for c in (a.get("cities") or ([a["city"]] if a.get("city") else []))]
        if tool.startswith("diwali") or tool == "delhi_pm_diwali":
            pol = "AQI (official CPCB)" if tool == "diwali_aqi" else "PM2.5 and PM10"
            items.append({"cities": cities or ["Delhi"], "pollutant": pol})
            continue
        r = R.resolve_period(a.get("period") or "all data")
        p = R.resolve_pollutant(a.get("pollutant") or "PM2.5").get("pollutant")
        items.append({"cities": cities, "pollutant": POL.get(p, p), "start": r.get("start"), "end": r.get("end")})
    return merge(items)


def from_sources(final: dict) -> dict | None:
    items = []
    for s in final.get("sources") or []:
        t = s.get("title", "")
        cities = [c for c in R.SUPPORTED_CITIES if c in t]
        pol = "AQI" if "AQI" in t else ("PM10" if "PM10" in t else ("PM2.5" if "PM2.5" in t else
                                                                  ("PM2.5 and PM10" if "PM" in t else None)))
        dr = s.get("date_range") or {}
        items.append({"cities": cities, "pollutant": pol, "start": dr.get("start"), "end": dr.get("end")})
    return merge(items)


def merge(items):
    if not items:
        return None
    starts = [x["start"] for x in items if x.get("start")]
    ends = [x["end"] for x in items if x.get("end")]
    return {"cities": list(dict.fromkeys(c for x in items for c in x["cities"] if c)),
            "pollutant": " / ".join(dict.fromkeys(x["pollutant"] for x in items if x.get("pollutant"))) or None,
            "start_date": min(starts) if starts else None, "end_date": max(ends) if ends else None}


def expectations(set_name: str) -> dict:
    qs = E.load_questions(set_name)
    return {(q["id"], t + 1): e for q in qs for t, e in enumerate(q["expect"])}


def rescore(run: Path) -> dict:
    meta = json.loads((run / "meta.json").read_text())
    exp = expectations(meta["set"])
    rows = [json.loads(x) for x in (run / "results.jsonl").read_text().splitlines() if x.strip()]
    out = []
    for r in rows:
        e = exp.get((r["id"], r["turn"]), r["expected"])
        f = r["final"]
        has_args = any(isinstance(x, dict) and x.get("type") == "tool_call" for x in r.get("events", []))
        rq = f.get("resolved_query") or (from_args(r["events"]) if has_args else from_sources(f))
        how = "stored" if f.get("resolved_query") else ("tool_args" if has_args else "from_sources")
        res = E.check_resolved(e.get("resolved"), rq)
        req = [REQ_TEXT[c] for t in r.get("tools_called", []) for c in TOOL_REQUIRED.get(t, [])]
        text = f"{f.get('answer', '')}\n{f.get('clarifying_question') or ''}"
        others = all(r["checks"].get(k, True) for k in ("status_ok", "tool_ok", "numbers_supported", "not_ok",
                                                         "causal_ok", "ref_ok")) and f["status"] != "error"
        out.append({"id": r["id"], "turn": r["turn"], "model": f.get("model"), "original_pass": r["checks"]["pass"],
                    "resolved_ok": None if res is None else res["ok"], "resolved_why": res and res["why"],
                    "resolved_from": how, "pass_lenient": others and E.include_lenient(e, text, req),
                    "pass_with_resolved_check": r["checks"]["pass"] and (res is None or res["ok"])})
    n = len(out)
    summ = {"run": run.name, "set": meta["set"], "kind": meta["kind"], "turns": n,
            "original_pass": sum(x["original_pass"] for x in out),
            "pass_with_resolved_check": sum(x["pass_with_resolved_check"] for x in out),
            "resolved_checked": sum(x["resolved_ok"] is not None for x in out),
            "resolved_failures": [f"{x['id']}.{x['turn']} ({x['resolved_from']}): {x['resolved_why']}"
                                  for x in out if x["resolved_ok"] is False],
            "pass_lenient_wording": sum(x["pass_lenient"] for x in out),
            "lenient_changes": [f"{x['id']}.{x['turn']}" for x in out if x["pass_lenient"] and not x["original_pass"]]}
    OUT.mkdir(exist_ok=True)
    (OUT / f"{run.name}.json").write_text(json.dumps({"_about": __doc__.strip().splitlines()[0], "summary": summ,
                                                      "turns": out}, indent=1) + "\n")
    return summ


if __name__ == "__main__":
    targets = sys.argv[1:] or ["20261105-1348_main_first", "20261105-1417_holdout_first", "20261106-1154_main_model_check"]
    for t in targets:
        s = rescore(RUNS / t)
        print(f"{s['run']}: original {s['original_pass']}/{s['turns']} | with resolved check "
              f"{s['pass_with_resolved_check']}/{s['turns']} (checked {s['resolved_checked']}) | lenient wording "
              f"{s['pass_lenient_wording']}/{s['turns']} (+{s['lenient_changes']})")
        for x in s["resolved_failures"]:
            print("   resolved FAIL", x)
