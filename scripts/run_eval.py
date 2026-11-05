"""Live evaluation of the agent, in small batches that stay inside free-tier limits.

  python scripts/run_eval.py                 # run all not-yet-done questions (resumable)
  python scripts/run_eval.py --ids T1 D3     # selected questions
  python scripts/run_eval.py --rerun-failed  # rerun questions whose last run had an error
  python scripts/run_eval.py --summary       # score existing results only

Pacing (defaults): 30 s between turns, 90 s pause every 5 questions, stop at 150K tokens per run
(Groq gpt-oss-120b free tier: 8K tokens/min, 1K requests/day, 200K tokens/day).
Results: evals/results/live.jsonl (one line per turn) and evals/results/summary.json.
"""
import argparse
import asyncio
import json
import logging
import re
import sys
import time
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from dotenv import load_dotenv  # noqa: E402

load_dotenv(ROOT / ".env")
logging.basicConfig(level=logging.WARNING)

from backend.agent import core, verify as V  # noqa: E402
from backend.analysis import functions as F  # noqa: E402
from backend.analysis.store import Store  # noqa: E402

QFILE = ROOT / "evals" / "questions.json"
OUT = ROOT / "evals" / "results"
CITIES = ["Delhi", "Mumbai", "Kolkata", "Chennai", "Bengaluru", "Hyderabad"]


def references(S: Store) -> dict:
    """Deterministic expected values, computed by the analysis functions (not by the LLM)."""
    tr = lambda c, p, a, b: F.city_trend(S, c, p, a, b, "M").to_dict()["values"]
    pct25 = F.diwali_aqi_percent(S, "Delhi", 2025).to_dict()["values"]
    return {
        "mumbai_pm10_nov2025": {"numbers": [tr("Mumbai", "pm10", date(2025, 11, 1), date(2025, 11, 30))["periods"][0]["mean"]]},
        "delhi_pm25_nov2025": {"numbers": [tr("Delhi", "pm25", date(2025, 11, 1), date(2025, 11, 30))["periods"][0]["mean"]]},
        "delhi_pm10_nov2025": {"numbers": [tr("Delhi", "pm10", date(2025, 11, 1), date(2025, 11, 30))["periods"][0]["mean"]]},
        "chennai_pm25_2026_max": {"numbers": [tr("Chennai", "pm25", date(2026, 1, 1), date(2026, 12, 31))["summary"]["highest_day"]["value"]]},
        "winter2025_top_city": {"text": [F.compare_cities(S, CITIES, "pm25", date(2025, 12, 1), date(2026, 2, 28)).to_dict()["values"]["cities"][0]["city"]]},
        "delhi_diwali2025_level": {"numbers": [[y for y in F.diwali_aqi(S, "Delhi", (2025,)).to_dict()["values"]["years"]][0]["festival_level_aqi"]]},
        "delhi_diwali2025_pct_range": {"numbers": pct25["percent_range"]},
        "delhi_diwali2024_pct": {"numbers": [F.diwali_aqi_percent(S, "Delhi", 2024).to_dict()["values"]["percent_change"]]},
    }


def numbers_written(final) -> list[float]:
    out = []
    for t in (final.answer, final.explanation):
        out += [v for _, v, _, _ in V.extract_numbers(t or "")[0]]
    out += [m.value for m in final.metrics]
    return out


def score_turn(exp: dict, final, deps, refs: dict, question: str) -> dict:
    text = f"{final.answer}\n{final.explanation}\n{final.clarifying_question or ''}"
    low = text.lower()
    called = set(deps.tools_called)
    c = {}
    c["status_ok"] = final.status in exp["status"]
    need = set(exp.get("tools_any", []))
    forbid = set(exp.get("forbid_tools", []))
    c["tool_ok"] = (not need or bool(need & called)) and not (forbid & called)
    # independent number check against the FULL stored results of this session
    s = deps.session
    allowed = V.allowed_numbers(list(s.datasets.values()) + s.other_payloads)
    texts = [final.answer, final.explanation, final.clarifying_question or ""] + [m.label for m in final.metrics]
    bad = V.check_numbers(texts, allowed, V.user_safe_numbers(question))
    bad += [str(m.value) for m in final.metrics if not V.number_supported(m.value, 3, False, allowed)
            and not V.number_supported(m.value, 1, False, allowed)]
    c["unsupported_numbers"] = bad
    c["numbers_supported"] = not bad
    if exp.get("ref"):
        ref = refs[exp["ref"]]
        nums = numbers_written(final)
        ok = all(any(abs(n - r) < 0.051 or (r == round(r) and n == round(r)) for n in nums) for r in ref.get("numbers", []))
        ok = ok and all(t.lower() in low for t in ref.get("text", []))
        c["ref_ok"] = ok
    c["include_ok"] = all(x.lower() in low for x in exp.get("must_include", [])) and \
        (not exp.get("must_include_any") or any(x.lower() in low for x in exp["must_include_any"]))
    c["not_ok"] = not any(re.search(p, text, re.I) for p in exp.get("must_not", []))
    c["causal_ok"] = not V.causal_phrases(final.answer + "\n" + final.explanation)
    c["pass"] = all(c[k] for k in ("status_ok", "tool_ok", "numbers_supported", "include_ok", "not_ok", "causal_ok")) \
        and c.get("ref_ok", True) and final.status != "error"
    return c


