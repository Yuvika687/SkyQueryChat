"""Typed agent output and step events (FastAPI will stream StepEvent as SSE later)."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, Field

DataType = Literal["measured", "modelled", "official_aqi", "mixed"]


# ----------------------------------------------------------------------------- what the LLM returns
class MetricRef(BaseModel):
    """A number to show as a metric card. `value` must appear in the referenced tool result."""
    label: str = Field(description="Short label, e.g. 'Delhi festival AQI 2025'")
    value: float = Field(description="Copied exactly from the tool result; never calculated")
    unit: str = Field(default="", description="Optional; filled from the dataset if empty")
    dataset_id: str = Field(description="dataset_id of the tool result this number came from")


class LLMAnswer(BaseModel):
    status: Literal["answered", "clarify", "refused", "unavailable"] = Field(
        description="answered | clarify (ask one question) | refused (unsupported/unsafe) | unavailable (no data)")
    answer: str = Field(description="Direct answer in 1-3 sentences. Numbers only as written in tool results.")
    explanation: str = Field(default="", description="Short explanation: metric, dates, stations, coverage, caveats")
    metrics: list[MetricRef] = Field(default_factory=list, description="Up to 6 key numbers")
    chart_dataset_id: str | None = Field(default=None, description="dataset_id whose chart to show, if any")
    dataset_ids: list[str] = Field(default_factory=list, description="dataset_ids used for this answer")
    clarifying_question: str | None = Field(default=None, description="Only when status is clarify")


# ----------------------------------------------------------------------------- what the user gets
class Metric(BaseModel):
    label: str
    value: float
    unit: str
    dataset_id: str
    data_type: DataType
    source: str


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
    metrics: list[Metric] = Field(default_factory=list)
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
