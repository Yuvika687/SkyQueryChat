"""Ask SkyQueryChat questions in the terminal.

  python scripts/ask.py                       # interactive; follow-ups keep context; 'exit' to quit
  python scripts/ask.py "Delhi PM2.5 in November 2025?"   # one question
  python scripts/ask.py --json "..."          # print the typed answer as JSON

Keys come from .env. Prompts, keys and stack traces are never printed.
"""
import argparse
import asyncio
import json
import logging
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from dotenv import load_dotenv  # noqa: E402

load_dotenv(ROOT / ".env")
logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(name)s: %(message)s")

from backend.agent import core  # noqa: E402

ICON = {"run_started": "▶", "plan": "🧭", "model_request": "…", "tool_call": "🔧", "tool_result": "📦",
        "tool_error": "⚠", "verification": "✔", "retry": "↻", "fallback": "⇄", "answer": "■", "error": "✖"}


def show_event(e):
    extra = ""
    if e.type == "tool_call":
        extra = " " + json.dumps(e.detail.get("args", {}), ensure_ascii=False)
    elif e.type == "tool_result" and e.detail.get("dataset_id"):
        extra = f"  [{e.detail['dataset_id']}, {e.detail.get('data_type')}]"
    elif e.type == "retry":
        extra = "  " + "; ".join(e.detail.get("reasons", []))[:200]
    print(f"  {ICON.get(e.type, '·')} {e.type}: {e.title}{extra}", flush=True)


def show_answer(a, as_json=False):
    if as_json:
        print(a.model_dump_json(indent=1))
        return
    print(f"\n[{a.status}] {a.answer}")
    if a.clarifying_question:
        print(f"  ? {a.clarifying_question}")
    if a.explanation:
        print(f"\n{a.explanation}")
    for m in a.cards:
        print(f"  • {m.label}: {m.value:g} {m.unit}   ({m.data_type}, {m.dataset_id}.{m.field})")
    if a.chart:
        print(f"  chart: {a.chart['type']} — {a.chart['title']}")
    for s in a.sources:
        print(f"  source [{s.dataset_id}] {s.data_type}: {s.source} ({s.date_range.get('start')} to {s.date_range.get('end')})")
    for w in a.warnings[:6]:
        print(f"  ! {w}")
    v = a.verification
    print(f"  numbers verified: {v.get('passed')} (retries {v.get('retries', 0)}); model {a.model}; usage {a.usage}\n")


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("question", nargs="*")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--quiet", action="store_true", help="hide step events")
    a = ap.parse_args()
    try:
        agent = core.build_agent()
    except RuntimeError as e:
        print(str(e))
        return
    session = core.new_session()
    cb = None if a.quiet else show_event
    if a.question:
        ans, _ = await core.ask(agent, session, " ".join(a.question), on_event=cb)
        show_answer(ans, a.json)
        return
    print("SkyQueryChat (terminal). Cities: " + ", ".join(core.R.SUPPORTED_CITIES) + ". Type 'exit' to quit.")
    while True:
        try:
            q = input("you> ").strip()
        except (EOFError, KeyboardInterrupt):
            break
        if q.lower() in ("exit", "quit"):
            break
        if q:
            ans, _ = await core.ask(agent, session, q, on_event=cb)
            show_answer(ans, a.json)


if __name__ == "__main__":
    asyncio.run(main())
