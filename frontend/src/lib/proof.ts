// Which numbers in an answer are clickable, and what each one's proof shows. Pure and testable.
// A number in the text is a target only when it equals (at the precision written) a value the backend returned:
// one of the answer's cards, or a point in its chart. Dates, years and labels such as PM2.5 are never targets.
// The proof only presents rows the backend sent; the one sum it shows (a mean of festival bulletins) is written
// out so a reader can check it, and the value itself is always the backend's.
import { aqiCategory, pmCategory, type Category } from "./categories";
import type { Turn } from "./chat-state";
import { evidenceFor } from "./evidence";
import { fmtDate, readable } from "./format";
import { fmtNumber, isAqiCard } from "./key-numbers";
import type { Card, ChartSpec } from "./types";

export type Scale = "aqi" | "pm25" | "pm10";
export type Target =
  | { id: string; kind: "card"; value: number; card: Card }
  | { id: string; kind: "point"; value: number; point: Record<string, unknown>; series: string };

const MON = "(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\\.?";
// dates and labels first (kept as plain text), then numbers
const TOKEN = new RegExp(
  [
    "\\d{4}-\\d{2}-\\d{2}",
    `\\d{1,2}\\s*[–-]\\s*\\d{1,2}\\s+${MON}(?:\\s+\\d{4})?`,
    `\\d{1,2}\\s+${MON}(?:\\s*[–-]\\s*\\d{1,2}\\s+${MON})?(?:,?\\s+\\d{4})?`,
    `${MON}\\s+\\d{1,2}(?:,\\s*\\d{4})?`,
    "PM\\s?(?:2\\.5|10)", "D\\s?[+−-]\\s?\\d+", "\\d{1,2}(?::\\d{2})?\\s?(?:AM|PM)", "\\d{1,2}:\\d{2}",
    "(?<![\\w.])\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|(?<![\\w.])\\d+(?:\\.\\d+)?",
  ].map((p) => `(${p})`).join("|"),
  "g",
);
const NUMERIC = /^\d[\d,]*(?:\.\d+)?$/;

/** Card values and chart points of a turn, in matching order (cards first). */
export function targetsFor(t: Turn): Target[] {
  const out: Target[] = t.cards.map((c) => ({ id: `card:${c.dataset_id}.${c.field}`, kind: "card", value: c.value, card: c }));
  const spec = t.chart;
  if (spec) {
    spec.series.forEach((s, si) => s.data.forEach((p, pi) => {
      if (Array.isArray(p)) {
        if (typeof p[1] === "number") out.push({ id: `pt:${si}:${pi}`, kind: "point", value: p[1], point: { [spec.x.field]: p[0], [spec.y.field]: p[1] }, series: s.name });
      } else {
        const v = (p as Record<string, unknown>)[spec.y.field];
        if (typeof v === "number") out.push({ id: `pt:${si}:${pi}`, kind: "point", value: v, point: p as Record<string, unknown>, series: s.name });
      }
    }));
  }
  return out;
}

export type Segment = { text: string; target?: Target };

/** Split answer text into plain parts and clickable numbers. */
export function segments(text: string, targets: Target[]): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    const tok = m[0];
    if (!NUMERIC.test(tok)) continue;                      // a date, time or label: stays plain text
    const v = Number(tok.replace(/,/g, ""));
    const dec = tok.includes(".") ? tok.split(".")[1].length : 0;
    if (dec === 0 && v >= 1900 && v <= 2100) continue;      // a year
    const hit = targets.find((t) => Math.abs(round(t.value, dec) - v) < 1e-9);
    if (!hit) continue;
    if (m.index! > last) out.push({ text: text.slice(last, m.index) });
    out.push({ text: tok, target: hit });
    last = m.index! + tok.length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

// ------------------------------------------------------------------ proof content
export interface ProofRow { title: string; value: string; sub?: string; category?: Category | null }
export interface Proof {
  title: string;
  value: string;
  unit: string;
  raw: number;
  scale: Scale | null;
  category: Category | null;
  how: string;
  rows: ProofRow[];
  facts: [string, string][];
  check: string;
}

function scaleOf(t: Turn, unit: string, label: string): Scale | null {
  if (/index|aqi/i.test(unit)) return "aqi";
  if (!/µg|ug/i.test(unit)) return null;
  const p = `${label} ${t.answer?.resolved_query?.pollutant ?? ""}`;
  return /pm\s?10\b/i.test(p) && !/pm\s?2\.?5/i.test(p) ? "pm10" : "pm25";
}

function categoryFor(v: number, s: Scale | null): Category | null {
  if (s === "aqi") return aqiCategory(v);
  if (s) return pmCategory(v, s);
  return null;
}

function pointRow(p: Record<string, unknown>, spec: ChartSpec, scale: Scale | null): ProofRow {
  const v = p[spec.y.field] as number;
  const date = (p.bulletin_date ?? p[spec.x.field]) as string;
  const isBulletin = !!p.bulletin_date;
  return {
    title: isBulletin ? `Bulletin dated ${fmtDate(String(p.bulletin_date))}` : /^\d{4}-\d{2}-\d{2}/.test(String(date)) ? fmtDate(String(date)) : String(date),
    value: scale === "aqi" ? String(Math.round(v)) : v.toFixed(1),
    sub: p.reporting_period ? `Covers ${readable(String(p.reporting_period))}` : undefined,
    category: categoryFor(v, scale),
  };
}

