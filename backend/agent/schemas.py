"""Typed agent output and step events (FastAPI will stream StepEvent as SSE later)."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, Field

DataType = Literal["measured", "modelled", "official_aqi", "mixed"]


# ----------------------------------------------------------------------------- what the LLM returns
MessageKind = Literal["greeting", "about", "knowledge", "data", "clarify", "off_topic"]
CONVERSATION_KINDS = ("greeting", "about", "knowledge", "clarify", "off_topic")   # answered without data tools


class LLMAnswer(BaseModel):
    kind: MessageKind = Field(default="data", description=(
        "message kind (see instructions); a bare city, pollutant or period with no question and no earlier context "
        "(e.g. 'delhi?', 'mumbai') is clarify, not data"))
    status: Literal["answered", "clarify", "refused", "unavailable"]
    answer: str = Field(description="headline: 1-2 sentences, finding first; numbers exactly as in tool fields")
    explanation: str = Field(default="", description="1-3 sentences: what it means, pattern, caveats")
    follow_ups: list[str] = Field(default_factory=list, description="2-3 short next questions")
    cards: list[str] = Field(default_factory=list, description="up to 4 'dataset_id.field' for metric cards")
    chart: str | None = Field(default=None, description="dataset_id to chart")
    question: str | None = Field(default=None, description="clarifying question (status clarify)")


# ----------------------------------------------------------------------------- what the user gets
CardRole = Literal["level", "difference", "ratio", "count", "share", "rank", "statistic"]


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
    # level = a concentration or AQI (the only role that gets a category badge and scale bar)
    role: CardRole = "level"
    range95: list[float] | None = None      # [low, high] for a city mean in a comparison, shown inside its card


class SourceRef(BaseModel):
    dataset_id: str
    title: str
    source: str
    data_type: DataType
    date_range: dict[str, Any]
    stations: dict[str, Any] = Field(default_factory=dict)   # count / count_by_city / tier, from the tool result


class ResolvedQuery(BaseModel):
    """What the tools actually used (from code, not the model's wording)."""
    city: str | None = None                  # single city, or None when several
    cities: list[str] = Field(default_factory=list)
    pollutant: str | None = None
    start_date: str | None = None
    end_date: str | None = None
    assumptions: list[str] = Field(default_factory=list)
    items: list[dict[str, Any]] = Field(default_factory=list)   # one per dataset (tool, cities, pollutant, dates)


class RequiredWarning(BaseModel):
    code: str
    text: str


class FinalAnswer(BaseModel):
    status: Literal["answered", "clarify", "refused", "unavailable", "error"]
    kind: MessageKind = "data"           # conversation kinds show as a plain chat reply (no evidence, chart or checks)
    answer: str                          # LLM-written (number-checked); code-written only as a last-resort fallback
    headline: str | None = None          # the lead sentence shown first: the same text as `answer`
    explanation: str = ""                # LLM-written explanation (number-checked)
    method: str = ""                     # code-written data type, stations, coverage and method
    follow_ups: list[str] = Field(default_factory=list)   # LLM-written; empty -> the UI uses templates
    cards: list[Card] = Field(default_factory=list)
    chart: dict[str, Any] | None = None
    sources: list[SourceRef] = Field(default_factory=list)
    coverage: dict[str, Any] = Field(default_factory=dict)
    warnings: list[str] = Field(default_factory=list)
    required_warnings: list[RequiredWarning] = Field(default_factory=list)
    resolved_query: ResolvedQuery | None = None
    data_types: list[DataType] = Field(default_factory=list)
    clarifying_question: str | None = None
    # comparison answers: code-built summary from the tool result (higher city, difference, ratio, common days, each
    # city's mean and 95% range), shown as the comparison card
    comparison: dict[str, Any] | None = None
    verification: dict[str, Any] = Field(default_factory=dict)
    model: str | None = None
    usage: dict[str, int] = Field(default_factory=dict)


# ----------------------------------------------------------------------------- step events
EventType = Literal["run_started", "plan", "model_request", "tool_call", "tool_result", "tool_error",
                    "verification", "retry", "fallback", "queued", "answer", "error"]


class StepEvent(BaseModel):
    seq: int
    type: EventType
    title: str
    detail: dict[str, Any] = Field(default_factory=dict)
    ts: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat(timespec="milliseconds"))
