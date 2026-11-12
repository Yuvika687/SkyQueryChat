"""Pre-compute selected demo answers (served by the API without calling an LLM).

  python scripts/build_demo_answers.py            # uses the configured model chain (costs a few questions)
  python scripts/build_demo_answers.py --only 2,5 # rebuild only these (1-based) questions; keep the others
Writes data/app/demo_answers.json. Only verified answers are kept; numbers come from tool results. Prints the
model, tokens, time and verification result per question, with the saved answer's tokens for comparison.
"""
import argparse
import asyncio
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from dotenv import load_dotenv  # noqa: E402

load_dotenv(ROOT / ".env")
from backend.agent import core  # noqa: E402

DEMO = [
    "How bad was Delhi's air on Diwali 2025?",
    "Which of the six cities had the highest PM2.5 in winter 2025?",
    "Is rain associated with lower PM10 in Mumbai?",
    "Were there any unusual PM2.5 days in Delhi in 2025?",
    "What was Delhi's average PM2.5 in November 2025?",
    "Compare Mumbai's Diwali AQI in 2024 and 2025.",
    "What was Delhi's AQI on Diwali 2026?",
    "How complete is the data for Chennai in 2025?",
]


def _tokens(u: dict) -> int:
    return (u or {}).get("input_tokens", 0) + (u or {}).get("output_tokens", 0)


async def main(only: set[int] | None):
    path = ROOT / "data" / "app" / "demo_answers.json"
    saved = {a["question"]: a for a in json.loads(path.read_text())["answers"]} if path.exists() else {}
    agent = core.build_agent()
    todo = [q for i, q in enumerate(DEMO, 1) if not only or i in only]
    for n, q in enumerate(todo):
        s = core.new_session()
        t0 = time.perf_counter()
        final, deps = await core.ask(agent, s, q)
        secs = time.perf_counter() - t0
        v = final.verification
        ok = final.status in ("answered", "unavailable") and v.get("passed")
        old = _tokens((saved.get(q) or {}).get("final", {}).get("usage"))
        print(("KEEP " if ok else "SKIP ") + f"[{final.status}] {q}\n"
              f"     model {final.model} | {final.usage.get('requests')} requests | {_tokens(final.usage)} tokens "
              f"(saved answer: {old or 'n/a'}) | {secs:.1f} s | verified {v.get('passed')} "
              f"(retries {v.get('retries', 0)}, {v.get('answer_source', 'n/a')}) | follow-ups {len(final.follow_ups)}\n"
              f"     headline: {final.answer}\n     explanation: {final.explanation}\n"
              f"     follow-ups: {final.follow_ups}" + (f"\n     corrections: {v['corrections']}" if v.get("corrections") else ""),
              flush=True)
        if ok:
            saved[q] = {"question": q, "final": json.loads(final.model_dump_json()),
                        "steps": [e.model_dump() for e in deps.events if e.type in ("plan", "tool_call", "tool_result", "verification")],
                        "context": dict(s.context), "built": time.strftime("%Y-%m-%d %H:%M"), "model": final.model,
                        "elapsed_s": round(secs, 1)}
        if n < len(todo) - 1:
            await asyncio.sleep(15)
    out = [saved[q] for q in DEMO if q in saved]
    path.write_text(json.dumps({"answers": out}, indent=1, ensure_ascii=False))
    print(f"saved {len(out)} demo answers")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="comma-separated 1-based question numbers to rebuild")
    a = ap.parse_args()
    asyncio.run(main({int(x) for x in a.only.split(",")} if a.only else None))
