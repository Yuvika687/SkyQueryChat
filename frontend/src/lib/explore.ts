// Explore page logic (pure, testable): station status for a day, rankings, the address, and wording.
import { CATEGORY_STYLE, CITIES, pmCategory, type Category } from "./categories";
import { fmtDate } from "./format";
import type { ExploreData, ExploreStation } from "./types";

export type Pollutant = "pm25" | "pm10";
export const POLLUTANT_LABEL: Record<Pollutant, string> = { pm25: "PM2.5", pm10: "PM10" };

export type DayStatus =
  | { kind: "value"; value: number; hours: number; category: Category }
  | { kind: "not_enough"; hours: number }    // readings, but fewer than 16 valid hours: no 24-hour value
  | { kind: "no_data" };                      // no readings that day

export function dayStatus(s: ExploreStation, i: number, pollutant: Pollutant): DayStatus {
  const v = s.values[i], h = s.valid_hours[i];
  if (v != null && h != null) return { kind: "value", value: v, hours: h, category: pmCategory(v, pollutant)! };
  if (h != null) return { kind: "not_enough", hours: h };
  return { kind: "no_data" };
}

export function statusColour(st: DayStatus): { bg: string; fg: string } {
  return st.kind === "value" ? { bg: CATEGORY_STYLE[st.category].bg, fg: CATEGORY_STYLE[st.category].fg } : { bg: "#64748B", fg: "#FFFFFF" };
}

export function statusText(st: DayStatus, unit = "µg/m³"): string {
  if (st.kind === "value") return `${st.value.toFixed(1)} ${unit}, ${CATEGORY_STYLE[st.category].label}`;
  if (st.kind === "not_enough") return `Not enough data (${st.hours} of 24 hours; a day needs 16)`;
  return "No readings this day";
}

/** Stations shown for a city: reference monitors always, low-cost sensors only when switched on. */
export function cityStations(d: ExploreData, city: string, lowCost: boolean): ExploreStation[] {
  return d.stations.filter((s) => s.city === city && (lowCost || s.tier !== "low_cost"));
}

/** Highest value first; days without a value go last, in name order. */
export function rankStations(list: ExploreStation[], i: number): ExploreStation[] {
  return [...list].sort((a, b) => {
    const va = a.values[i], vb = b.values[i];
    if (va == null && vb == null) return a.name.localeCompare(b.name);
    if (va == null) return 1;
    if (vb == null) return -1;
    return vb - va;
  });
}

export function rankCities(d: ExploreData, i: number): { city: string; value: number | null; stations: number; aqi: { aqi: number; category: string } | null }[] {
  return CITIES.map((c) => ({ city: c, value: d.cities[c]?.values[i] ?? null, stations: d.cities[c]?.stations_reporting[i] ?? 0,
    aqi: d.cities[c]?.aqi?.[i] ?? null }))
    .sort((a, b) => (b.value ?? -1) - (a.value ?? -1));
}

export const hasLowCost = (d: ExploreData) => d.stations.some((s) => s.tier === "low_cost");

// ------------------------------------------------------------------ address (?city=&station=&pollutant=&date=)
export interface ExploreView { city: string | null; station: number | null; pollutant: Pollutant; date: string | null }

export function parseView(p: URLSearchParams): ExploreView {
  const raw = p.get("city")?.toLowerCase();
  const city = CITIES.find((c) => c.toLowerCase() === raw) ?? null;
  const st = Number(p.get("station"));
  const pol = p.get("pollutant")?.toLowerCase().replace(".", "");
  const date = p.get("date");
  return {
    city,
    station: city && Number.isInteger(st) && st > 0 ? st : null,
    pollutant: pol === "pm10" ? "pm10" : "pm25",
    date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
  };
}

export function viewQuery(v: ExploreView): string {
  const q = new URLSearchParams();
  if (v.city) q.set("city", v.city.toLowerCase());
  if (v.city && v.station) q.set("station", String(v.station));
  q.set("pollutant", v.pollutant);
  if (v.date) q.set("date", v.date);
  return q.toString();
}

// ------------------------------------------------------------------ wording
/** "2026-11-11T18:00:00Z" -> "11:30 PM, 11 Nov 2026 IST" (India is UTC+5:30). */
export function fmtLastReading(utc: string | null): string {
  if (!utc) return "Not known";
  const t = Date.parse(utc);
  if (Number.isNaN(t)) return "Not known";
  const ist = new Date(t + 330 * 60_000);
  const h = ist.getUTCHours(), m = ist.getUTCMinutes();
  const time = `${h % 12 === 0 ? 12 : h % 12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "AM" : "PM"}`;
  return `${time}, ${fmtDate(ist.toISOString().slice(0, 10))} IST`;
}

/** A question the analyst can answer today. Answers use city averages, which include this station. */
export function stationQuestion(s: ExploreStation, pollutant: Pollutant, start: string, end: string): string {
  return `How did ${POLLUTANT_LABEL[pollutant]} in ${s.city} change from ${fmtDate(start)} to ${fmtDate(end)}?`;
}

export const LEGEND_RANGES: Record<Pollutant, string[]> = {
  pm25: ["0–30", "31–60", "61–90", "91–120", "121–250", "251+"],
  pm10: ["0–50", "51–100", "101–250", "251–350", "351–430", "431+"],
};

/** How a station is described: provider, then monitor type ("CPCB · Reference monitor"). */
export function monitorType(s: ExploreStation): string {
  if (s.tier === "low_cost") return "Low-cost sensor (indicative)";
  if (s.tier === "supporting_single_station") return "Reference monitor (US consulate, supporting)";
  return "Reference monitor";
}

/** Runs of consecutive days without a 24-hour value: [startIndex, endIndex] inclusive. */
export function gapRuns(values: (number | null)[]): [number, number][] {
  const out: [number, number][] = [];
  let start = -1;
  values.forEach((v, i) => {
    if (v == null && start < 0) start = i;
    if (v != null && start >= 0) { out.push([start, i - 1]); start = -1; }
  });
  if (start >= 0) out.push([start, values.length - 1]);
  return out;
}
