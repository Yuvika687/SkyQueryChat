// Turns the backend's technical step events into the seven plain-language steps from the UI spec.
// Shows input/result summaries and durations only: never prompts, keys or raw model output.
import type { Phase } from "./chat-state";
import type { StepEvent } from "./types";

export type StepStatus = "waiting" | "running" | "done" | "warning" | "failed" | "skipped";
export type StepKey = "understand" | "resolve" | "load" | "calc" | "weather" | "verify" | "prepare";

export interface TimelineStep {
  key: StepKey;
  label: string;
  status: StepStatus;
  input?: string;
  result?: string;
  note?: string;
  durationMs?: number;
}

const LABELS: Record<StepKey, string> = {
  understand: "Understanding the question",
  resolve: "Finding cities and dates",
  load: "Loading station data",
  calc: "Running the calculation",
  weather: "Adding weather context",
  verify: "Checking every number",
  prepare: "Preparing the answer",
};
export const CORRECTED = "Corrected a number before answering";
const ORDER: StepKey[] = ["understand", "resolve", "load", "calc", "weather", "verify", "prepare"];

const TOOL_NAMES: Record<string, string> = {
  city_trend: "trend",
  compare_cities: "city comparison",
  diwali_aqi: "Diwali official AQI",
  delhi_pm_diwali: "Delhi Diwali PM context",
  unusual_days: "unusual-day check",
  weather_association: "weather relationship",
  data_coverage: "data coverage",
  check_request: "request check",
};

const POLLUTANT: Record<string, string> = { pm25: "PM2.5", "pm2.5": "PM2.5", pm10: "PM10" };

export function summariseArgs(args: Record<string, unknown> | undefined): string {
  if (!args) return "";
  const parts: string[] = [];
  const cities = (args.cities as string[] | undefined) ?? (args.city ? [args.city as string] : []);
  if (cities.length) parts.push(cities.length === 6 ? "all six cities" : cities.join(", "));
  if (args.pollutant) parts.push(POLLUTANT[String(args.pollutant).toLowerCase()] ?? String(args.pollutant));
  if (args.weather) parts.push(String(args.weather));
  if (args.period) parts.push(String(args.period));
  if (args.event) parts.push(String(args.event));
  if (Array.isArray(args.years)) parts.push((args.years as number[]).join(" and "));
  return parts.join(" · ");
}

const ms = (a?: string, b?: string) => (a && b ? Math.max(0, Date.parse(b) - Date.parse(a)) : undefined);

