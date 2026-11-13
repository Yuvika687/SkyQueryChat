import { describe, expect, it } from "vitest";
import { aqiCategory, normaliseCategory, pmCategory } from "./categories";
import { chartTable, toCSV } from "./chart-data";
import { buildOption, withGaps } from "./chart-options";
import { applyEvent, newTurn } from "./chat-state";
import { evidenceFor } from "./evidence";
import { followUps } from "./followups";
import { keyNumbers } from "./key-numbers";
import { buildTimeline, summarise } from "./timeline";
import { fixtureEvents } from "@/test/fixtures";
import type { ChartSpec, StepEvent } from "./types";

const turnFrom = (name: string, q = "q") => fixtureEvents(name).reduce(applyEvent, newTurn(q));

describe("categories (round first, then assign)", () => {
  it("uses the spec breakpoints", () => {
    expect(pmCategory(30.4, "pm25")).toBe("Good");
    expect(pmCategory(30.5, "pm25")).toBe("Satisfactory");
    expect(pmCategory(250, "pm25")).toBe("Very poor");
    expect(pmCategory(251, "pm25")).toBe("Severe");
    expect(pmCategory(100, "pm10")).toBe("Satisfactory");
    expect(pmCategory(431, "pm10")).toBe("Severe");
    expect(pmCategory(null, "pm10")).toBeNull();
    expect(aqiCategory(352)).toBe("Very poor");
    expect(normaliseCategory("Very Poor")).toBe("Very poor");
    expect(normaliseCategory("Moderately Polluted")).toBe("Moderate");
  });
});

describe("timeline", () => {
  it("maps a live run to the seven plain-language steps", () => {
    const t = turnFrom("compare-live.sse");
    const steps = buildTimeline(t.steps, "done");
    expect(steps.map((s) => s.label)).toEqual([
      "Understanding the question", "Finding cities and dates", "Loading station data", "Running the calculation",
      "Adding weather context", "Checking every number", "Preparing the answer",
    ]);
    expect(steps.find((s) => s.key === "weather")?.status).toBe("skipped");
    expect(steps.filter((s) => s.key !== "weather").every((s) => s.status === "done" || s.status === "warning")).toBe(true);
    expect(steps.find((s) => s.key === "load")?.input).toMatch(/Delhi, Mumbai/);
  });

  it("shows a successful correction as done with a calm note, not a warning", () => {
    const t = turnFrom("diwali-cached.sse");
    const steps = buildTimeline(t.steps, "done");
    const v = steps.find((s) => s.key === "verify")!;
    expect(v.status).toBe("done");
    expect(v.note).toBe("Corrected a number before answering");
    expect(summarise(steps)).toMatchObject({ corrected: true, failed: false, warning: false });
  });

  it("shows the agent's plan in plain language and flags a last-resort code summary", () => {
    const ts = (n: number) => `2026-11-12T10:00:0${n}.000Z`;
    const ev: StepEvent[] = [
      { seq: 1, type: "run_started", title: "question received", detail: {}, ts: ts(0) },
      { seq: 2, type: "plan", title: "I'll compare Delhi and Mumbai over the last 30 days.", detail: { summary: "I'll compare Delhi and Mumbai over the last 30 days.", source: "llm", steps: [] }, ts: ts(1) },
      { seq: 3, type: "verification", title: "failed", detail: { problems: 1 }, ts: ts(2) },
      { seq: 4, type: "verification", title: "passed", detail: { answer_source: "code_fallback" }, ts: ts(3) },
      { seq: 5, type: "answer", title: "answered", detail: {}, ts: ts(4) },
    ];
    const steps = buildTimeline(ev, "done");
    expect(steps.find((s) => s.key === "understand")?.result).toBe("I'll compare Delhi and Mumbai over the last 30 days.");
    const v = steps.find((s) => s.key === "verify")!;
    expect(v.status).toBe("warning");
    expect(v.result).toMatch(/written directly from the verified results/);
  });

  it("keeps a real verification failure visible", () => {
    const ev: StepEvent[] = [
      { seq: 1, type: "run_started", title: "question received", detail: {}, ts: "2026-11-06T10:00:00.000Z" },
      { seq: 2, type: "verification", title: "failed", detail: { problems: 1 }, ts: "2026-11-06T10:00:01.000Z" },
      { seq: 3, type: "error", title: "verification", detail: {}, ts: "2026-11-06T10:00:02.000Z" },
    ];
    const steps = buildTimeline(ev, "error");
    expect(steps.find((s) => s.key === "verify")?.status).toBe("failed");
    expect(summarise(steps).failed).toBe(true);
  });

  it("shows the next step as running while streaming, and failure on error", () => {
    const ev: StepEvent[] = [
      { seq: 1, type: "run_started", title: "question received", detail: {}, ts: "2026-11-06T10:00:00.000Z" },
      { seq: 2, type: "model_request", title: "asking the model", detail: {}, ts: "2026-11-06T10:00:00.100Z" },
    ];
    expect(buildTimeline(ev, "streaming").find((s) => s.status === "running")?.key).toBe("understand");
    const failed = buildTimeline([...ev, { seq: 3, type: "error", title: "x", detail: {}, ts: "2026-11-06T10:00:01.000Z" }], "error");
    expect(failed.find((s) => s.key === "understand")?.status).toBe("failed");
  });

  it("never exposes prompts: details are only argument summaries", () => {
    const t = turnFrom("compare-live.sse");
    const text = JSON.stringify(buildTimeline(t.steps, "done"));
    expect(text).not.toMatch(/system|prompt|api[_-]?key/i);
  });
});

