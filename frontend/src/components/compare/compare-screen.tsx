"use client";

// Compare: cities side by side over the same dates. No AI on this page; the selection lives in the address so a
// link reopens the same view. "Explain this with AI" opens Ask with a precise question built from the selection.
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { AlertTriangle, ArrowRight, Sparkles } from "lucide-react";
import { LazyChart } from "@/components/chart/lazy-chart";
import { askHref } from "@/components/ds/ask-box";
import { DataGate } from "@/components/ds/data-state";
import { Section, Segmented } from "@/components/ds/section";
import { Skeleton } from "@/components/ds/states";
import { CITIES, CITY_COLOURS } from "@/lib/categories";
import { buildOption } from "@/lib/chart-options";
import { fmtDate, fmtRange } from "@/lib/format";
import { getCompare, getPeriods, type CompareData, type Metric, type Periods } from "@/lib/pages-api";
import { trendText } from "@/lib/trend-text";
import type { ChartSpec } from "@/lib/types";
import { useBackendData } from "@/lib/use-backend-data";
import { cn } from "@/lib/utils";

const METRICS: { value: Metric; label: string }[] = [
  { value: "pm25", label: "PM2.5" }, { value: "pm10", label: "PM10" }, { value: "aqi", label: "Official AQI" },
];
const METRIC_NAME: Record<Metric, string> = { pm25: "PM2.5", pm10: "PM10", aqi: "official AQI" };
const ISO = /^\d{4}-\d{2}-\d{2}$/;

interface Selection { cities: string[]; metric: Metric; period: string; start?: string; end?: string }

function readSelection(p: URLSearchParams): Selection {
  const cities = (p.get("cities") ?? "delhi,mumbai").split(",")
    .map((c) => CITIES.find((x) => x.toLowerCase() === c.trim().toLowerCase())).filter((c): c is string => !!c);
  const metric = (["pm25", "pm10", "aqi"] as const).find((m) => m === p.get("metric")) ?? "pm25";
  const start = p.get("start") ?? undefined, end = p.get("end") ?? undefined;
  const custom = start && end && ISO.test(start) && ISO.test(end);
  return { cities: [...new Set(cities)].slice(0, 6), metric, period: custom ? "custom" : p.get("period") ?? "30d", ...(custom ? { start, end } : {}) };
}

export function CompareScreen() {
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const sel = useMemo(() => readSelection(new URLSearchParams(params.toString())), [params]);
  const periods = useBackendData((sig) => getPeriods(sig), "periods");

  const update = (next: Partial<Selection>) => {
    const s = { ...sel, ...next };
    const q = new URLSearchParams({ cities: s.cities.map((c) => c.toLowerCase()).join(","), metric: s.metric });
    if (s.period === "custom" && s.start && s.end) { q.set("start", s.start); q.set("end", s.end); } else q.set("period", s.period);
    router.replace(`${path}?${q.toString()}`, { scroll: false });
  };

  return (
    <div className="mx-auto w-full max-w-[1240px] px-4 pt-[84px] pb-[calc(104px+env(safe-area-inset-bottom))] sm:px-8 md:pt-[104px] md:pb-12">
      <header className="mb-6">
        <h1 className="font-display text-[48px] leading-none sm:text-[64px]">Compare</h1>
        <p className="mt-3 text-[16px] text-subtle">Put cities side by side over the same dates.</p>
        <p className="mt-1 text-[13.5px] text-faint">Pick cities, a pollutant and a period.</p>
      </header>
      <DataGate state={periods} what="Compare page">
        {(per) => <CompareBody sel={sel} per={per} update={update} />}
      </DataGate>
    </div>
  );
}

function resolvePeriod(sel: Selection, per: Periods) {
  if (sel.period === "custom" && sel.start && sel.end) {
    const start = sel.start < per.data_start ? per.data_start : sel.start;
    const end = sel.end > per.data_end ? per.data_end : sel.end;
    return { start, end: end < start ? start : end, label: fmtRange(start, end) };
  }
  const p = per.presets.find((x) => x.id === sel.period) ?? per.presets[0];
  return { start: p.start, end: p.end, label: p.label };
}

