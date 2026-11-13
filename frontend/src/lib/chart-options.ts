// Backend chart spec -> ECharts option. Pure (testable). Rules from the UI spec:
// straight segments, gaps stay gaps, AQI and PM never share a chart, bars start at zero, units always shown,
// modelled data = dashed violet line, six fixed city colours.
import { CATEGORY_STYLE, CITY_COLOURS, REFERENCE_LINES, aqiCategory, normaliseCategory, pmCategory as pmCategoryOf } from "./categories";
import type { ChartPoint, ChartSpec, DataType } from "./types";
import { readable } from "./format";

const C = {
  text: "#E6EAF5", sub: "#94A0BC", line: "#2A3556", surface: "#121A2E", raised: "#1B2540",
  accent: "#2DD4BF", modelled: "#A78BFA", warning: "#F5B942",
};
const YEAR_COLOURS = ["#94A0BC", "#2DD4BF", "#60A5FA"];
const EVENT_COLOURS = ["#94A0BC", "#2DD4BF", "#60A5FA"]; // older year muted, latest year accent
const SEVERITY: Record<string, { colour: string; label: string }> = {
  none: { colour: "#2DD4BF", label: "No issues" },
  minor: { colour: "#5EEAD4", label: "Minor gaps" },
  moderate: { colour: "#F5B942", label: "Moderate gaps" },
  severe: { colour: "#F87171", label: "Severe gaps" },
};

export const isAQI = (spec: ChartSpec) => /index|aqi/i.test(spec.units) || /aqi/i.test(spec.y.field);
export const pollutantOf = (spec: ChartSpec): "pm25" | "pm10" | null =>
  /pm2\.?5/i.test(`${spec.title} ${spec.y.label ?? ""}`) ? "pm25" : /pm10/i.test(`${spec.title} ${spec.y.label ?? ""}`) ? "pm10" : null;

const NUM_FONT = "var(--font-inter), Inter, system-ui, sans-serif";
/** Show the zoom slider only when there are enough points to need it (about two months of days). */
export const ZOOM_MIN_POINTS = 62;
// Figures keep their calculated precision (PM to one decimal, so 73 shows as 73.0); AQI uses d = 0.
const fmt = (v: unknown, d = 1) => (typeof v === "number" ? v.toFixed(d) : v == null ? "no data" : String(v));

/** Time-axis labels always carry the month ("13 Oct", "1 Nov"); the year is added only at a year boundary. */
const TIME_LABELS = { year: "{d} {MMM} {yyyy}", month: "{d} {MMM}", day: "{d} {MMM}", hour: "{d} {MMM}", minute: "{d} {MMM}", second: "{d} {MMM}", millisecond: "{d} {MMM}", none: "{d} {MMM}" };

function base(spec: ChartSpec) {
  return {
    backgroundColor: "transparent",
    animationDuration: 200,
    textStyle: { fontFamily: "var(--font-inter), Inter, system-ui, sans-serif", color: C.text },
    grid: { left: 56, right: 24, top: 36, bottom: 56, containLabel: true },
    tooltip: {
      trigger: "axis" as const,
      backgroundColor: C.raised, borderColor: C.line, textStyle: { color: C.text, fontSize: 12 },
      confine: true,
    },
    legend: { show: spec.series.length > 1, top: 0, textStyle: { color: C.sub, fontSize: 12 }, icon: "roundRect" },
  };
}

const axisCommon = {
  axisLine: { lineStyle: { color: C.line } },
  axisLabel: { color: C.sub, fontSize: 12, hideOverlap: true },
  splitLine: { lineStyle: { color: C.line, opacity: 0.5 } },
  nameTextStyle: { color: C.sub, fontSize: 12 },
};

function yAxisName(spec: ChartSpec) {
  return spec.y.label || (isAQI(spec) ? "AQI (index)" : `${spec.y.field} (${spec.units})`);
}

