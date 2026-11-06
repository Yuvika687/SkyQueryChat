// Pure state for one question/answer turn, built from the backend's SSE events.
import type {
  AnswerEvent, Card, ChartSpec, ChatEvent, DoneEvent, ErrorEvent, NoticeEvent, SourcesEvent, StepEvent,
} from "./types";

export type Phase = "waking" | "streaming" | "done" | "error" | "stopped";

export interface Turn {
  id: string;
  question: string;
  phase: Phase;
  startedAt: number;
  requestId?: string;
  sessionId?: string;
  notices: NoticeEvent[];
  steps: StepEvent[];
  answer?: AnswerEvent;
  cards: Card[];
  chart: ChartSpec | null;
  sources?: SourcesEvent;
  warnings: string[];
  error?: ErrorEvent;
  done?: DoneEvent;
}

export function newTurn(question: string, id: string = cryptoId()): Turn {
  return { id, question, phase: "streaming", startedAt: Date.now(), notices: [], steps: [], cards: [], chart: null, warnings: [] };
}

export function applyEvent(t: Turn, ev: ChatEvent): Turn {
  switch (ev.event) {
    case "meta":
      return { ...t, requestId: ev.data.request_id, sessionId: ev.data.session_id };
    case "notice":
      return t.notices.some((n) => n.code === ev.data.code) ? t : { ...t, notices: [...t.notices, ev.data] };
    case "step":
      return { ...t, steps: [...t.steps, ev.data] };
    case "answer":
      return { ...t, answer: ev.data };
    case "cards":
      return { ...t, cards: ev.data ?? [] };
    case "chart":
      return { ...t, chart: ev.data ?? null };
    case "sources":
      return { ...t, sources: ev.data };
    case "warnings":
      return { ...t, warnings: ev.data ?? [] };
    case "error":
      return { ...t, error: ev.data, phase: "error" };
    case "done":
      return {
        ...t,
        done: ev.data,
        sessionId: ev.data.session_id || t.sessionId,
        phase: t.error || ev.data.status === "error" ? "error" : "done",
      };
    default:
      return t;
  }
}

/** Was this answer served from the cache or the demo set rather than a live model run? */
export function servedFrom(t: Turn): "cache" | "demo" | null {
  if (t.done?.cached) return t.done.source ?? "cache";
  if (t.answer?.cached) return "cache";
  return null;
}

export const PRIMARY_MODEL = "gemini-3.5-flash-lite";

/** Backup-model label when the answer came from a model other than the primary one. */
export function backupModel(t: Turn): string | null {
  const m = t.answer?.model || t.done?.model || null;
  if (!m) return null;
  return m.replace(/^.*:/, "") === PRIMARY_MODEL ? null : m.replace(/^.*:/, "");
}

function cryptoId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