export function buildTimeline(events: StepEvent[], phase: Phase): TimelineStep[] {
  const s: Record<StepKey, TimelineStep & { t0?: string; t1?: string }> = Object.fromEntries(
    ORDER.map((k) => [k, { key: k, label: LABELS[k], status: "waiting" as StepStatus }]),
  ) as never;
  let weatherUsed = false;
  let corrected = false;
  let prevTs: string | undefined;

  const start = (k: StepKey, ts?: string) => {
    if (s[k].status === "waiting") s[k].status = "running";
    s[k].t0 ??= ts ?? prevTs;
  };
  const finish = (k: StepKey, ts?: string, status: StepStatus = "done") => {
    s[k].t0 ??= prevTs ?? ts;
    if (s[k].status !== "warning" || status === "failed") s[k].status = status;
    s[k].t1 = ts;
  };
  const finishBefore = (k: StepKey, ts?: string) => {
    for (const o of ORDER) {
      if (o === k) break;
      if (o === "weather") continue;
      if (s[o].status === "waiting" || s[o].status === "running") finish(o, ts);
    }
  };

  for (const e of events) {
    const ts = e.ts;
    const d = e.detail ?? {};
    switch (e.type) {
      case "run_started":
        start("understand", ts);
        break;
      case "queued":
        start("understand", ts);
        s.understand.note = "Waiting for shared AI capacity.";
        break;
      case "model_request":
        start("understand", ts);
        break;
      case "plan": {
        finish("understand", ts);
        // The agent's plan in plain language (its own sentence, or code's description of its tool choices)
        if (typeof d.summary === "string" && d.summary) s.understand.result = d.summary;
        const steps = (d.steps as { tool: string; args: Record<string, unknown> }[] | undefined) ?? [];
        s.resolve.input = steps.map((x) => summariseArgs(x.args)).filter(Boolean).join("; ") || undefined;
        start("resolve", ts);
        break;
      }
      case "tool_call": {
        const args = d.args as Record<string, unknown> | undefined;
        if (e.title === "check_request") {
          finishBefore("resolve", ts);
          start("resolve", ts);
          s.resolve.input ??= summariseArgs(args);
          break;
        }
        finishBefore("load", ts);
        start("load", ts);
        const sum = summariseArgs(args);
        s.load.input = [s.load.input, `${TOOL_NAMES[e.title] ?? e.title}${sum ? ": " + sum : ""}`].filter(Boolean).join("; ");
        if (e.title === "weather_association") {
          weatherUsed = true;
          start("weather", ts);
          s.weather.input = sum;
        }
        break;
      }
      case "tool_result": {
        if (e.title === "check_request") {
          const bad = (d.unsupported as string[] | undefined) ?? [];
          finish("resolve", ts, bad.length ? "warning" : "done");
          if (bad.length) s.resolve.note = `Not supported: ${bad.join(", ")}.`;
          break;
        }
        finishBefore("load", ts);
        finish("load", ts);
        const title = e.title.includes(": ") ? e.title.split(": ").slice(1).join(": ") : e.title;
        s.calc.t0 ??= prevTs ?? ts;
        finish("calc", ts);
        s.calc.result = [s.calc.result, title].filter(Boolean).join("; ");
        s.load.result = `${d.data_type === "official_aqi" ? "Official AQI" : d.data_type === "modelled" ? "Modelled" : d.data_type === "mixed" ? "Measured PM and modelled weather" : "Measured"} data loaded`;
        if (e.title.startsWith("weather_association")) finish("weather", ts);
        break;
      }
      case "tool_error":
        finish("load", ts, "warning");
        s.load.note = "One data request failed; the agent tried another way.";
        break;
      case "verification": {
        finishBefore("verify", ts);
        start("verify", ts);
        const n = d.checked_numbers as number | undefined;
        if (e.title === "passed" && d.answer_source === "code_fallback") {
          // last resort: the model's corrections kept failing, so the summary was written from the results
          finish("verify", ts, "warning");
          s.verify.result = "Summary written directly from the verified results";
          s.verify.note = "The AI's wording didn't pass the number check, so a plain summary is shown.";
          start("prepare", ts);
        } else if (e.title === "passed") {
          // A corrected number is the check working as designed: done, with a calm note (not a warning).
          finish("verify", ts, "done");
          s.verify.result = `${n ?? 0} number${n === 1 ? "" : "s"} matched the calculations`;
          if (corrected) s.verify.note = CORRECTED;
          start("prepare", ts);
        } else {
          corrected = true;
          s.verify.note = "Correcting a number that didn't match the calculations.";
        }
        break;
      }
      case "retry":
        start("verify", ts);
        corrected = true;
        s.verify.note = "Correcting a number that didn't match the calculations.";
        break;
      case "fallback": {
        const running = ORDER.find((k) => s[k].status === "running") ?? "understand";
        s[running].note = "The main AI model was busy, so a backup model took over.";
        break;
      }
      case "answer":
        finishBefore("prepare", ts);
        finish("prepare", ts);
        break;
      case "error": {
        const running = ORDER.find((k) => s[k].status === "running") ?? ORDER.find((k) => s[k].status === "waiting") ?? "prepare";
        finish(running, ts, "failed");
        break;
      }
    }
    prevTs = ts ?? prevTs;
  }

  const finished = phase === "done";
  if (finished) {
    for (const k of ORDER) {
      if (k === "weather" && !weatherUsed) s.weather.status = "skipped";
      else if (s[k].status === "running" || s[k].status === "waiting") s[k].status = k === "prepare" ? "done" : s[k].status === "waiting" ? "skipped" : "done";
    }
  } else if (phase === "error" || phase === "stopped") {
    for (const k of ORDER) {
      if (s[k].status === "running") s[k].status = phase === "stopped" ? "skipped" : "failed";
      if (k === "weather" && !weatherUsed && s[k].status === "waiting") s[k].status = "skipped";
    }
  } else if (!ORDER.some((k) => s[k].status === "running")) {
    // still streaming: show the next expected step as running
    const next = ORDER.find((k) => s[k].status === "waiting" && (k !== "weather" || weatherUsed));
    if (next) s[next].status = "running";
  }
  if (!weatherUsed && s.weather.status === "waiting" && phase === "streaming") s.weather.note = "Used only for weather questions.";

  return ORDER.map((k) => {
    const { t0, t1, ...rest } = s[k];
    return { ...rest, durationMs: rest.status === "done" || rest.status === "warning" || rest.status === "failed" ? ms(t0, t1) : undefined };
  });
}

/** Durations under a second are noise for most readers: hidden in the row, kept in the step details. */
export const SMALL_MS = 1000;

export interface TimelineSummary {
  steps: number; // steps that ran (not skipped)
  failed: boolean;
  corrected: boolean;
  warning: boolean;
  note: string | null;
}

export function summarise(steps: TimelineStep[]): TimelineSummary {
  const ran = steps.filter((s) => s.status !== "skipped" && s.status !== "waiting");
  const failed = steps.some((s) => s.status === "failed");
  const corrected = steps.some((s) => s.note === CORRECTED);
  const warn = steps.find((s) => s.status === "warning");
  return { steps: ran.length, failed, corrected, warning: !!warn, note: failed ? null : warn?.note ?? (corrected ? CORRECTED : null) };
}
