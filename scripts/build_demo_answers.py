"""Pre-compute selected demo answers (served by the API without calling an LLM).

  python scripts/build_demo_answers.py            # uses the configured model chain (costs a few questions)
Writes data/app/demo_answers.json. Only verified answers are kept; numbers come from tool results.
"""
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


async def main():
    agent = core.build_agent()
    out = []
    for q in DEMO:
        s = core.new_session()
        final, deps = await core.ask(agent, s, q)
        ok = final.status in ("answered", "unavailable") and final.verification.get("passed")
        print(("KEEP " if ok else "SKIP ") + f"[{final.status}] {q} :: {final.answer[:90]}", flush=True)
        if ok:
            out.append({"question": q, "final": json.loads(final.model_dump_json()),
                        "steps": [e.model_dump() for e in deps.events if e.type in ("plan", "tool_call", "tool_result", "verification")],
                        "context": dict(s.context), "built": time.strftime("%Y-%m-%d %H:%M"), "model": final.model})
        await asyncio.sleep(15)
    (ROOT / "data" / "app" / "demo_answers.json").write_text(json.dumps({"answers": out}, indent=1, ensure_ascii=False))
    print(f"saved {len(out)} demo answers")


if __name__ == "__main__":
    asyncio.run(main())