export function buildOption(spec: ChartSpec, dataType: DataType | null = null): Record<string, unknown> {
  switch (spec.type) {
    case "bar":
      return barOption(spec);
    case "scatter":
      return scatterOption(spec);
    case "calendar_heatmap":
      return calendarOption(spec);
    default:
      return spec.series.some((s) => s.data.some((p) => !Array.isArray(p))) ? eventLineOption(spec) : lineOption(spec, dataType);
  }
}

// ------------------------------------------------------------------ gaps
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;

/**
 * The backend leaves out days (or months) without a valid value. Insert explicit nulls for the missing
 * calendar steps so the line breaks there instead of joining across the gap. Nothing is estimated.
 */
export function withGaps(data: ChartPoint[]): ChartPoint[] {
  const pts = data.filter(Array.isArray) as [string | number, number | null][];
  if (pts.length < 2 || pts.length !== data.length) return data;
  const keys = pts.map((p) => String(p[0]));
  const daily = keys.every((k) => DAY.test(k));
  const monthly = !daily && keys.every((k) => MONTH.test(k));
  if (!daily && !monthly) return data;
  const have = new Map(keys.map((k, i) => [k, pts[i][1]]));
  const out: ChartPoint[] = [];
  const sorted = [...keys].sort();
  if (daily) {
    const end = Date.parse(sorted[sorted.length - 1] + "T00:00:00Z");
    for (let t = Date.parse(sorted[0] + "T00:00:00Z"); t <= end; t += 86_400_000) {
      const k = new Date(t).toISOString().slice(0, 10);
      out.push([k, have.has(k) ? have.get(k)! : null]);
    }
  } else {
    let [y, m] = sorted[0].split("-").map(Number);
    const [ey, em] = sorted[sorted.length - 1].split("-").map(Number);
    while (y < ey || (y === ey && m <= em)) {
      const k = `${y}-${String(m).padStart(2, "0")}`;
      out.push([k, have.has(k) ? have.get(k)! : null]);
      m += 1;
      if (m > 12) { m = 1; y += 1; }
    }
  }
  return out;
}

// ------------------------------------------------------------------ time / category lines
function lineOption(spec: ChartSpec, dataType: DataType | null) {
  const time = spec.x.type === "time";
  const modelled = dataType === "modelled";
  const pol = pollutantOf(spec);
  const refs = time && pol && !isAQI(spec) ? REFERENCE_LINES[pol] : [];
  const series = spec.series.map((s, i) => {
    if (s.type === "markers") {
      return {
        name: s.name, type: "scatter", data: s.data, symbolSize: 9, z: 5,
        itemStyle: { color: C.warning, borderColor: C.surface, borderWidth: 1 },
      };
    }
    const colour = modelled ? C.modelled : CITY_COLOURS[s.name] ?? (i === 0 ? C.accent : /median|rolling/i.test(s.name) ? C.sub : YEAR_COLOURS[i % 3]);
    const isRef = /median|rolling/i.test(s.name);
    const single = spec.series.length === 1 && pol && !modelled;
    return {
      name: s.name, type: "line", smooth: false, connectNulls: false,
      data: single ? withGaps(s.data).map((p) => {
        const v = Array.isArray(p) ? (p[1] as number | null) : null;
        const cat = v == null ? null : pmCategoryOf(v, pol!);
        return { value: p, itemStyle: cat ? { color: CATEGORY_STYLE[cat].bg, borderColor: "#0E1729", borderWidth: 1 } : undefined };
      }) : withGaps(s.data),
      ...(single && time ? { markPoint: { symbol: "pin", symbolSize: 34, label: { color: "#06140B", fontSize: 10, fontWeight: 600, formatter: (q: { value: number }) => q.value.toFixed(1) },
        itemStyle: { color: C.text }, data: [{ type: "max", name: "Highest" }] } } : {}),
      // small symbols on dense series so a single day between two gaps is still visible
      showSymbol: true, symbolSize: s.data.length <= 2 ? 10 : s.data.length <= 40 ? 5 : 2,
      lineStyle: { width: isRef ? 1.5 : 2, color: colour, type: modelled || isRef ? "dashed" : "solid" },
      itemStyle: { color: colour },
      ...(i === 0 && refs.length
        ? {
            markLine: {
              silent: true, symbol: "none",
              lineStyle: { type: "dashed", width: 1, color: C.sub, opacity: 0.8 },
              // labels sit to the right of the plot area, never on top of the data
              label: { color: C.sub, fontSize: 11, formatter: "{b} {c}", position: "end", distance: 6 },
              data: refs.map((r) => ({ name: r.short, yAxis: r.value })),
            },
          }
        : {}),
    };
  });
  const points = Math.max(0, ...spec.series.map((s) => withGaps(s.data).length));
  const zoom = time && points > ZOOM_MIN_POINTS;
  return {
    ...base(spec),
    grid: { ...base(spec).grid, right: refs.length ? 72 : 24, bottom: zoom ? 56 : 24 },
    xAxis: { type: time ? "time" : "category", name: "", ...axisCommon, splitLine: { show: false },
      ...(time ? { axisLabel: { ...axisCommon.axisLabel, formatter: TIME_LABELS } } : {}) },
    yAxis: { type: "value", name: yAxisName(spec), nameLocation: "middle", nameGap: 44, min: 0, ...axisCommon },
    dataZoom: zoom ? [{ type: "inside" }, { type: "slider", height: 18, bottom: 8, borderColor: C.line, textStyle: { color: C.sub } }] : [],
    tooltip: { ...base(spec).tooltip, valueFormatter: (v: unknown) => `${fmt(v, isAQI(spec) ? 0 : 1)} ${spec.units}` },
    series,
  };
}

