"""Conversation state: dataset registry, compact tool payloads, message history and last context."""
from __future__ import annotations

import dataclasses
from dataclasses import dataclass, field
from typing import Any, Callable

from backend.analysis.store import Store
from .schemas import StepEvent
from .verify import allowed_numbers, numeric_leaves


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
    compact: dict[str, dict] = field(default_factory=dict)        # id -> what the model saw
    other_payloads: list[Any] = field(default_factory=list)       # resolver outputs etc. the model saw
    turns: list[list] = field(default_factory=list)               # pydantic-ai messages per turn
    context: dict[str, Any] = field(default_factory=dict)         # last resolved cities/pollutant/period
    max_history_turns: int = 3
    _n: int = 0

    def add_dataset(self, full: dict, compact: dict) -> str:
        self._n += 1
        ds = f"ds{self._n}"
        self.datasets[ds] = full
        compact = {"dataset_id": ds, **compact}
        self.compact[ds] = compact
        return ds

    def allowed(self) -> set[float]:
        return allowed_numbers(list(self.compact.values()) + self.other_payloads)

    def allowed_for(self, ds: str) -> set[float]:
        """Metric values must equal a numeric field of their own dataset (not a number inside text)."""
        return numeric_leaves(self.compact[ds]) if ds in self.compact else set()

    def history(self) -> list:
        """Last few turns, without model 'thinking' parts (saves tokens; never shown)."""
        from pydantic_ai.messages import ModelResponse, ThinkingPart
        msgs = [m for t in self.turns[-self.max_history_turns:] for m in t]
        out = []
        for m in msgs:
            if isinstance(m, ModelResponse):
                parts = [p for p in m.parts if not isinstance(p, ThinkingPart)]
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
    events: list[StepEvent] = field(default_factory=list)

    def event(self, type_: str, title: str, **detail) -> None:
        ev = StepEvent(seq=len(self.events) + 1, type=type_, title=title, detail=detail)
        self.events.append(ev)
        if self.emit:
            self.emit(ev)
