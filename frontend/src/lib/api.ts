// Typed client for the SkyQueryChat API.
import { API_BASE_URL, DEMO_FLAG_COOKIE } from "./env";
import { readSSE } from "./sse";
import type { ChatEvent, ErrorEvent, ExploreData, Health, Latest, Meta, Scoreboard } from "./types";

export class ApiError extends Error {
  constructor(public code: string, message: string, public retryAfterS?: number) {
    super(message);
  }
}

const FRIENDLY: Record<string, string> = {
  network: "We couldn't reach the analysis service. Check your connection and try again.",
  internal: "Something went wrong. Please try again.",
  backend_waking: "The analysis service didn't start in time. Please try again.",
};

async function getJSON<T>(path: string, timeoutMs = 8000, signal?: AbortSignal): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  const onAbort = () => ctl.abort();
  signal?.addEventListener("abort", onAbort);
  try {
    const res = await fetch(`${API_BASE_URL}${path}`, { signal: ctl.signal, cache: "no-store" });
    if (!res.ok) throw new ApiError("internal", FRIENDLY.internal);
    return (await res.json()) as T;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError("network", FRIENDLY.network);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

export const getHealth = (timeoutMs = 5000, signal?: AbortSignal) => getJSON<Health>("/api/health", timeoutMs, signal);
export const getMeta = () => getJSON<Meta>("/api/meta");
/** Latest available city values and 7-day series for the home page (read-only, no AI). */
export const getLatest = (signal?: AbortSignal) => getJSON<Latest>("/api/latest", 15_000, signal);
/** Stored evaluation scores (first-pass runs only). */
export const getAccuracy = () => getJSON<Scoreboard>("/api/accuracy");
/** Explore map: station 24-hour means over the latest 30 available days (read-only, no AI). */
export const getExplore = (pollutant: "pm25" | "pm10") => getJSON<ExploreData>(`/api/explore?pollutant=${pollutant}`, 20_000);

/**
 * Wait until the backend answers /api/health. Render's free service sleeps after 15 minutes idle; waking takes
 * about a minute, plus about 25-40 s for the API to load its data at 0.1 CPU (measured in a Linux container).
 * `onWaking` fires once if the first check is slow or fails.
 */
export async function waitForBackend(opts: {
  onWaking?: () => void;
  maxWaitMs?: number;
  signal?: AbortSignal;
  probeMs?: number;
} = {}): Promise<Health> {
  const { onWaking, maxWaitMs = 150_000, signal, probeMs = 4000 } = opts;
  const start = Date.now();
  let warned = false;
  while (true) {
    try {
      return await getHealth(probeMs, signal);
    } catch {
      if (signal?.aborted) throw new ApiError("network", FRIENDLY.network);
      if (!warned) {
        warned = true;
        onWaking?.();
      }
      if (Date.now() - start > maxWaitMs) throw new ApiError("backend_waking", FRIENDLY.backend_waking);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

function demoMode(): boolean {
  return typeof document !== "undefined" && document.cookie.split("; ").some((c) => c === `${DEMO_FLAG_COOKIE}=1`);
}

/**
 * Stream one chat turn. Yields backend events in order. HTTP-level failures (rate limit, invalid input,
 * network) are turned into a synthetic `error` event so the UI handles every failure in one place.
 */
export async function* streamChat(
  message: string,
  sessionId: string | null,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): AsyncGenerator<ChatEvent> {
  // Owner demo mode goes through a same-origin route that adds the demo token on the server.
  const url = demoMode() ? "/api/demo/chat" : `${API_BASE_URL}/api/chat`;
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify(sessionId ? { message, session_id: sessionId } : { message }),
      signal,
      cache: "no-store",
    });
  } catch (e) {
    if (signal?.aborted) return;
    void e;
    yield synthetic({ code: "network", message: FRIENDLY.network });
    return;
  }
  if (!res.ok || !res.body) {
    let body: { error?: { code?: string; message?: string } } = {};
    try {
      body = await res.json();
    } catch {
      /* not JSON */
    }
    const retry = Number(res.headers.get("Retry-After") || "") || undefined;
    if (res.status === 429) {
      yield synthetic({ code: "rate_limited", message: body.error?.message || "Too many questions. Please wait a moment.", retry_after_s: retry });
    } else if (res.status === 422 || res.status === 400) {
      yield synthetic({ code: "invalid_input", message: body.error?.message || "That question couldn't be read. Please rephrase it." });
    } else {
      yield synthetic({ code: "internal", message: FRIENDLY.internal });
    }
    return;
  }
  try {
    for await (const ev of readSSE(res.body, signal)) yield ev;
  } catch {
    if (signal?.aborted) return;
    yield synthetic({ code: "network", message: "The connection dropped before the answer finished. Please try again." });
  }
}

function synthetic(data: ErrorEvent): ChatEvent {
  return { event: "error", data };
}
