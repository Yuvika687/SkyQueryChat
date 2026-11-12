"""Conversation state: dataset registry (full results + named fields), what the model saw,
compressed message history and the last resolved context."""
from __future__ import annotations

import dataclasses
from dataclasses import dataclass, field
from typing import Any, Callable

from backend.analysis.store import Store
from .schemas import StepEvent
from .verify import allowed_numbers


def data_type_of(dt: str) -> str:
    d = dt.lower()
    if "official" in d and "aqi" in d:
        return "official_aqi"
    if "modelled" in d and "measured" in d:
        return "mixed"
    if "modelled" in d:
        return "modelled"
    return "measured"


@dataclass
class Session:
    store: Store
    datasets: dict[str, dict] = field(default_factory=dict)       # id -> full AnalysisResult dict
    fields: dict[str, dict] = field(default_factory=dict)         # id -> {name: Field(value, label, unit)}
    compact: dict[str, dict] = field(default_factory=dict)        # id -> payload the model saw
    other_payloads: list[Any] = field(default_factory=list)       # check_request outputs the model saw
    turns: list[list] = field(default_factory=list)               # pydantic-ai messages per turn
    context: dict[str, Any] = field(default_factory=dict)         # last cities/pollutant/period args
    max_history_turns: int = 2
    _n: int = 0

    def add_dataset(self, full: dict, fields: dict) -> str:
        self._n += 1
        ds = f"ds{self._n}"
        self.datasets[ds] = full
        self.fields[ds] = fields
        return ds

    def allowed(self) -> set[float]:
        return allowed_numbers(list(self.compact.values()) + self.other_payloads)

    def history(self) -> list:
        """Last turns for follow-ups. Thinking parts are dropped; tool results from turns before the
        most recent one are shortened to their id and field names (the full data stays in the registry)."""
        from pydantic_ai.messages import ModelRequest, ModelResponse, ThinkingPart, ToolReturnPart
        turns = self.turns[-self.max_history_turns:]
        out = []
        for i, t in enumerate(turns):
            older = i < len(turns) - 1
            for m in t:
                if isinstance(m, ModelResponse):
                    m = dataclasses.replace(m, parts=[p for p in m.parts if not isinstance(p, ThinkingPart)])
                elif older and isinstance(m, ModelRequest):
                    parts = []
                    for p in m.parts:
                        if isinstance(p, ToolReturnPart) and isinstance(p.content, dict) and "id" in p.content:
                            p = dataclasses.replace(p, content={"id": p.content["id"], "earlier_result": True,
                                                                "fields": list(p.content.get("fields", {}))[:12]})
                        parts.append(p)
                    m = dataclasses.replace(m, parts=parts)
                out.append(m)
        return out


@dataclass
class RunDeps:
    session: Session
    question: str
    emit: Callable[[StepEvent], None] | None = None
    user_numbers: set[float] = field(default_factory=set)
    run_datasets: list[str] = field(default_factory=list)
    tools_called: list[str] = field(default_factory=list)
    verification_failures: list[dict] = field(default_factory=list)
    last_answer: Any = None                  # the model's latest final_answer attempt (for the code fallback)
    events: list[StepEvent] = field(default_factory=list)

    def event(self, type_: str, title: str, **detail) -> None:
        ev = StepEvent(seq=len(self.events) + 1, type=type_, title=title, detail=detail)
        self.events.append(ev)
        if self.emit:
            self.emit(ev)
