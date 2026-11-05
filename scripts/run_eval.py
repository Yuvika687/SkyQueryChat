"""Live evaluation runner (paced for free tiers). Each run gets its own folder; first-pass runs are
the published result, reruns are kept separate.

  python scripts/run_eval.py --set main                    # first pass of the main set (47 q)
  python scripts/run_eval.py --set holdout                 # holdout (10 q + your user_questions)
  python scripts/run_eval.py --set groq                    # 15-q Groq test, Groq-only, quota-guarded
  python scripts/run_eval.py --set main --kind rerun --ids W5    # a rerun, reported separately
  python scripts/run_eval.py --resume evals/runs/<dir>     # continue an interrupted run
  python scripts/run_eval.py --scoreboard                  # rebuild evals/scoreboard.json only

Outputs: evals/runs/<stamp>_<set>_<kind>/{meta.json,results.jsonl,summary.json}, evals/scoreboard.json.
"""
import argparse
import asyncio
import json
import logging
import os
import re
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from dotenv import load_dotenv  # noqa: E402

load_dotenv(ROOT / ".env")
logging.basicConfig(level=logging.WARNING)

from backend.agent import core, models as M, verify as V  # noqa: E402
from backend.analysis.store import Store  # noqa: E402
from evals import references as REF  # noqa: E402

SETS = {"main": ROOT / "evals" / "questions.json", "groq": ROOT / "evals" / "groq_test.json",
        "holdout": ROOT / "evals" / "holdout.json"}
RUNS = ROOT / "evals" / "runs"
LEDGER = ROOT / "evals" / "groq_ledger.jsonl"
GROQ_TPD, GROQ_TPD_STOP, GROQ_EST_PER_Q = 200_000, 185_000, 8_000
GROQ_TPM_NEEDED = 6_000          # free tokens this minute before asking (limit is 8,000/min)


# ----------------------------------------------------------------------------- scoring
def load_questions(set_name: str) -> list[dict]:
    d = json.loads(SETS[set_name].read_text())
    qs = d["questions"] + [dict(q, category=q.get("category", "user")) for q in d.get("user_questions", [])]
    for q in qs:
        q.setdefault("expect", [{} for _ in q["turns"]])
        for e in q["expect"]:
            e.setdefault("status", ["answered", "refused", "unavailable", "clarify"])
    return qs


def numbers_written(final: dict) -> list[float]:
    out = [v for _, v, _, _ in V.extract_numbers(final.get("answer") or "")[0]]
    return out + [c["value"] for c in final.get("cards", [])]


def score_turn(exp: dict, final, deps, refs: dict, question: str) -> dict:
    text = f"{final.answer}\n{final.clarifying_question or ''}"
    low = text.lower()
    called = set(deps.tools_called)
    c = {"status_ok": final.status in exp["status"]}
    need, forbid = set(exp.get("tools_any", [])), set(exp.get("forbid_tools", []))
    c["tool_ok"] = (not need or bool(need & called)) and not (forbid & called)
    s = deps.session      # independent re-check of written numbers against the FULL stored results
    allowed = V.allowed_numbers(list(s.datasets.values()) + list(s.compact.values()) + s.other_payloads)
    bad = V.check_numbers([final.answer, final.clarifying_question or ""], allowed, V.user_safe_numbers(question))
    c["unsupported_numbers"] = bad
    c["numbers_supported"] = not bad
    if exp.get("refs"):
        fd = json.loads(final.model_dump_json())
        c["refs"] = {r: REF.check(refs[r], numbers_written(fd), text) for r in exp["refs"]}
        c["ref_ok"] = all(c["refs"].values())
    c["include_ok"] = all(x.lower() in low for x in exp.get("must_include", [])) and \
        (not exp.get("must_include_any") or any(x.lower() in low for x in exp["must_include_any"]))
    c["not_ok"] = not any(re.search(p, text, re.I) for p in exp.get("must_not", []))
    c["causal_ok"] = not V.causal_phrases(final.answer)
    c["pass"] = all(c[k] for k in ("status_ok", "tool_ok", "numbers_supported", "include_ok", "not_ok", "causal_ok")) \
        and c.get("ref_ok", True) and final.status != "error"
    return c


