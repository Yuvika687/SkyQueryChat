"""Server-Sent Events formatting. Event names (in order for a normal answer):
meta -> step* -> answer -> cards -> chart -> sources -> warnings -> done
Errors: meta -> step* -> error -> done. Comment lines (': ping') keep proxies from closing idle streams."""
from __future__ import annotations

import json
from typing import Any

EVENTS = ("meta", "step", "answer", "cards", "chart", "sources", "warnings", "error", "done")


def sse(event: str, data: Any, eid: int | None = None) -> str:
    assert event in EVENTS
    body = json.dumps(data, ensure_ascii=False, default=str)
    head = f"id: {eid}\n" if eid is not None else ""
    return f"{head}event: {event}\ndata: {body}\n\n"


PING = ": ping\n\n"


def parse(stream_text: str) -> list[tuple[str, Any]]:
    """Parse an SSE text body into (event, data) pairs (used by tests and the terminal client)."""
    out = []
    for block in stream_text.split("\n\n"):
        ev, data = None, None
        for line in block.splitlines():
            if line.startswith("event: "):
                ev = line[7:]
            elif line.startswith("data: "):
                data = json.loads(line[6:])
        if ev:
            out.append((ev, data))
    return out
