// Evidence summary for an answer, built only from what the backend returned.
import { DATA_TYPE_LABEL } from "./categories";
import type { Turn } from "./chat-state";
import { fmtRange, pollutantLabel } from "./format";
import type { SourceRef } from "./types";

export interface Evidence {
  dataType: string | null;
  dataTypeKey: string | null;
  period: string | null;
  stations: string | null;
  stationsDetail: string | null;
  coverage: number | null; // 0..1
  coverageText: string | null;
  coverageDetail: string | null;
  lowCoverage: boolean;
  source: string | null;
  sources: SourceRef[];
}

export const LOW_COVERAGE = 0.7;

export function evidenceFor(t: Turn): Evidence {
  const sources = t.sources?.sources ?? [];
  const main = sources[0];
  const rq = t.answer?.resolved_query;
  const types = t.answer?.data_types ?? [];
  const typeKey = types.length > 1 ? "mixed" : types[0] ?? main?.data_type ?? null;
  const cov = main ? (t.sources?.coverage?.[main.dataset_id] as Record<string, unknown> | null) : null;
  const { share, text, detail } = coverageOf(cov, rq?.pollutant ?? null);
  const st = stationsOf(main);
  return {
    dataType: typeKey ? DATA_TYPE_LABEL[typeKey] ?? typeKey : null,
    dataTypeKey: typeKey,
    period: rq?.start_date ? periodLabel(rq.start_date, rq.end_date, rq.assumptions) : main ? fmtRange(main.date_range.start, main.date_range.end) : null,
    stations: st.short,
    stationsDetail: st.detail,
    coverage: share,
    coverageText: text,
    coverageDetail: detail,
    lowCoverage: share != null && share < LOW_COVERAGE,
    source: main ? [...new Set(sources.map((s) => s.source))].join("; ") : null,
    sources,
  };
}

function stationsOf(s: SourceRef | undefined): { short: string | null; detail: string | null } {
  if (!s) return { short: null, detail: null };
  if (s.data_type === "official_aqi") return { short: "CPCB city bulletin", detail: "Stations chosen by CPCB for its daily city bulletin; the mix can change from day to day." };
  const st = s.stations ?? {};
  if (typeof st.count === "number") return { short: `${st.count} stations`, detail: `${st.count} ${st.tier ?? "primary reference"} stations in the city average.` };
  if (st.count_by_city) {
    const entries = Object.entries(st.count_by_city);
    const total = entries.reduce((a, [, n]) => a + n, 0);
    return { short: `${total} stations`, detail: entries.map(([c, n]) => `${c} ${n}`).join(", ") + ` (${st.tier ?? "primary reference"}).` };
  }
  if (st.note) return { short: "Stations", detail: st.note };
  return { short: null, detail: null };
}

function coverageOf(cov: Record<string, unknown> | null, pollutant: string | null): { share: number | null; text: string | null; detail: string | null } {
  if (!cov) return { share: null, text: null, detail: null };
  const n = (k: string) => (typeof cov[k] === "number" ? (cov[k] as number) : null);
  const days = n("days_in_period");
  if (n("share_of_days_with_city_value") != null) {
    const s = n("share_of_days_with_city_value")!;
    return { share: s, text: pct(s), detail: `${n("days_with_city_value")} of ${days} days have a valid city value (at least 16 valid hours at enough stations).` };
  }
  if (n("common_days") != null && days) {
    const s = n("common_days")! / days;
    return { share: s, text: pct(s), detail: `${n("common_days")} of ${days} days have a valid value for every city compared.` };
  }
  if (n("matched_days") != null && days) {
    const s = n("matched_days")! / days;
    return { share: s, text: pct(s), detail: `${n("matched_days")} of ${days} days have both a city value and weather data${cov.excluded ? `; excluded: ${cov.excluded}` : ""}.` };
  }
  if (Array.isArray(cov.by_pollutant)) {
    const rows = cov.by_pollutant as Record<string, unknown>[];
    const want = pollutant?.toLowerCase().includes("10") ? "pm10" : "pm25";
    const r = rows.find((x) => x.pollutant === want) ?? rows[0];
    const s = typeof r?.share_of_days_with_city_value === "number" ? (r.share_of_days_with_city_value as number) : null;
    return { share: s, text: s != null ? pct(s) : null, detail: s != null ? `${pollutantLabel(String(r.pollutant))}: ${r.days_with_city_value} of ${days} days have a valid city value.` : null };
  }
  if (Array.isArray(cov.years_available)) {
    const yrs = cov.years_available as number[];
    return yrs.length
      ? { share: null, text: `Bulletins for ${yrs.join(", ")}`, detail: `Official CPCB bulletins were found for ${yrs.join(", ")}.` }
      : { share: 0, text: "No bulletins found", detail: "No official CPCB bulletins were found for the requested period." };
  }
  return { share: null, text: null, detail: null };
}

const pct = (s: number) => `${Math.round(s * 100)}% coverage`;

/** "Latest 30 days available · 1 Oct 2026 – 30 Oct 2026" when a relative period was anchored to the data's
 * last day (the data ends before today); otherwise just the dates. */
export function periodLabel(start: string, end: string | null, assumptions: string[] = []): string {
  const range = fmtRange(start, end);
  if (!end || !assumptions.some((a) => /relative to the latest data/i.test(a))) return range;
  const n = Math.round((Date.parse(end + "T00:00:00Z") - Date.parse(start + "T00:00:00Z")) / 86_400_000) + 1;
  return `Latest ${n} days available · ${range}`;
}