function CompareBody({ sel, per, update }: { sel: Selection; per: Periods; update: (s: Partial<Selection>) => void }) {
  const { start, end, label } = resolvePeriod(sel, per);
  const enough = sel.cities.length >= 2;
  const key = `${sel.cities.join(",")}|${sel.metric}|${start}|${end}`;
  const data = useBackendData((sig) => (enough ? getCompare(sel.cities, sel.metric, start, end, sig) : Promise.reject(new Error("pick"))), key);

  const toggle = (c: string) => {
    const has = sel.cities.includes(c);
    if (has && sel.cities.length <= 2) return;
    update({ cities: has ? sel.cities.filter((x) => x !== c) : [...sel.cities, c] });
  };

  return (
    <div className="grid min-w-0 grid-cols-1 gap-4">
      {/* ------------------------------------------------------------ controls */}
      <section aria-label="Selection" className="glass flex flex-col gap-4 rounded-2xl p-4 shadow-card sm:p-5">
        <fieldset>
          <legend className="mb-2 text-[13px] font-medium">Cities <span className="font-normal text-faint">(two to six)</span></legend>
          <div className="flex flex-wrap gap-2">
            {CITIES.map((c) => {
              const on = sel.cities.includes(c);
              return (
                <button key={c} type="button" aria-pressed={on} onClick={() => toggle(c)} disabled={on && sel.cities.length <= 2}
                  title={on && sel.cities.length <= 2 ? "At least two cities are needed" : undefined}
                  className={cn("inline-flex min-h-10 items-center gap-2 rounded-full border px-3.5 text-[13.5px] font-medium transition-colors",
                    on ? "border-transparent bg-white/[0.08] text-foreground" : "border-line text-subtle hover:text-foreground", "disabled:cursor-not-allowed")}>
                  <span aria-hidden className={cn("size-2.5 rounded-full", !on && "opacity-40")} style={{ background: CITY_COLOURS[c] }} />
                  {c}
                  {on && <span className="sr-only">(selected)</span>}
                </button>
              );
            })}
          </div>
        </fieldset>
        <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
          <div>
            <p className="mb-2 text-[13px] font-medium" id="metric-label">Pollutant</p>
            <Segmented label="Pollutant" value={sel.metric} onChange={(m) => update({ metric: m })} options={METRICS} />
          </div>
          <div className="min-w-0">
            <label htmlFor="period" className="mb-2 block text-[13px] font-medium">Period</label>
            <select id="period" value={sel.period} onChange={(e) => update(e.target.value === "custom"
              ? { period: "custom", start, end } : { period: e.target.value, start: undefined, end: undefined })}
              className="h-10 rounded-xl border border-line bg-surface px-3 text-[13.5px]">
              {per.presets.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              <option value="custom">Custom dates</option>
            </select>
          </div>
          {sel.period === "custom" && (
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-[13px]"><span className="mb-2 block font-medium">From</span>
                <input type="date" value={start} min={per.data_start} max={per.data_end} onChange={(e) => e.target.value && update({ start: e.target.value, end })}
                  className="h-10 rounded-xl border border-line bg-surface px-3 text-[13.5px] [color-scheme:dark]" /></label>
              <label className="text-[13px]"><span className="mb-2 block font-medium">To</span>
                <input type="date" value={end} min={start} max={per.data_end} onChange={(e) => e.target.value && update({ start, end: e.target.value })}
                  className="h-10 rounded-xl border border-line bg-surface px-3 text-[13.5px] [color-scheme:dark]" /></label>
            </div>
          )}
          <p className="text-[12.5px] text-faint sm:ml-auto">{fmtRange(start, end)} · data from {fmtDate(per.data_start)} to {fmtDate(per.data_end)}</p>
        </div>
      </section>

      <DataGate state={data} what="comparison" skeleton={<Skeleton className="h-[420px]" />}>
        {(d) => <Results d={d} label={label} />}
      </DataGate>
    </div>
  );
}

// ------------------------------------------------------------------ results
function Results({ d, label }: { d: CompareData; label: string }) {
  const aqi = d.metric === "aqi";
  const unit = aqi ? "AQI" : "µg/m³";
  const spec: ChartSpec = useMemo(() => ({
    type: "line", title: `${METRIC_NAME[d.metric]} by day`, x: { field: "date", type: "time" },
    y: { field: aqi ? "aqi" : "value", label: aqi ? "AQI (index)" : `${METRIC_NAME[d.metric]} (µg/m³)` },
    series: Object.entries(d.lines).map(([c, v]) => ({ name: c, data: d.dates.map((dt, i) => [dt, v[i]] as [string, number | null]) })),
    units: aqi ? "AQI (index)" : "µg/m³",
  }), [d, aqi]);
  const option = useMemo(() => buildOption(spec, "measured"), [spec]);
  const low = d.cities.filter((c) => c.low_coverage);
  const close = d.too_close_to_call;
  const question = `Compare ${METRIC_NAME[d.metric]} in ${listJoin(d.cities.map((c) => c.city))} from ${fmtDate(d.start)} to ${fmtDate(d.end)}.`;

  return (
    <>
      {low.length > 0 && (
        <p role="alert" className="flex items-start gap-2.5 rounded-2xl border border-warn/40 bg-warn/[0.08] px-4 py-3 text-[13.5px]">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
          <span><strong>Low coverage:</strong> {listJoin(low.map((c) => `${c.city} (${Math.round(c.coverage_pct)}% of days)`))} {low.length === 1 ? "has" : "have"} a value on fewer than half the days, so treat {low.length === 1 ? "its" : "their"} figures with care.</span>
        </p>
      )}
      <Section id="lines" title={`${METRIC_NAME[d.metric].replace(/^o/, "O")} by day`}
        line={<>{label}: {aqi ? "CPCB's 4 PM bulletins (official AQI, an index)" : "24-hour city averages (measured)"}. Days without a value are gaps.</>}>
        <LazyChart option={option} height={340} ariaLabel={`${METRIC_NAME[d.metric]} by day for ${listJoin(d.cities.map((c) => c.city))}, ${fmtRange(d.start, d.end)}`} />
      </Section>
      <Section id="ranking" title="Ranking"
        line={`Highest first. Means use the ${d.common_days} days on which every selected city has a value; the bar shows the approximate 95% range.`}
        action={<Link href={askHref(question)} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-teal px-3.5 text-[13.5px] font-semibold text-teal-ink hover:bg-teal-hover">
          <Sparkles className="size-4" aria-hidden />Explain this with AI</Link>}>
        <RankingTable d={d} unit={unit} />
        {close.length > 0 && (
          <p className="mt-3 text-[13px] text-subtle"><strong className="text-foreground">Too close to call:</strong> {close.map(([a, b]) => `${a} and ${b}`).join("; ")}. Their 95% ranges overlap heavily, so their order could easily swap.</p>
        )}
        <p className="mt-3 text-[12px] text-faint">{d.method} Source: {d.source}.</p>
      </Section>
      <p className="text-center text-[12.5px] text-faint">
        Want the story behind these numbers? <Link href={askHref(question)} className="font-medium text-teal hover:underline">Ask the AI analyst <ArrowRight className="inline size-3.5" aria-hidden /></Link>
      </p>
    </>
  );
}

/** Shared scale for the range bars: the span of all ranges with a little room, so overlaps are easy to see. */
function rangeScale(d: CompareData) {
  const lo = Math.min(...d.cities.map((c) => c.range95?.[0] ?? c.mean ?? 0));
  const hi = Math.max(...d.cities.map((c) => c.range95?.[1] ?? c.mean ?? 0));
  const pad = Math.max(1, (hi - lo) * 0.08);
  const a = Math.max(0, lo - pad), b = hi + pad;
  return (v: number) => `${((v - a) / (b - a)) * 100}%`;
}

function RangeBar({ c, unit, pct }: { c: CompareData["cities"][number]; unit: string; pct: (v: number) => string }) {
  if (!c.range95 || c.mean == null) return <span className="text-faint">not enough days</span>;
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-2 flex-1 rounded-full bg-white/[0.06]" role="img" aria-label={`95% range ${c.range95[0]} to ${c.range95[1]} ${unit}`}>
        <div className="absolute inset-y-0 rounded-full opacity-60" style={{ left: pct(c.range95[0]), width: `calc(${pct(c.range95[1])} - ${pct(c.range95[0])})`, background: CITY_COLOURS[c.city] }} />
        <div className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#0b1324]" style={{ left: pct(c.mean), background: CITY_COLOURS[c.city] }} />
      </div>
      <span className="num w-[92px] shrink-0 text-[12px] text-subtle">{c.range95[0].toFixed(1)}–{c.range95[1].toFixed(1)}</span>
    </div>
  );
}