describe("charts", () => {
  const trend: ChartSpec = {
    type: "line", title: "Kolkata PM2.5 (daily mean)", x: { field: "period", type: "time" }, y: { field: "mean", label: "PM2.5 (µg/m³)" },
    series: [{ name: "Kolkata", data: [["2026-10-21", 40], ["2026-10-22", 41], ["2026-10-25", 50]] }], units: "µg/m³",
  };

  it("inserts nulls for missing days so lines break (no values invented)", () => {
    expect(withGaps(trend.series[0].data)).toEqual([["2026-10-21", 40], ["2026-10-22", 41], ["2026-10-23", null], ["2026-10-24", null], ["2026-10-25", 50]]);
    expect(withGaps([["2025-10", 1], ["2025-12", 2]])).toEqual([["2025-10", 1], ["2025-11", null], ["2025-12", 2]]);
  });

  it("uses straight lines, no null-joining, units and reference lines for daily PM", () => {
    const o = buildOption(trend) as { series: { smooth: boolean; connectNulls: boolean; markLine?: { data: { yAxis: number }[] } }[]; yAxis: { name: string } };
    expect(o.series[0].smooth).toBe(false);
    expect(o.series[0].connectNulls).toBe(false);
    expect(o.yAxis.name).toContain("µg/m³");
    expect(o.series[0].markLine?.data.map((d) => d.yAxis)).toEqual([15, 60]);
  });

  it("draws modelled data as a dashed violet line", () => {
    const o = buildOption(trend, "modelled") as { series: { lineStyle: { type: string; color: string } }[] };
    expect(o.series[0].lineStyle).toMatchObject({ type: "dashed", color: "#A78BFA" });
  });

  it("starts bars at zero and sorts them", () => {
    const t = turnFrom("compare-live.sse");
    const o = buildOption(t.chart!) as { xAxis: { min: number }; yAxis: { data: string[] } };
    expect(o.xAxis.min).toBe(0);
    expect(o.yAxis.data.at(-1)).toBe("Delhi"); // highest drawn on top
  });

  it("keeps AQI on its own axis without PM reference lines", () => {
    const t = turnFrom("diwali-cached.sse");
    const o = buildOption(t.chart!) as { yAxis: { name: string }; series: { markLine?: unknown; markArea?: unknown }[] };
    expect(o.yAxis.name).toMatch(/AQI/);
    // the only line marker is Diwali day (x = 0); no PM reference lines on an AQI chart
    const ml = o.series[0].markLine as { data: { xAxis?: number; yAxis?: number }[]; label: { position: string } };
    expect(ml.data).toEqual([{ xAxis: 0 }]);
    expect(ml.label.position).toBe("end"); // label above the plot, outside the data
    expect(o.series.slice(1).some((s) => s.markLine)).toBe(false);
    expect(o.series[0].markArea).toBeTruthy(); // festival band
  });

  it("colours Diwali points by CPCB category and labels the festival bulletins", () => {
    const t = turnFrom("diwali-cached.sse");
    const o = buildOption(t.chart!) as { series: { data: { itemStyle?: { color: string }; label?: { show: boolean }; raw: Record<string, unknown> }[] }[] };
    const pts = o.series[0].data.filter((p) => typeof p.raw.aqi === "number");
    expect(pts.every((p) => typeof p.itemStyle?.color === "string")).toBe(true);
    const veryPoor = pts.find((p) => /very poor/i.test(String(p.raw.category)));
    if (veryPoor) expect(veryPoor.itemStyle!.color).toBe("#EF4444");
    expect(o.series[0].data.filter((p) => p.label?.show).length).toBeGreaterThanOrEqual(1);
  });

  it("puts reference-line labels outside the plot and zooms only long ranges", () => {
    const days = Array.from({ length: 30 }, (_, i) => [`2026-10-${String(i + 1).padStart(2, "0")}`, 40 + i] as [string, number]);
    const spec: ChartSpec = { type: "line", title: "Kolkata PM2.5 (daily mean)", x: { field: "date", type: "time" }, y: { field: "mean", label: "PM2.5 (µg/m³)" }, series: [{ name: "Kolkata", data: days }], units: "µg/m³" };
    const o = buildOption(spec) as { dataZoom: unknown[]; grid: { right: number }; series: { markLine: { label: { position: string } } }[] };
    expect(o.series[0].markLine.label.position).toBe("end");
    expect(o.grid.right).toBeGreaterThanOrEqual(64);
    expect(o.dataZoom).toEqual([]);
    const long = { ...spec, series: [{ name: "Kolkata", data: Array.from({ length: 120 }, (_, i) => [new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10), 50] as [string, number]) }] };
    expect((buildOption(long) as { dataZoom: unknown[] }).dataZoom.length).toBe(2);
  });

  it("offers every chart as a table and CSV", () => {
    const t = turnFrom("diwali-cached.sse");
    const tab = chartTable(t.chart);
    expect(tab.columns).toContain("bulletin date");
    expect(tab.rows.length).toBeGreaterThan(5);
    expect(toCSV(tab).split("\n")[0]).toMatch(/^series,/);
  });
});