// ------------------------------------------------------------------ Diwali-style event lines (object points)
function eventLineOption(spec: ChartSpec) {
  const bands = dedupeBands(spec.bands ?? []);
  const aqi = isAQI(spec);
  const dateOf = spec.series.length === 1
    ? new Map((spec.series[0].data as Record<string, unknown>[]).filter((o) => o.bulletin_date)
        .map((o) => [Number(o[spec.x.field]), shortDate(String(o.bulletin_date))]))
    : null;
  // One colour per line; each point is coloured by its CPCB category (also named in the tooltip and table).
  // The festival bulletins carry their value as a label.
  const inBand = (x: unknown) => bands.some((b) => Number(x) >= Number(b.start) && Number(x) <= Number(b.end));
  const series = spec.series.map((s, i) => {
    const colour = spec.series.length === 1 ? "#8FA6D6" : EVENT_COLOURS[i % EVENT_COLOURS.length];
    return {
      name: s.name, type: "line", smooth: false, connectNulls: false, showSymbol: true, symbol: "circle", symbolSize: 7,
      lineStyle: { width: 2, color: colour }, itemStyle: { color: colour },
      data: s.data.map((p) => {
        const o = p as Record<string, unknown>;
        const v = (o[spec.y.field] as number | null) ?? null;
        const cat = normaliseCategory(o.category) ?? (aqi ? aqiCategory(v) : null);
        return {
          value: [o[spec.x.field], v], raw: o,
          itemStyle: { color: cat ? CATEGORY_STYLE[cat].bg : colour, borderColor: "#0E1729", borderWidth: 1.5 },
          label: v != null && inBand(o[spec.x.field])
            ? { show: true, position: "top", color: C.text, fontWeight: 600, fontSize: 12, formatter: () => String(aqi ? Math.round(v) : v) }
            : undefined,
        };
      }),
      ...(i === 0
        ? {
            markArea: bands.length
              ? { silent: true, itemStyle: { color: "rgba(45, 212, 191, 0.12)" }, label: { show: false },
                  data: bands.map((b) => [{ xAxis: b.start }, { xAxis: b.end }]) }
              : undefined,
            // Diwali day: a clear vertical line, labelled above the plot area (outside the data)
            markLine: {
              silent: true, symbol: "none",
              lineStyle: { type: "solid", width: 1.5, color: C.text, opacity: 0.7 },
              label: { show: true, position: "end", color: C.text, fontSize: 11, fontWeight: 600, formatter: "Diwali", distance: 4 },
              data: [{ xAxis: 0 }],
            },
          }
        : {}),
    };
  });
  return {
    ...base(spec),
    legend: { ...base(spec).legend, top: 0, right: 8, left: "auto" },
    grid: { ...base(spec).grid, top: 40, bottom: 40 },
    xAxis: {
      type: "value", name: dateOf ? "Bulletin date" : "Bulletin day (D = Diwali)", nameLocation: "middle", nameGap: 30, ...axisCommon,
      min: "dataMin", max: "dataMax",
      // one year: real bulletin dates ("9 Nov"); several years: days from Diwali
      axisLabel: { ...axisCommon.axisLabel, formatter: (v: number) => (dateOf?.get(v) ?? (v === 0 ? "D" : v > 0 ? `D+${v}` : `D−${-v}`)) },
      splitLine: { show: false }, minInterval: 1,
    },
    yAxis: { type: "value", name: yAxisName(spec), nameLocation: "middle", nameGap: 44, min: 0, ...axisCommon },
    tooltip: {
      ...base(spec).tooltip, trigger: "item",
      formatter: (p: { seriesName: string; data: { value: [number, number | null]; raw: Record<string, unknown> } }) => {
        const r = p.data.raw;
        const v = p.data.value[1];
        const cat = normaliseCategory(r.category) ?? (aqi ? aqiCategory(v) : null);
        const lines = [`<b>${p.seriesName}</b>`, `${aqi ? "AQI" : spec.y.label}: <b>${aqi && typeof v === "number" ? Math.round(v) : fmt(v, 0)}</b>${cat ? ` (${CATEGORY_STYLE[cat].label})` : ""}`];
        if (r.bulletin_date) lines.push(`Bulletin date: ${readable(String(r.bulletin_date))}`);
        if (r.reporting_period) lines.push(`Period: ${readable(String(r.reporting_period))}`);
        return lines.join("<br/>");
      },
    },
    series,
  };
}