function RankingTable({ d, unit }: { d: CompareData; unit: string }) {
  const pct = rangeScale(d);
  return (
    <>
    {/* phones: one card per city */}
    <ol className="flex flex-col gap-2 md:hidden">
      {d.cities.map((c, i) => {
        const t = trendText(c.trend, unit);
        return (
          <li key={c.city} className="rounded-xl border border-line px-3.5 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="inline-flex items-center gap-2 font-medium"><span className="num text-faint">{i + 1}</span>
                <span aria-hidden className="size-2.5 rounded-full" style={{ background: CITY_COLOURS[c.city] }} />{c.city}</span>
              <span className="num font-semibold">{c.mean == null ? "–" : c.mean.toFixed(1)} <span className="text-[11.5px] font-normal text-faint">{unit}</span></span>
            </div>
            <div className="mt-2"><RangeBar c={c} unit={unit} pct={pct} /></div>
            <p className="mt-2 text-[12.5px] text-subtle">
              {c.valid_days} valid days · <span className={cn(c.low_coverage && "font-semibold text-warn")}>{Math.round(c.coverage_pct)}% coverage</span> · {t.short}
              <span className="block text-[11.5px] text-faint">{t.detail}</span>
            </p>
          </li>
        );
      })}
    </ol>
    <div className="hidden md:block">
      <table className="w-full text-[13.5px]">
        <thead>
          <tr className="border-b border-line text-left text-[12px] text-faint">
            <th scope="col" className="py-2 pr-3 font-medium">#</th>
            <th scope="col" className="py-2 pr-3 font-medium">City</th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">Mean</th>
            <th scope="col" className="w-[30%] py-2 pr-3 font-medium">95% range</th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">Valid days</th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">Coverage</th>
            <th scope="col" className="py-2 font-medium">Trend</th>
          </tr>
        </thead>
        <tbody>
          {d.cities.map((c, i) => {
            const t = trendText(c.trend, unit);
            return (
              <tr key={c.city} className="border-b border-line/60 last:border-0">
                <td className="num py-2.5 pr-3 text-faint">{i + 1}</td>
                <th scope="row" className="py-2.5 pr-3 text-left font-medium">
                  <span className="inline-flex items-center gap-2"><span aria-hidden className="size-2.5 rounded-full" style={{ background: CITY_COLOURS[c.city] }} />{c.city}</span>
                </th>
                <td className="num py-2.5 pr-3 text-right font-semibold">{c.mean == null ? "–" : c.mean.toFixed(1)} <span className="text-[11.5px] font-normal text-faint">{unit}</span></td>
                <td className="py-2.5 pr-3"><RangeBar c={c} unit={unit} pct={pct} /></td>
                <td className="num py-2.5 pr-3 text-right">{c.valid_days}</td>
                <td className={cn("num py-2.5 pr-3 text-right", c.low_coverage && "font-semibold text-warn")}>{Math.round(c.coverage_pct)}%{c.low_coverage && <span className="sr-only"> (low coverage)</span>}</td>
                <td className="py-2.5"><span className="font-medium">{t.short}</span><span className="block text-[11.5px] text-faint">{t.detail}</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
    </>
  );
}

function listJoin(xs: string[]) {
  return xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}