describe("evidence and follow-ups", () => {
  it("summarises data type, period, stations, coverage and source", () => {
    const ev = evidenceFor(turnFrom("compare-live.sse"));
    expect(ev.dataType).toBe("Measured");
    expect(ev.period).toBe("Latest 30 days available · 1–30 Oct 2026"); // data ends before today
    expect(ev.stations).toMatch(/stations/);
    expect(ev.coverageText).toMatch(/% coverage/);
    expect(ev.source).toMatch(/OpenAQ/);
  });

  it("flags low coverage", () => {
    const t = turnFrom("compare-live.sse");
    const ds = t.sources!.sources[0].dataset_id;
    const low = { ...t, sources: { ...t.sources!, coverage: { [ds]: { days_in_period: 30, common_days: 12 } } } };
    expect(evidenceFor(low).lowCoverage).toBe(true);
  });

  it("suggests at most three follow-ups using only the resolved city and pollutant", () => {
    const f = followUps(turnFrom("compare-live.sse", "Compare Delhi and Mumbai over the last 30 days"));
    expect(f.length).toBeLessThanOrEqual(3);
    expect(f.join(" ")).toMatch(/Delhi/);
  });

  it("prefers the model's own follow-ups and uses templates only when it gives none", () => {
    const t = turnFrom("compare-live.sse", "Compare Delhi and Mumbai over the last 30 days");
    const own = { ...t, answer: { ...t.answer!, follow_ups: ["Which days were worst in Delhi?", "compare delhi and mumbai over the last 30 days", "Is wind linked to PM2.5 in Mumbai?"] } };
    expect(followUps(own)).toEqual(["Which days were worst in Delhi?", "Is wind linked to PM2.5 in Mumbai?"]);
    const none = { ...t, answer: { ...t.answer!, follow_ups: [] } };
    expect(followUps(none)).toEqual(followUps(t));
  });
});

describe("key numbers", () => {
  it("drops rank cards and uses short labels", () => {
    const t = turnFrom("compare-live.sse");
    const k = keyNumbers(t.cards);
    expect(k.map((x) => x.label)).toEqual(["Delhi", "Mumbai"]);
    expect(k.map((x) => x.value)).toEqual(["73.0", "43.7"]);
    expect(k.every((x) => x.unit === "µg/m³")).toBe(true);
  });

  it("shows bulletin AQI whole and a mean of bulletins with its decimal, matching the headline", () => {
    const t = turnFrom("diwali-cached.sse");
    const [d] = keyNumbers(t.cards);
    expect(d).toMatchObject({ label: "Diwali 2025", value: "352", unit: "AQI", category: "Very poor", exact: 352 });
    const half = keyNumbers([{ ...t.cards[0], value: 188.5 }])[0];
    expect(half.value).toBe("188.5");                     // (a + b) / 2: not rounded into a different number
    expect(half.exact).toBe(188.5);
  });
});
