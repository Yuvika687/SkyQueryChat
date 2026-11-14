// Types for the SkyQueryChat backend (backend/api/main.py, backend/agent/schemas.py).
// Keep these in step with the backend; the stream tests use real recorded payloads.

export type DataType = "measured" | "modelled" | "official_aqi" | "mixed";
export type AnswerStatus = "answered" | "clarify" | "refused" | "unavailable" | "error";

export type StepType =
  | "run_started" | "plan" | "model_request" | "tool_call" | "tool_result" | "tool_error"
  | "verification" | "retry" | "fallback" | "queued" | "answer" | "error";

export interface StepEvent {
  seq: number;
  type: StepType;
  title: string;
  detail: Record<string, unknown>;
  ts?: string;
  cached?: boolean;
}

export interface Card {
  label: string;
  value: number;
  unit: string;
  dataset_id: string;
  field: string;
  data_type: DataType;
  source: string;
  warnings: string[];
}

export interface SourceRef {
  dataset_id: string;
  title: string;
  source: string;
  data_type: DataType;
  date_range: { start?: string | null; end?: string | null };
  stations?: { count?: number; count_by_city?: Record<string, number>; tier?: string; note?: string };
}

export interface ResolvedQuery {
  city: string | null;
  cities: string[];
  pollutant: string | null;
  start_date: string | null;
  end_date: string | null;
  assumptions: string[];
  items?: { tool: string; cities: string[]; pollutant: string | null; start: string | null; end: string | null }[];
}

export interface RequiredWarning {
  code: string;
  text: string;
}

export type ChartPoint = [string | number, number | null] | Record<string, unknown>;

export interface ChartSeries {
  name: string;
  type?: string;
  data: ChartPoint[];
}

export interface ChartSpec {
  type: "line" | "bar" | "scatter" | "calendar_heatmap" | string;
  title: string;
  x: { field: string; type?: string; label?: string; tooltip_fields?: string[] };
  y: { field: string; type?: string; label?: string };
  series: ChartSeries[];
  units: string;
  bands?: { label: string; start: number | string; end: number | string }[];
  colour_scale?: string | null;
  notes?: string[];
}

export interface AnswerEvent {
  status: AnswerStatus;
  text: string;
  /** Lead sentence: the model's number-checked answer (code-written only as a last-resort fallback). */
  headline?: string | null;
  /** The model's number-checked explanation (older saved answers: the code-written method text). */
  explanation: string;
  /** Code-written data type, stations, coverage and method (absent in older saved answers). */
  method?: string;
  /** Up to three follow-up questions written by the model; empty means the UI uses its templates. */
  follow_ups?: string[];
  clarifying_question: string | null;
  data_types: DataType[];
  resolved_query: ResolvedQuery | null;
  required_warnings: RequiredWarning[];
  model: string | null;
  verification: {
    passed?: boolean;
    retries?: number;
    numbers_checked?: number;
    answer_source?: "llm" | "code_fallback";
    follow_ups_source?: "llm" | "template";
  };
  cached?: boolean;
}

export type CoverageBlock = Record<string, unknown> | null;

export interface SourcesEvent {
  sources: SourceRef[];
  coverage: Record<string, CoverageBlock>;
}

export interface NoticeEvent {
  code: "low" | "fallback" | "cached_fallback" | string;
  message: string;
  model?: string;
}

export type ErrorCode =
  | "ai_limit" | "ai_busy" | "model_unavailable" | "timeout" | "model_timeout" | "verification_failed" | "format"
  | "too_many_steps" | "internal" | "rate_limited" | "invalid_input" | "network" | "backend_waking";

export interface ErrorEvent {
  code: ErrorCode | string;
  message: string;
  request_id?: string;
  retry_after_s?: number;
  demo_questions?: string[];
}