function shortDate(iso: string): string {
  return readable(iso).replace(/ \d{4}$/, "");
}

function dedupeBands(bands: NonNullable<ChartSpec["bands"]>) {
  const seen = new Map<string, { label: string; start: number | string; end: number | string }>();
  for (const b of bands) {
    const k = `${b.start}|${b.end}`;
    const prev = seen.get(k);
    seen.set(k, prev ? { ...prev, label: "Festival bulletins (D+1, D+2)" } : { ...b, label: shortBand(b.label) });
  }
  return [...seen.values()];
}
const shortBand = (l: string) => l.replace(/\s*\(.*\)$/, "");

// ------------------------------------------------------------------ ranking bars (zero baseline)
function barOption(spec: ChartSpec) {
  const data = [...(spec.series[0]?.data ?? [])] as [string, number | null][];
  data.sort((a, b) => (a[1] ?? -1) - (b[1] ?? -1)); // ECharts draws category 0 at the bottom -> highest on top
  return {
    ...base(spec),
    legend: { show: false },
    grid: { left: 16, right: 56, top: 16, bottom: 40, containLabel: true },
    xAxis: { type: "value", min: 0, name: yAxisName(spec), nameLocation: "middle", nameGap: 28, ...axisCommon },
    yAxis: { type: "category", data: data.map((d) => d[0]), ...axisCommon, splitLine: { show: false } },
    tooltip: { ...base(spec).tooltip, axisPointer: { type: "shadow" }, valueFormatter: (v: unknown) => `${fmt(v, isAQI(spec) ? 0 : 1)} ${spec.units}` },
    series: [
      {
        name: spec.series[0]?.name, type: "bar", barMaxWidth: 22,
        data: data.map(([c, v]) => ({ value: v, itemStyle: { color: CITY_COLOURS[c] ?? C.accent, borderRadius: [0, 4, 4, 0] } })),
        label: { show: true, position: "right", color: C.text, fontFamily: NUM_FONT, fontSize: 12, formatter: (p: { value: number | null }) => (p.value == null ? "no data" : `${fmt(p.value)}`) },
      },
    ],
  };
}