async def run(ids, rerun_failed, sleep_s, batch, pause, max_tokens):
    qs = json.loads(QFILE.read_text())["questions"]
    OUT.mkdir(parents=True, exist_ok=True)
    res_file = OUT / "live.jsonl"
    done = {}
    if res_file.exists():
        for line in res_file.read_text().splitlines():
            r = json.loads(line)
            done.setdefault(r["id"], []).append(r)
    todo = []
    for q in qs:
        if ids and q["id"] not in ids:
            continue
        prev = done.get(q["id"])
        if prev and not ids and not (rerun_failed and any(r["final"]["status"] == "error" for r in prev[-len(q["turns"]):])):
            continue
        todo.append(q)
    agent = core.build_agent()
    store = Store.from_dir()
    refs = references(store)
    used = 0
    print(f"{len(todo)} question(s) to run", flush=True)
    for i, q in enumerate(todo):
        if i and i % batch == 0:
            print(f"-- batch pause {pause}s", flush=True)
            await asyncio.sleep(pause)
        session = core.new_session(store)
        for t, (question, exp) in enumerate(zip(q["turns"], q["expect"])):
            t0 = time.time()
            final, deps = await core.ask(agent, session, question)
            sc = score_turn(exp, final, deps, refs, question)
            tok = (final.usage.get("input_tokens") or 0) + (final.usage.get("output_tokens") or 0)
            used += tok
            row = {"id": q["id"], "turn": t + 1, "category": q["category"], "question": question,
                   "expected": exp, "final": json.loads(final.model_dump_json()), "tools_called": deps.tools_called,
                   "events": [e.type for e in deps.events], "checks": sc, "seconds": round(time.time() - t0, 1),
                   "run_at": time.strftime("%Y-%m-%d %H:%M:%S")}
            with res_file.open("a") as f:
                f.write(json.dumps(row, ensure_ascii=False) + "\n")
            print(f"{q['id']}.{t + 1} {'PASS' if sc['pass'] else 'FAIL'} [{final.status}] tools={deps.tools_called} "
                  f"model={final.model} tok={tok} {row['seconds']}s :: {final.answer[:110]}", flush=True)
            if used > max_tokens:
                print(f"token budget {max_tokens} reached; stopping (resume later)", flush=True)
                return
            await asyncio.sleep(sleep_s)


def summarise():
    qs = {q["id"]: q for q in json.loads(QFILE.read_text())["questions"]}
    rows = {}
    for line in (OUT / "live.jsonl").read_text().splitlines():
        r = json.loads(line)
        rows[(r["id"], r["turn"])] = r          # latest run wins
    rows = list(rows.values())
    tool_rows = [r for r in rows if r["expected"].get("tools_any") or r["expected"].get("forbid_tools")]
    ans = [r for r in rows if r["final"]["status"] == "answered"]
    ref_rows = [r for r in rows if "ref_ok" in r["checks"]]
    refusal_rows = [r for r in rows if "answered" not in r["expected"]["status"]
                    or r["category"].startswith(("trap", "unsupported", "missing"))]
    errors = [r for r in rows if r["final"]["status"] == "error"]
    pct = lambda a, b: round(100 * a / b, 1) if b else None
    by_cat = {}
    for r in rows:
        by_cat.setdefault(r["category"], [0, 0])
        by_cat[r["category"]][0] += r["checks"]["pass"]
        by_cat[r["category"]][1] += 1
    tokens = sum((r["final"]["usage"].get("input_tokens") or 0) + (r["final"]["usage"].get("output_tokens") or 0) for r in rows)
    models = {}
    for r in rows:
        models[r["final"].get("model")] = models.get(r["final"].get("model"), 0) + 1
    s = {
        "questions": len({r["id"] for r in rows}), "turns": len(rows), "of_questions_defined": len(qs),
        "tool_choice_accuracy": {"pct": pct(sum(r["checks"]["tool_ok"] for r in tool_rows), len(tool_rows)),
                                 "n": len(tool_rows)},
        "numeric_match_accuracy": {
            "all_numbers_traceable_pct": pct(sum(r["checks"]["numbers_supported"] for r in ans), len(ans)),
            "answered_turns": len(ans),
            "reference_values_correct_pct": pct(sum(r["checks"]["ref_ok"] for r in ref_rows), len(ref_rows)),
            "reference_turns": len(ref_rows)},
        "correct_refusals_and_unavailable": {
            "pct": pct(sum(r["checks"]["status_ok"] and r["checks"]["include_ok"] and r["checks"]["not_ok"]
                           for r in refusal_rows), len(refusal_rows)), "n": len(refusal_rows)},
        "failures": {"errors": len(errors), "error_ids": [f"{r['id']}.{r['turn']}" for r in errors],
                     "failed_checks": [f"{r['id']}.{r['turn']}" for r in rows if not r["checks"]["pass"]]},
        "overall_pass_pct": pct(sum(r["checks"]["pass"] for r in rows), len(rows)),
        "by_category": {k: f"{v[0]}/{v[1]}" for k, v in sorted(by_cat.items())},
        "verifier_retries_total": sum(r["final"]["verification"].get("retries", 0) for r in rows),
        "answers_by_model": models, "tokens_total": tokens,
    }
    (OUT / "summary.json").write_text(json.dumps(s, indent=1))
    print(json.dumps(s, indent=1))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--ids", nargs="*")
    ap.add_argument("--rerun-failed", action="store_true")
    ap.add_argument("--summary", action="store_true")
    ap.add_argument("--sleep", type=float, default=30)
    ap.add_argument("--batch", type=int, default=5)
    ap.add_argument("--pause", type=float, default=90)
    ap.add_argument("--max-tokens", type=int, default=150_000)
    a = ap.parse_args()
    if not a.summary:
        asyncio.run(run(set(a.ids or []), a.rerun_failed, a.sleep, a.batch, a.pause, a.max_tokens))
    summarise()