export interface DoneEvent {
  request_id: string;
  session_id: string;
  status: AnswerStatus;
  cached: boolean;
  source?: "cache" | "demo";
  model?: string | null;
  usage?: { requests?: number; input_tokens?: number; output_tokens?: number };
  elapsed_ms: number;
}

export type ChatEvent =
  | { event: "meta"; data: { request_id: string; session_id: string } }
  | { event: "notice"; data: NoticeEvent }
  | { event: "step"; data: StepEvent }
  | { event: "answer"; data: AnswerEvent }
  | { event: "cards"; data: Card[] }
  | { event: "chart"; data: ChartSpec | null }
  | { event: "sources"; data: SourcesEvent }
  | { event: "warnings"; data: string[] }
  | { event: "error"; data: ErrorEvent }
  | { event: "done"; data: DoneEvent };

export interface Health {
  status: string;
  uptime_s: number;
  data_loaded: boolean;
  ai_configured: boolean;
  ai_quota: { state: string; models: Record<string, { state: string }> };
  data_windows: Record<string, string>;
}

export interface Meta {
  cities: string[];
  pollutants: string[];
  data_windows: Record<string, string>;
  attribution: Record<string, string> | null;
  demo_questions: string[];
}

/** Official CPCB AQI for one date, from our stored 4 PM bulletin (a separate metric from PM). */
export interface OfficialAqi {
  available: boolean;
  date: string;
  aqi?: number;
  category?: string;
  period_start?: string;
  period_end?: string;
  source?: string;
}

/** GET /api/latest: each city's latest available value and its last 7 days (measured, read-only). */
export interface LatestCity {
  city: string;
  value: number;
  stations_reporting: number;
  stations_total: number;
  primary_stations: number;
  lat: number;
  lon: number;
  series: { date: string; value: number | null }[];
  /** Change versus the previous calendar day, only when that day has a value (calculated in Python). */
  change?: number | null;
  previous?: { date: string; value: number } | null;
  /** Official AQI for the same date (CPCB 4 PM bulletin); `available: false` when the bulletin is missing. */
  official_aqi?: OfficialAqi;
}
export interface Latest {
  date: string;
  start: string;
  pollutant: "pm25" | "pm10";
  units: string;
  data_type: string;
  source: string;
  method: string;
  cities: LatestCity[]; // highest first
}

/** GET /api/accuracy: stored evaluation run summaries (never recomputed). */
export interface EvalSummary {
  turns: number;
  pass: number;
  pass_pct: number;
  numbers_traceable_pct: number | null;
  tool_choice_pct?: number | null;
  reference_checks_pct?: number | null;
}
export interface Scoreboard {
  sets: Record<string, { main_first_pass: { run: string; started: string; model_chain?: string[]; summary: { overall?: EvalSummary } & Partial<EvalSummary> } | null }>;
  answer_wording_since?: string;
  crosscheck?: { by_city: Record<string, { days: number; correlation: number; within_20pct: number; period: string }> };
}

/** GET /api/explore: every station's 24-hour means over the latest 30 available days (measured, read-only). */
export interface ExploreStation {
  id: number;
  city: string;
  name: string;
  provider: string;
  tier: "primary" | "low_cost" | "supporting_single_station" | string;
  type: string;
  lat: number;
  lon: number;
  km_from_centre: number;
  last_reading_utc: string | null;
  /** 24-hour mean per day; null when the day had fewer than 16 valid hours or no readings. */
  values: (number | null)[];
  /** Valid hours per day; null when the station sent no readings that day. */
  valid_hours: (number | null)[];
}
export interface ExploreData {
  pollutant: "pm25" | "pm10";
  units: string;
  data_type: string;
  source: string;
  dates: string[];
  min_valid_hours: number;
  cities: Record<string, { values: (number | null)[]; stations_reporting: number[];
    /** Official AQI per date (null = no stored bulletin for that date). */
    aqi?: ({ aqi: number; category: string } | null)[] }>;
  stations: ExploreStation[];
}