function eventPoints(spec: ChartSpec | null, year?: string): Record<string, unknown>[] {
  if (!spec) return [];
  const s = spec.series.find((x) => !year || x.name.includes(year)) ?? spec.series[0];
  return (s?.data ?? []).filter((p) => !Array.isArray(p)) as Record<string, unknown>[];
}

/** The proof for one clicked number. */
export function proofFor(target: Target, t: Turn): Proof {
  const ev = evidenceFor(t);
  const spec = t.chart;
  const n = t.answer?.verification?.numbers_checked;
  const check = `Copied exactly from the analysis result.${n ? ` All ${n} numbers in this answer were checked.` : ""}`;
  const aqiType = ev.dataTypeKey === "official_aqi";
  const facts: [string, string][] = [
    ["Data type", aqiType ? "Official AQI: an index of several pollutants, not a concentration" : ev.dataType === "Measured" ? "Measured at monitoring stations (µg/m³)" : ev.dataType ?? "—"],
    ["Source", ev.source ?? "—"],
    ...(ev.period ? [["Period", ev.period] as [string, string]] : []),
    ["City value", aqiType ? "CPCB's average over the stations that reported that day" :
      "Equal-weight average of reference stations with at least 16 valid hours; a day counts only when enough stations report"],
    ...(ev.stationsDetail ? [["Stations", ev.stationsDetail] as [string, string]] : []),
  ];

  if (target.kind === "card") {
    const c = target.card;
    const scale = scaleOf(t, c.unit, c.label);
    const unit = isAqiCard(c) ? "AQI" : c.unit;
    const f = c.field;
    let how = readable(c.label) + ".";
    let rows: ProofRow[] = [];
    let m: RegExpMatchArray | null;
    if (spec && (m = f.match(/^(\d{4})_festival_aqi$/))) {
      const band = spec.bands?.[0];
      const pts = eventPoints(spec, m[1]).filter((p) => band && Number(p[spec.x.field]) >= Number(band.start) && Number(p[spec.x.field]) <= Number(band.end) && typeof p[spec.y.field] === "number");
      rows = pts.map((p) => pointRow(p, spec, "aqi"));
      if (rows.length) how = `Mean of the ${rows.length} festival bulletins: (${rows.map((r) => r.value).join(" + ")}) ÷ ${rows.length} = ${c.value}.`;
    } else if (spec && (m = f.match(/^(\d{4})_bulletin_(\d{4}-\d{2}-\d{2})$/))) {
      const p = eventPoints(spec, m[1]).find((x) => x.bulletin_date === m![2]);
      if (p) rows = [pointRow(p, spec, "aqi")];
      how = "One official CPCB bulletin. It covers 4 PM on the previous day to 4 PM on its date.";
    } else if (spec && (m = f.match(/^(\d{4})_pre_week_aqi$/))) {
      const pts = eventPoints(spec, m[1]).filter((p) => typeof p[spec.y.field] === "number");
      for (let i = 0; i + 7 <= pts.length; i++) {        // the 7 bulletins whose mean is this value
        const w = pts.slice(i, i + 7), mean = w.reduce((a, p) => a + (p[spec.y.field] as number), 0) / 7;
        if (Math.abs(round(mean, 1) - c.value) < 0.06) { rows = w.map((p) => pointRow(p, spec, "aqi")); break; }
      }
      how = "Mean of the 7 official bulletins in the week before Diwali.";
    } else if (spec && /^(highest|lowest)_value$|^day\d+_value$/.test(f)) {
      const hit = targetsFor(t).find((x) => x.kind === "point" && Math.abs(x.value - c.value) < 1e-9);
      if (hit && hit.kind === "point") rows = [pointRow(hit.point, spec, scale)];
      how = `${readable(c.label)}: the ${/lowest/.test(f) ? "lowest" : /highest/.test(f) ? "highest" : "flagged"} daily city value in the period.`;
    } else if (f === "mean") {
      how = `Average of the daily city values in the period${ev.coverageDetail ? `. ${ev.coverageDetail}` : "."}`;
    }
    return { title: shortTitle(c.label), value: fmtNumber(c), unit, raw: c.value, scale, category: categoryFor(c.value, scale), how, rows, facts, check };
  }

  const scale = spec ? (/(index|aqi)/i.test(spec.units) ? "aqi" : scaleOf(t, spec.units, spec.title)) : null;
  const row = spec ? pointRow(target.point, spec, scale) : { title: "", value: String(target.value) };
  return {
    title: row.title || "Value", value: row.value, unit: scale === "aqi" ? "AQI" : spec?.units ?? "", raw: target.value, scale,
    category: categoryFor(target.value, scale),
    how: target.point.bulletin_date ? "One official CPCB bulletin. It covers 4 PM on the previous day to 4 PM on its date." :
      "One day's city value from the chart.",
    rows: [row], facts, check,
  };
}

/** "Delhi official AQI, bulletin 2026-11-09 (...)" -> "Delhi official AQI, bulletin 9 Nov 2026" */
function shortTitle(label: string): string {
  return readable(label.replace(/\s*\([^)]*\d{2}:\d{2}[^)]*\)/, ""));
}
