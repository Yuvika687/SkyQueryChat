// Table / CSV view of a backend chart spec, so every chart is also available as data.
import type { ChartSpec } from "./types";

export interface Table {
  columns: string[];
  rows: (string | number | null)[][];
}

const pretty = (s: string) => s.replace(/_/g, " ");

export function chartTable(spec: ChartSpec | null): Table {
  if (!spec) return { columns: [], rows: [] };
  const xLabel = spec.x.label && spec.x.label.length < 40 ? spec.x.label : pretty(spec.x.field);
  const yLabel = spec.y.label || `${pretty(spec.y.field)} (${spec.units})`;
  const objectSeries = spec.series.some((s) => s.data.some((p) => !Array.isArray(p)));
  if (objectSeries) {
    // e.g. Diwali AQI: [{x, aqi, category, bulletin_date, reporting_period}]
    const keys = new Set<string>();
    for (const s of spec.series) for (const p of s.data) if (!Array.isArray(p)) Object.keys(p).forEach((k) => keys.add(k));
    const ordered = [spec.x.field, spec.y.field, ...[...keys].filter((k) => k !== spec.x.field && k !== spec.y.field)];
    return {
      columns: ["series", ...ordered.map((k) => (k === spec.x.field ? xLabel : k === spec.y.field ? yLabel : pretty(k)))],
      rows: spec.series.flatMap((s) =>
        s.data.map((p) => {
          const o = (Array.isArray(p) ? {} : p) as Record<string, unknown>;
          return [s.name, ...ordered.map((k) => cell(o[k]))];
        }),
      ),
    };
  }
  if (spec.series.length === 1) {
    return { columns: [xLabel, yLabel], rows: spec.series[0].data.map((p) => (p as unknown[]).map(cell)) };
  }
  return {
    columns: ["series", xLabel, yLabel],
    rows: spec.series.flatMap((s) => s.data.map((p) => [s.name, ...(p as unknown[]).map(cell)])),
  };
}

function cell(v: unknown): string | number | null {
  if (v == null) return null;
  if (typeof v === "number" || typeof v === "string") return v;
  return JSON.stringify(v);
}

export function toCSV(t: Table): string {
  const esc = (v: string | number | null) => {
    if (v == null) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [t.columns, ...t.rows].map((r) => r.map(esc).join(",")).join("\n") + "\n";
}

export function download(filename: string, href: string) {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "chart";
}
