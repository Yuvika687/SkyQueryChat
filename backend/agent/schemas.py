"""Typed agent output and step events (FastAPI will stream StepEvent as SSE later)."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, Field

DataType = Literal["measured", "modelled", "official_aqi", "mixed"]


# ----------------------------------------------------------------------------- what the LLM returns
class LLMAnswer(BaseModel):
    status: Literal["answered", "clarify", "refused", "unavailable"]
    answer: str = Field(description="1-3 sentences; numbers exactly as in tool fields")
    cards: list[str] = Field(default_factory=list, description="up to 4 'dataset_id.field' for metric cards")
    chart: str | None = Field(default=None, description="dataset_id to chart")
    question: str | None = Field(default=None, description="clarifying question (status clarify)")


# ----------------------------------------------------------------------------- what the user gets
class Card(BaseModel):
    """Metric card built by code from a tool-result field (the model only names the field)."""
    label: str
    value: float
    unit: str
    dataset_id: str
    field: str
    data_type: DataType
    source: str
    warnings: list[str] = Field(default_factory=list)


class SourceRef(BaseModel):
    dataset_id: str
    title: str
    source: str
    data_type: DataType
    date_range: dict[str, Any]


class FinalAnswer(BaseModel):
    status: Literal["answered", "clarify", "refused", "unavailable", "error"]
    answer: str
    explanation: str = ""
    cards: list[Card] = Field(default_factory=list)
    chart: dict[str, Any] | None = None
    sources: list[SourceRef] = Field(default_factory=list)
    coverage: dict[str, Any] = Field(default_factory=dict)
    warnings: list[str] = Field(default_factory=list)
    data_types: list[DataType] = Field(default_factory=list)
    clarifying_question: str | None = None
    verification: dict[str, Any] = Field(default_factory=dict)
    model: str | None = None
    usage: dict[str, int] = Field(default_factory=dict)


# ----------------------------------------------------------------------------- step events
EventType = Literal["run_started", "plan", "model_request", "tool_call", "tool_result", "tool_error",
                    "verification", "retry", "fallback", "answer", "error"]


class StepEvent(BaseModel):
    seq: int
    type: EventType
    title: str
    detail: dict[str, Any] = Field(default_factory=dict)
    ts: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat(timespec="milliseconds"))