def summarise(rows: list[dict]) -> dict:
    def block(rs):
        pct = lambda a, b: round(100 * a / b, 1) if b else None
        tool = [r for r in rs if r["expected"].get("tools_any") or r["expected"].get("forbid_tools")]
        ans = [r for r in rs if r["final"]["status"] == "answered"]
        refc = [(k, v) for r in rs for k, v in (r["checks"].get("refs") or {}).items()]
        refusal = [r for r in rs if "answered" not in r["expected"]["status"]
                   or r["category"].startswith(("trap", "unsupported", "missing"))]
        toks = [(r["final"]["usage"].get("input_tokens") or 0) + (r["final"]["usage"].get("output_tokens") or 0)
                for r in rs if r["final"]["usage"]]
        toks_sorted = sorted(toks)
        return {
            "turns": len(rs), "pass": sum(r["checks"]["pass"] for r in rs),
            "pass_pct": pct(sum(r["checks"]["pass"] for r in rs), len(rs)),
            "tool_choice_pct": pct(sum(r["checks"]["tool_ok"] for r in tool), len(tool)), "tool_choice_n": len(tool),
            "numbers_traceable_pct": pct(sum(r["checks"]["numbers_supported"] for r in ans), len(ans)), "answered": len(ans),
            "reference_checks_pct": pct(sum(v for _, v in refc), len(refc)), "reference_checks_n": len(refc),
            "reference_failures": [k for k, v in refc if not v],
            "refusals_correct_pct": pct(sum(r["checks"]["status_ok"] and r["checks"]["include_ok"] and r["checks"]["not_ok"]
                                            for r in refusal), len(refusal)), "refusals_n": len(refusal),
            "errors": [f"{r['id']}.{r['turn']}" for r in rs if r["final"]["status"] == "error"],
            "failed": [f"{r['id']}.{r['turn']}" for r in rs if not r["checks"]["pass"]],
            "verifier_retries": sum(r["final"]["verification"].get("retries", 0) for r in rs),
            "tokens_median": toks_sorted[len(toks_sorted) // 2] if toks else None,
            "tokens_mean": round(sum(toks) / len(toks)) if toks else None, "tokens_max": max(toks) if toks else None,
            "tokens_total": sum(toks),
        }
    by_model = {}
    for r in rows:
        by_model.setdefault(r["final"].get("model") or "no answer (model error)", []).append(r)
    cats = {}
    for r in rows:
        cats.setdefault(r["category"], [0, 0])
        cats[r["category"]][0] += r["checks"]["pass"]
        cats[r["category"]][1] += 1
    return {"overall": block(rows), "by_model": {m: block(rs) for m, rs in by_model.items()},
            "by_category": {k: f"{a}/{b}" for k, (a, b) in sorted(cats.items())}}


def scoreboard() -> dict:
    """Main result per set = latest COMPLETE first-pass run; reruns listed separately."""
    out = {"note": "Main results are first-pass runs. Reruns are separate and never merged into main scores.", "sets": {}}
    for d in sorted(RUNS.glob("*/meta.json")):
        meta = json.loads(d.read_text())
        sp = d.parent / "summary.json"
        if not sp.exists():
            continue
        entry = {"run": d.parent.name, **{k: meta[k] for k in ("started", "model_chain", "kind", "complete", "commit")},
                 "summary": json.loads(sp.read_text())}
        s = out["sets"].setdefault(meta["set"], {"main_first_pass": None, "reruns": [], "incomplete_first_pass": []})
        if meta["kind"] == "first" and meta.get("complete"):
            s["main_first_pass"] = entry
        elif meta["kind"] == "first":
            s["incomplete_first_pass"].append(entry)
        else:
            s["reruns"].append(entry)
    (ROOT / "evals" / "scoreboard.json").write_text(json.dumps(out, indent=1))
    return out


# ----------------------------------------------------------------------------- Groq quota guard
def _ledger_24h() -> int:
    if not LEDGER.exists():
        return 0
    now = time.time()
    return sum(r["tokens"] for r in map(json.loads, LEDGER.read_text().splitlines()) if now - r["ts"] < 86_400)


def _ledger_add(tokens: int):
    with LEDGER.open("a") as f:
        f.write(json.dumps({"ts": time.time(), "tokens": int(tokens)}) + "\n")


def _parse_reset(s: str) -> float:
    m = re.fullmatch(r"(?:(\d+)m)?([\d.]+)(ms|s)", s or "")
    if not m:
        return 10.0
    sec = float(m.group(2)) / (1000 if m.group(3) == "ms" else 1)
    return sec + 60 * int(m.group(1) or 0)


def groq_probe(model: str, size_chars: int = 0) -> dict:
    """One tiny request (max_tokens 1). Returns per-minute/day header values; never prints the key.
    size_chars > 0 sends a prompt of about agent size, which tells us whether the DAILY limit has room."""
    import httpx
    key = os.environ["GROQ_API_KEY"]
    body = {"model": model, "max_tokens": 1,
            "messages": [{"role": "user", "content": ("air " * (size_chars // 4)) + "Reply OK"}]}
    for attempt in range(4):
        try:
            r = httpx.post("https://api.groq.com/openai/v1/chat/completions",
                           headers={"Authorization": f"Bearer {key}"}, json=body, timeout=60)
            break
        except httpx.TransportError:
            if attempt == 3:
                raise
            time.sleep(3 * (attempt + 1))
    h = r.headers
    out = {"status": r.status_code, "rpd_left": int(h.get("x-ratelimit-remaining-requests", 0) or 0),
           "tpm_left": int(h.get("x-ratelimit-remaining-tokens", 0) or 0),
           "tpm_reset_s": _parse_reset(h.get("x-ratelimit-reset-tokens", "")),
           "retry_after": float(h.get("retry-after", 0) or 0)}
    if r.status_code == 429:
        msg = (r.json().get("error") or {}).get("message", "")
        out["per_day"] = "per day" in msg.lower() or "(TPD)" in msg
        m = re.search(r"Used (\d+)", msg)
        out["used_today"] = int(m.group(1)) if m else None
    usage = (r.json().get("usage") or {}) if r.status_code == 200 else {}
    _ledger_add(usage.get("total_tokens", 0))
    return out


async def groq_wait_or_stop(model: str) -> str | None:
    """Returns a stop reason, or None when it is safe to ask the next question."""
    if _ledger_24h() + GROQ_EST_PER_Q > GROQ_TPD_STOP:
        return f"24-hour ledger at {_ledger_24h()} tokens; next question could pass the daily limit"
    for _ in range(6):
        p = groq_probe(model)
        if p["status"] == 429 and p.get("per_day"):
            return "Groq daily token limit reached"
        if p["rpd_left"] and p["rpd_left"] < 20:
            return "fewer than 20 Groq requests left today"
        if p["status"] == 200 and p["tpm_left"] >= GROQ_TPM_NEEDED:
            return None
        await asyncio.sleep(max(p["tpm_reset_s"], p["retry_after"], 5) + 1)
    return "per-minute limit did not recover"


# ----------------------------------------------------------------------------- run
def _commit() -> str:
    try:
        return subprocess.run(["git", "rev-parse", "--short", "HEAD"], capture_output=True, text=True, cwd=ROOT).stdout.strip()
    except Exception:
        return "unknown"


async def run(set_name, kind, ids, resume, sleep_s, batch, pause, max_tokens):
    M.setup_network()
    qs = load_questions(set_name)
    if ids:
        qs = [q for q in qs if q["id"] in ids]
    if set_name == "groq":
        groq_model = next(e.model for e in M.model_chain() if e.provider == "groq")
        os.environ["SKYQ_MODEL_CHAIN"] = f"groq:{groq_model}"
        first = groq_probe(groq_model, size_chars=22_000)     # ~6K tokens: room for at least one full question
        if first["status"] == 429:
            print(f"Groq quota not available ({'daily' if first.get('per_day') else 'per-minute'} limit; "
                  f"used today: {first.get('used_today')}). Not running.", flush=True)
            return None
    chain = [e.label for e in M.model_chain()]
    if resume:
        rdir = Path(resume)
        meta = json.loads((rdir / "meta.json").read_text())
        done = {(json.loads(l)["id"]) for l in (rdir / "results.jsonl").read_text().splitlines()}
        qs = [q for q in qs if q["id"] not in done]
    else:
        rdir = RUNS / f"{time.strftime('%Y%m%d-%H%M')}_{set_name}_{kind}"
        rdir.mkdir(parents=True, exist_ok=True)
        meta = {"set": set_name, "kind": kind, "started": time.strftime("%Y-%m-%d %H:%M"), "model_chain": chain,
                "commit": _commit(), "ids": sorted(ids) if ids else "all", "complete": False}
    (rdir / "meta.json").write_text(json.dumps(meta, indent=1))
    agent = core.build_agent()
    store = Store.from_dir()
    refs = REF.references()
    used, stopped = 0, None
    print(f"{rdir.name}: {len(qs)} question(s); chain {chain}", flush=True)
    for i, q in enumerate(qs):
        if i and i % batch == 0:
            await asyncio.sleep(pause)
        if set_name == "groq":
            stopped = await groq_wait_or_stop(chain[0].split(":", 1)[1])
            if stopped:
                break
        session = core.new_session(store)
        for t, (question, exp) in enumerate(zip(q["turns"], q["expect"])):
            t0 = time.time()
            final, deps = await core.ask(agent, session, question)
            sc = score_turn(exp, final, deps, refs, question)
            tok = (final.usage.get("input_tokens") or 0) + (final.usage.get("output_tokens") or 0)
            used += tok
            if set_name == "groq":
                _ledger_add(tok or GROQ_EST_PER_Q)
            row = {"id": q["id"], "turn": t + 1, "category": q["category"], "question": question, "expected": exp,
                   "final": json.loads(final.model_dump_json()), "tools_called": deps.tools_called,
                   "events": [{"type": e.type, "title": e.title[:120], "detail": e.detail} for e in deps.events], "checks": sc, "seconds": round(time.time() - t0, 1)}
            with (rdir / "results.jsonl").open("a") as f:
                f.write(json.dumps(row, ensure_ascii=False) + "\n")
            print(f"{q['id']}.{t + 1} {'PASS' if sc['pass'] else 'FAIL'} [{final.status}] {deps.tools_called} "
                  f"{final.model} tok={tok} {row['seconds']}s :: {final.answer[:100]}", flush=True)
            if set_name == "groq" and final.status == "error" and M.FALLBACK_LOG and M.FALLBACK_LOG[-1].get("per_day"):
                stopped = "Groq daily token limit reached mid-run"
            await asyncio.sleep(sleep_s)
        if stopped or used > max_tokens:
            stopped = stopped or f"token budget {max_tokens} reached"
            break
    rows = [json.loads(l) for l in (rdir / "results.jsonl").read_text().splitlines()] if (rdir / "results.jsonl").exists() else []
    all_ids = {q["id"] for q in load_questions(set_name) if not ids or q["id"] in ids}
    meta["complete"] = {r["id"] for r in rows} >= all_ids
    meta["stopped"] = stopped
    (rdir / "meta.json").write_text(json.dumps(meta, indent=1))
    summ = summarise(rows) if rows else {}
    (rdir / "summary.json").write_text(json.dumps(summ, indent=1))
    print(json.dumps({"run": rdir.name, "stopped": stopped, **summ.get("overall", {})}, indent=1), flush=True)
    return rdir


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--set", choices=list(SETS), default="main")
    ap.add_argument("--kind", choices=["first", "rerun"], default="first")
    ap.add_argument("--ids", nargs="*")
    ap.add_argument("--resume")
    ap.add_argument("--scoreboard", action="store_true")
    ap.add_argument("--sleep", type=float, default=20)
    ap.add_argument("--batch", type=int, default=5)
    ap.add_argument("--pause", type=float, default=45)
    ap.add_argument("--max-tokens", type=int, default=400_000)
    a = ap.parse_args()
    if a.ids and a.kind == "first" and not a.resume:
        print("Selecting --ids makes this a rerun; use --kind rerun.")
        sys.exit(2)
    if not a.scoreboard:
        asyncio.run(run(a.set, a.kind, set(a.ids or []), a.resume, a.sleep, a.batch, a.pause, a.max_tokens))
    print(json.dumps({k: (v["main_first_pass"] or {}).get("run") for k, v in scoreboard()["sets"].items()}))