// ------------------------------------------------------------------ weather scatter
function scatterOption(spec: ChartSpec) {
  const fitted = spec.series.some((s) => s.type === "line");
  return {
    ...base(spec),
    grid: { ...base(spec).grid, right: fitted ? 84 : 24 },
    legend: { show: false },
    xAxis: { type: "value", name: spec.x.label ?? spec.x.field, nameLocation: "middle", nameGap: 30, ...axisCommon },
    yAxis: { type: "value", name: yAxisName(spec), nameLocation: "middle", nameGap: 44, min: 0, ...axisCommon },
    tooltip: {
      ...base(spec).tooltip, trigger: "item",
      formatter: (p: { value: [number, number] }) => `${spec.x.label ?? spec.x.field}: ${fmt(p.value[0], 2)}<br/>${yAxisName(spec)}: <b>${fmt(p.value[1])}</b>`,
    },
    // days as dots; a fitted line (calculated in Python, Theil-Sen) when the backend sends one
    series: spec.series.map((s) => s.type === "line"
      ? { name: s.name, type: "line", data: s.data, showSymbol: false, silent: true, z: 4,
          lineStyle: { color: C.text, width: 2, type: "dashed" },
          endLabel: { show: true, formatter: "fitted line", color: C.sub, fontSize: 11 } }
      : { name: s.name, type: "scatter", data: s.data, symbolSize: 6, itemStyle: { color: C.accent, opacity: 0.6 } }),
  };
}

// ------------------------------------------------------------------ calendar heatmap (quality or AQI)
function calendarOption(spec: ChartSpec) {
  const data = (spec.series[0]?.data ?? []) as unknown[][];
  const dates = data.map((d) => String(d[0])).sort();
  const range = dates.length ? [dates[0], dates[dates.length - 1]] : ["2025-01-01", "2025-12-31"];
  const aqi = spec.colour_scale === "cpcb_aqi";
  const cats = aqi ? (["Good", "Satisfactory", "Moderate", "Poor", "Very poor", "Severe"] as const) : null;
  const sevKeys = Object.keys(SEVERITY);
  const values = data.map((d) => (aqi ? [d[0], d[1]] : [d[0], sevKeys.indexOf(String(d[1]))]));
  const pieces = aqi
    ? [[0, 50], [51, 100], [101, 200], [201, 300], [301, 400], [401, 500]].map(([min, max], i) => ({ min, max, label: CATEGORY_STYLE[cats![i]].label, color: CATEGORY_STYLE[cats![i]].bg }))
    : sevKeys.map((k, i) => ({ value: i, label: SEVERITY[k].label, color: SEVERITY[k].colour }));
  return {
    ...base(spec),
    legend: { show: false },
    tooltip: {
      trigger: "item", backgroundColor: C.raised, borderColor: C.line, textStyle: { color: C.text, fontSize: 12 },
      formatter: (p: { value: [string, number] }) => `${p.value[0]}: <b>${aqi ? `AQI ${p.value[1]}` : SEVERITY[sevKeys[p.value[1]]]?.label ?? "no data"}</b>`,
    },
    visualMap: {
      type: "piecewise", orient: "horizontal", left: "center", bottom: 0, pieces,
      textStyle: { color: C.sub, fontSize: 11 }, itemWidth: 12, itemHeight: 12,
    },
    calendar: {
      range, top: 36, left: 40, right: 16, cellSize: ["auto", 14],
      itemStyle: { color: "#64748B", borderColor: C.surface, borderWidth: 2 }, // grey = missing day
      splitLine: { lineStyle: { color: C.line } },
      dayLabel: { color: C.sub, fontSize: 10, firstDay: 1 }, monthLabel: { color: C.sub, fontSize: 11 }, yearLabel: { show: false },
    },
    series: [{ type: "heatmap", coordinateSystem: "calendar", data: values }],
  };
}

/** Plain-language key for event charts, shown above the chart (outside the data area). */
export function eventKey(spec: ChartSpec): string | null {
  if (!spec.series.some((s) => s.data.some((p) => !Array.isArray(p)))) return null;
  const bands = spec.bands ?? [];
  const base = "Vertical line: Diwali (D).";
  return bands.length ? `${base} Shaded: festival bulletins D+1 and D+2, which report Diwali night.` : base;
}
