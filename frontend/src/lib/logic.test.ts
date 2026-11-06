import { describe, expect, it } from "vitest";
import { aqiCategory, normaliseCategory, pmCategory } from "./categories";
import { chartTable, toCSV } from "./chart-data";
import { buildOption, withGaps } from "./chart-options";
import { applyEvent, newTurn } from "./chat-state";
import { evidenceFor } from "./evidence";
import { followUps } from "./followups";
import { buildTimeline } from "./timeline";
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

  it("shows a verification retry as a warning", () => {
    const t = turnFrom("diwali-cached.sse");
    expect(buildTimeline(t.steps, "done").find((s) => s.key === "verify")?.status).toBe("warning");
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
    expect(o.series.some((s) => s.markLine)).toBe(false);
    expect(o.series[0].markArea).toBeTruthy(); // festival band
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
    expect(ev.period).toBe("1 Oct 2026 – 30 Oct 2026");
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
});
