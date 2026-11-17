"use client";

// Compare: cities side by side over the same dates. No AI on this page; the selection lives in the address so a
// link reopens the same view. "Explain this with AI" opens Ask with a precise question built from the selection.
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Building2, CalendarRange, Check, Download, Gauge, GitCompareArrows, Link2, MapPin, Plus, Scale, Search, Sparkles, Trophy, X } from "lucide-react";
import { PageHero } from "@/components/ds/page-hero";
import { StatNumber } from "@/components/ds/data-display";
import { LazyChart } from "@/components/chart/lazy-chart";
import { askHref } from "@/components/ds/ask-box";
import { DataGate } from "@/components/ds/data-state";
import { Section, Segmented } from "@/components/ds/section";
import { Term } from "@/components/ds/term";
import { EmptyNote, Skeleton } from "@/components/ds/states";
import { copyText, download, toCSV, useToast } from "@/components/ds/toast";
import { CATEGORY_STYLE, CITIES, aqiCategory, cityColour } from "@/lib/categories";
import { cpcbCategory, getCpcbCities, searchCpcb, type CpcbCity } from "@/lib/cpcb";
import { buildOption } from "@/lib/chart-options";
import { fmtDate, fmtRange } from "@/lib/format";
import { getCompare, getPeriods, type CompareData, type Metric, type Periods } from "@/lib/pages-api";
import { SHORT_NOTE, trendText } from "@/lib/trend-text";
import type { ChartSpec } from "@/lib/types";
import { useBackendData } from "@/lib/use-backend-data";
import { cn } from "@/lib/utils";

const METRICS: { value: Metric; label: string }[] = [
  { value: "pm25", label: "PM2.5" }, { value: "pm10", label: "PM10" }, { value: "aqi", label: "Official AQI" },
];
const METRIC_NAME: Record<Metric, string> = { pm25: "PM2.5", pm10: "PM10", aqi: "official AQI" };
const ISO = /^\d{4}-\d{2}-\d{2}$/;

interface Selection { cities: string[]; metric: Metric; period: string; start?: string; end?: string }

const MAX_CITIES = 6;
/** "navi mumbai" -> "Navi Mumbai" (a bulletin name typed in the address; the backend resolves the exact name) */
const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s-])([a-z])/g, (_, a: string, b: string) => a + b.toUpperCase());

function readSelection(p: URLSearchParams): Selection {
  const metric = (["pm25", "pm10", "aqi"] as const).find((m) => m === p.get("metric")) ?? "pm25";
  // the six metros by name; with official AQI, any other bulletin city as written in the address
  const cities = (p.get("cities") ?? "delhi,mumbai").split(",").map((c) => c.trim()).filter(Boolean)
    .map((c) => CITIES.find((x) => x.toLowerCase() === c.toLowerCase()) ?? (metric === "aqi" ? titleCase(c.slice(0, 40)) : null))
    .filter((c): c is string => !!c);
  if (cities.length < 2) cities.push(...["Delhi", "Mumbai"].filter((c) => !cities.includes(c)).slice(0, 2 - cities.length));
  const start = p.get("start") ?? undefined, end = p.get("end") ?? undefined;
  const custom = start && end && ISO.test(start) && ISO.test(end);
  return { cities: [...new Set(cities)].slice(0, MAX_CITIES), metric, period: custom ? "custom" : p.get("period") ?? "30d", ...(custom ? { start, end } : {}) };
}

export function CompareScreen() {
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const sel = useMemo(() => readSelection(new URLSearchParams(params.toString())), [params]);
  const periods = useBackendData((sig) => getPeriods(sig), "periods");

  const update = (next: Partial<Selection>) => {
    const s = { ...sel, ...next };
    if (s.metric !== "aqi") {          // PM2.5 and PM10 are measured for the six metros only
      s.cities = s.cities.filter((c) => CITIES.includes(c));
      for (const c of ["Delhi", "Mumbai"]) if (s.cities.length < 2 && !s.cities.includes(c)) s.cities.push(c);
    }
    const q = new URLSearchParams({ cities: s.cities.map((c) => (CITIES.includes(c) ? c.toLowerCase() : c)).join(","), metric: s.metric });
    if (s.period === "custom" && s.start && s.end) { q.set("start", s.start); q.set("end", s.end); } else q.set("period", s.period);
    router.replace(`${path}?${q.toString()}`, { scroll: false });
  };

  return (
    <div className="mx-auto w-full max-w-[1280px] px-4 pt-[88px] pb-[calc(104px+env(safe-area-inset-bottom))] sm:px-8 md:pt-[104px] md:pb-12">
      <PageHero eyebrow="Side by side · 329 cities" icon={GitCompareArrows} title="Compare" aside={<SelectedStack cities={sel.cities} />}>
        <p className="text-[16px] text-subtle">Put cities side by side over the same dates.</p>
        <p className="mt-1 text-[14px] text-faint">
          <Term k="pm25" /> or <Term k="pm10" /> in <Term k="ugm3" /> for the six metros, or the official <Term k="aqi" /> from <Term k="cpcb" /> for any of 329 bulletin cities.
        </p>
      </PageHero>
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
    <div className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-[288px_minmax(0,1fr)] lg:items-start">
      {/* ------------------------------------------------------------ controls: a slim left panel */}
      <section aria-label="Selection" className="card sq-card-in flex flex-col gap-6 p-5 transition-shadow hover:shadow-[0_18px_50px_-24px_rgb(45_212_191/0.4)] lg:sticky lg:top-[96px]">
        <fieldset>
          <legend className="mb-2.5 inline-flex items-center gap-1.5 text-[13px] font-medium text-subtle"><Building2 className="size-3.5 text-teal" aria-hidden />Cities <span className="font-normal text-faint">(two to six)</span></legend>
          {sel.metric === "aqi" ? (
            <CityAdder selected={sel.cities} onAdd={(c) => update({ cities: [...sel.cities, c] })} full={sel.cities.length >= MAX_CITIES} />
          ) : (
            <p className="mb-2.5 text-[12.5px] leading-5 text-faint">Choose <strong className="font-medium text-subtle">Official AQI</strong> below to compare any of 329 cities.</p>
          )}
          {sel.cities.some((c) => !CITIES.includes(c)) && (
            <ul className="mb-2 flex flex-wrap gap-1.5" aria-label="Other cities">
              {sel.cities.filter((c) => !CITIES.includes(c)).map((c) => (
                <li key={c}>
                  <button type="button" onClick={() => toggle(c)} disabled={sel.cities.length <= 2} aria-label={`Remove ${c}`}
                    className="sq-pop inline-flex h-8 items-center gap-2 rounded-full bg-white/[0.07] pr-2 pl-3 text-[13.5px] font-medium hover:bg-white/[0.1] disabled:cursor-not-allowed">
                    <span aria-hidden className="size-2.5 rounded-full" style={{ background: cityColour(c, sel.cities) }} />{c}
                    <X className="size-3.5 text-faint" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-2 lg:flex-col lg:gap-1">
            {CITIES.map((c) => {
              const on = sel.cities.includes(c);
              return (
                <button key={c} type="button" aria-pressed={on} onClick={() => toggle(c)}
                  disabled={(on && sel.cities.length <= 2) || (!on && sel.cities.length >= MAX_CITIES)}
                  title={on && sel.cities.length <= 2 ? "At least two cities are needed" : !on && sel.cities.length >= MAX_CITIES ? "Up to six cities" : undefined}
                  style={on ? { background: `color-mix(in srgb, ${cityColour(c, sel.cities)} 13%, transparent)` } : undefined}
                  className={cn("inline-flex min-h-10 items-center gap-2.5 rounded-xl px-3 text-[14px] font-medium transition-all duration-200 lg:w-full",
                    on ? "text-foreground" : "text-subtle hover:translate-x-0.5 hover:bg-white/[0.03] hover:text-foreground", "disabled:cursor-not-allowed")}>
                  <span aria-hidden className={cn("size-2.5 rounded-full", on ? "sq-dot-glow" : "opacity-35")} style={{ background: cityColour(c, sel.cities), color: cityColour(c, sel.cities) }} />
                  {c}
                  {on && <Check className="ml-auto hidden size-4 text-teal lg:block" aria-hidden />}
                  {on && <span className="sr-only">(selected)</span>}
                </button>
              );
            })}
          </div>
        </fieldset>
        <div>
          <p className="mb-2.5 inline-flex items-center gap-1.5 text-[13px] font-medium text-subtle" id="metric-label"><Gauge className="size-3.5 text-teal" aria-hidden />Pollutant</p>
          <Segmented label="Pollutant" value={sel.metric} onChange={(m) => update({ metric: m })} options={METRICS} />
        </div>
        <div className="min-w-0">
          <p id="period-label" className="mb-2.5 inline-flex items-center gap-1.5 text-[13px] font-medium text-subtle"><CalendarRange className="size-3.5 text-teal" aria-hidden />Period</p>
          <PeriodPicker per={per} value={sel.period} onPick={(id) => update(id === "custom"
            ? { period: "custom", start, end } : { period: id, start: undefined, end: undefined })} />
          {sel.period === "custom" && (
            <div className="mt-3 grid grid-cols-2 gap-2">
              <label className="text-[13px]"><span className="mb-1.5 block text-faint">From</span>
                <input type="date" value={start} min={per.data_start} max={per.data_end} onChange={(e) => e.target.value && update({ start: e.target.value, end })}
                  className="h-10 w-full rounded-xl bg-white/[0.05] px-2 text-[13px] [color-scheme:dark]" /></label>
              <label className="text-[13px]"><span className="mb-1.5 block text-faint">To</span>
                <input type="date" value={end} min={start} max={per.data_end} onChange={(e) => e.target.value && update({ start, end: e.target.value })}
                  className="h-10 w-full rounded-xl bg-white/[0.05] px-2 text-[13px] [color-scheme:dark]" /></label>
            </div>
          )}
          <p className="mt-2.5 text-[12.5px] leading-5 text-faint">{fmtRange(start, end)}. Data from {fmtDate(per.data_start)} to {fmtDate(per.data_end)}.</p>
        </div>
      </section>

      <div className="flex min-w-0 flex-col gap-6">
      <DataGate state={data} what="comparison" skeleton={<Skeleton className="h-[420px] rounded-[18px]" />}>
        {(d) => <Results d={d} label={label} />}
      </DataGate>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ results
/** The daily values shown in the chart, one row per date, plus what they are. */
export function compareCSV(d: CompareData): string {
  const cities = Object.keys(d.lines);
  const rows: (string | number | null)[][] = [["date", ...cities.map((c) => `${c}_${d.metric}`), "unit", "data_type", "source"]];
  d.dates.forEach((dt, i) => rows.push([dt, ...cities.map((c) => d.lines[c][i]), d.units, d.data_type, d.source]));
  return toCSV(rows);
}

/** Copy link, Download CSV and Explain this with AI, together in one row. */
function Actions({ d, question }: { d: CompareData; question: string }) {
  const toast = useToast();
  const btn = "inline-flex h-10 items-center gap-2 rounded-xl bg-white/[0.05] px-3.5 text-[14px] text-subtle transition-colors hover:bg-white/[0.08] hover:text-foreground";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className={btn} onClick={() => void copyText(window.location.href, toast, "Link copied")}>
        <Link2 className="size-4" aria-hidden />Copy link
      </button>
      <button type="button" className={btn}
        onClick={() => { download(`compare-${d.metric}-${d.start}-${d.end}.csv`, compareCSV(d), "text/csv;charset=utf-8"); toast("Data downloaded (CSV)"); }}>
        <Download className="size-4" aria-hidden />Download CSV
      </button>
      <Link href={askHref(question)} className="sq-shine inline-flex h-10 items-center gap-2 rounded-xl bg-gradient-to-r from-teal to-[#5EEAD4] px-3.5 text-[14px] font-semibold text-teal-ink shadow-[0_8px_28px_-10px_rgb(45_212_191/0.7)] hover:brightness-110 sm:ml-auto">
        <Sparkles className="size-4" aria-hidden />Explain this with AI
      </Link>
    </div>
  );
}

/** Highest city, lowest city and their ratio (calculated in Python), or "too close to call". */
function Summary({ d, unit }: { d: CompareData; unit: string }) {
  const s = d.summary;
  const names = d.cities.map((c) => c.city);
  if (!s) return null;
  const aqi = d.metric === "aqi";
  const tile = (colour: string) => ({
    className: "tile sq-lift relative flex min-w-0 flex-col gap-1 overflow-hidden px-4 py-4 hover:-translate-y-0.5",
    style: { backgroundImage: `radial-gradient(120% 90% at 100% 0%, color-mix(in srgb, ${colour} 20%, transparent), transparent 60%)` },
  });
  const city = (label: string, icon: React.ReactNode, x: { city: string; mean: number }) => {
    const colour = cityColour(x.city, names);
    const cat = aqi ? aqiCategory(x.mean) : null;
    return (
      <div {...tile(colour)}>
        <span className="inline-flex items-center gap-1.5 text-[12.5px] text-faint">{icon}{label}</span>
        <span className="flex items-baseline gap-2"><span aria-hidden className="sq-dot-glow size-2.5 shrink-0 self-center rounded-full" style={{ background: colour, color: colour }} />
          <span className="truncate text-[16px] font-semibold">{x.city}</span>
          <StatNumber value={x.mean} className="ml-auto text-[26px] leading-8 font-semibold" /></span>
        <span className="flex items-center justify-end gap-2 text-[12px] text-faint">
          {cat && <span className="inline-flex h-5 items-center rounded-full px-2 text-[11px] font-semibold" style={{ background: CATEGORY_STYLE[cat].bg, color: CATEGORY_STYLE[cat].fg }}>{CATEGORY_STYLE[cat].label}</span>}
          {unit} mean</span>
      </div>
    );
  };
  return (
    <div className="sq-stagger grid grid-cols-1 gap-3 sm:grid-cols-3" aria-label="Summary">
      {city("Highest", <ArrowUpRight className="size-3.5 text-[#FDBA74]" aria-hidden />, s.highest)}
      {city("Lowest", <ArrowDownRight className="size-3.5 text-[#86EFAC]" aria-hidden />, s.lowest)}
      <div {...tile(s.too_close_to_call ? "#F59E0B" : "#2DD4BF")}>
        <span className="inline-flex items-center gap-1.5 text-[12.5px] text-faint"><Scale className="size-3.5 text-teal" aria-hidden />{s.too_close_to_call ? "Result" : "Highest vs lowest"}</span>
        {s.too_close_to_call ? (
          <span className="text-[17px] leading-8 font-semibold text-warn">Too close to call</span>
        ) : (
          <span className="text-[26px] leading-8 font-semibold">{s.ratio != null ? <><StatNumber value={s.ratio} />×</> : "–"}</span>
        )}
        <span className="num text-[12px] text-faint">{s.too_close_to_call ? "Their 95% ranges overlap heavily" : `+${s.difference.toFixed(1)} ${unit} · ${d.common_days} common days`}</span>
      </div>
    </div>
  );
}

/** Every city's mean as a bar that grows in, highest first: the comparison at a glance. */
function Race({ d, unit }: { d: CompareData; unit: string }) {
  const names = d.cities.map((c) => c.city);
  const rows = d.cities.filter((c) => c.mean != null);
  if (rows.length < 2) return null;
  const max = Math.max(...rows.map((c) => c.mean ?? 0), 1);
  return (
    <div className="card sq-accent-top relative p-5 sm:p-6" aria-label="Means at a glance">
      <p className="mb-4 inline-flex items-center gap-2 text-[13px] font-medium text-subtle">
        <Trophy className="size-4 text-teal" aria-hidden />At a glance <span className="font-normal text-faint">· mean over the {d.common_days} common days</span>
      </p>
      <ol className="flex flex-col gap-3">
        {rows.map((c, i) => {
          const colour = cityColour(c.city, names);
          const cat = d.metric === "aqi" ? aqiCategory(c.mean) : null;
          return (
            <li key={c.city} className="grid grid-cols-[minmax(0,118px)_minmax(0,1fr)_auto] items-center gap-3 text-[14px]">
              <span className="flex min-w-0 items-center gap-2"><span className="num w-4 text-faint">{i + 1}</span><span className="truncate font-medium">{c.city}</span></span>
              <span aria-hidden className="relative h-3 overflow-hidden rounded-full bg-white/[0.05]">
                <span className="sq-grow absolute inset-y-0 left-0 rounded-full" style={{
                  width: `${Math.max(3, (100 * (c.mean ?? 0)) / max)}%`, animationDelay: `${0.15 + i * 0.09}s`,
                  background: `linear-gradient(90deg, color-mix(in srgb, ${colour} 45%, transparent), ${colour})`,
                  boxShadow: `0 0 16px color-mix(in srgb, ${colour} 55%, transparent)`,
                }} />
              </span>
              <span className="flex items-center gap-2">
                <span className="num font-semibold">{c.mean!.toFixed(1)} <span className="text-[12px] font-normal text-faint">{unit}</span></span>
                {cat && <span className="size-2.5 rounded-full" style={{ background: CATEGORY_STYLE[cat].bg }} title={CATEGORY_STYLE[cat].label} />}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** The selected cities as overlapping glowing discs beside the title (decoration). */
function SelectedStack({ cities }: { cities: string[] }) {
  return (
    <div aria-hidden className="hidden items-center gap-4 lg:flex">
      <div className="flex -space-x-3">
        {cities.map((c, i) => {
          const colour = cityColour(c, cities);
          return (
            <span key={c} className="sq-pop grid size-12 place-items-center rounded-full border-2 border-[#0b1324] text-[13px] font-bold text-[#0b1324]"
              style={{ background: `radial-gradient(circle at 35% 30%, #ffffffaa, ${colour} 58%)`, boxShadow: `0 0 24px color-mix(in srgb, ${colour} 45%, transparent)`, animationDelay: `${i * 0.07}s`, zIndex: 10 - i }}>
              <span className="sq-float" style={{ animationDelay: `${i * 0.4}s` }}>{c.slice(0, 2)}</span>
            </span>
          );
        })}
      </div>
      <span className="text-[13px] leading-5 text-subtle"><strong className="block text-[22px] font-semibold text-foreground">{cities.length}</strong>cities</span>
    </div>
  );
}

function Results({ d, label }: { d: CompareData; label: string }) {
  const aqi = d.metric === "aqi";
  const unit = aqi ? "AQI" : "µg/m³";
  const spec: ChartSpec = useMemo(() => ({
    type: "line", title: `${METRIC_NAME[d.metric]} by day`, x: { field: "date", type: "time" },
    y: { field: aqi ? "aqi" : "value", label: aqi ? "AQI (index)" : `${METRIC_NAME[d.metric]} (µg/m³)` },
    series: Object.entries(d.lines).map(([c, v]) => ({ name: c, colour: cityColour(c, Object.keys(d.lines)), data: d.dates.map((dt, i) => [dt, v[i]] as [string, number | null]) })),
    units: aqi ? "AQI (index)" : "µg/m³",
  }), [d, aqi]);
  const option = useMemo(() => buildOption(spec, "measured"), [spec]);
  const low = d.cities.filter((c) => c.low_coverage);
  const close = d.too_close_to_call;
  const question = `Compare ${METRIC_NAME[d.metric]} in ${listJoin(d.cities.map((c) => c.city))} from ${fmtDate(d.start)} to ${fmtDate(d.end)}.`;

  return (
    <div className="sq-stagger flex min-w-0 flex-col gap-6">
      <Summary d={d} unit={unit} />
      <Race d={d} unit={unit} />
      <Actions d={d} question={question} />
      {low.length > 0 && (
        <p role="alert" className="flex items-start gap-2.5 rounded-[14px] bg-warn/[0.08] px-4 py-3 text-[14px]">
          <AlertTriangle className="mt-1 size-4 shrink-0 text-warn" aria-hidden />
          <span><strong>Low coverage:</strong> {listJoin(low.map((c) => `${c.city} (${Math.round(c.coverage_pct)}% of days)`))} {low.length === 1 ? "has" : "have"} a value on fewer than half the days, so treat {low.length === 1 ? "its" : "their"} figures with care.</span>
        </p>
      )}
      <Section id="lines" title={`${METRIC_NAME[d.metric].replace(/^o/, "O")} by day`}
        line={<>{label}: {aqi ? "CPCB's 4 PM bulletins (official AQI, an index)" : "24-hour city averages (measured)"}. Days without a value are gaps.</>}>
        {Object.values(d.lines).every((v) => v.every((x) => x == null)) ? (
          <EmptyNote title="No values for these cities in this period" hint="Try a longer period, another pollutant, or a preset such as the last 90 days." className="h-[340px] content-center" />
        ) : <LazyChart option={option} height={340} ariaLabel={`${METRIC_NAME[d.metric]} by day for ${listJoin(d.cities.map((c) => c.city))}, ${fmtRange(d.start, d.end)}`} />}
      </Section>
      <Section id="ranking" title="Ranking"
        line={`Highest first. Means use the ${d.common_days} days on which every selected city has a value; the bar shows the 95% range.`}>
        <RankingTable d={d} unit={unit} />
        {close.length > 0 && (
          <p className="mt-4 text-[14px] text-subtle"><strong className="text-foreground">Too close to call:</strong> {close.map(([a, b]) => `${a} and ${b}`).join("; ")}. Their 95% ranges overlap heavily, so their order could easily swap.</p>
        )}
        {d.cities.some((c) => c.trend.note) && <p className="mt-3 text-[13px] text-subtle">{SHORT_NOTE}</p>}
        <p className="mt-3 text-[12.5px] text-faint">{d.method} Source: {d.source}.</p>
      </Section>
    </div>
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

function RangeBar({ c, unit, pct, names }: { c: CompareData["cities"][number]; unit: string; pct: (v: number) => string; names: string[] }) {
  if (!c.range95 || c.mean == null) return <span className="text-faint">not enough days</span>;
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-2 flex-1 rounded-full bg-white/[0.06]" role="img" aria-label={`95% range ${c.range95[0]} to ${c.range95[1]} ${unit}`}>
        <div className="absolute inset-y-0 rounded-full opacity-60" style={{ left: pct(c.range95[0]), width: `calc(${pct(c.range95[1])} - ${pct(c.range95[0])})`, background: cityColour(c.city, names) }} />
        <div className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#0b1324]" style={{ left: pct(c.mean), background: cityColour(c.city, names) }} />
      </div>
      <span className="num w-[92px] shrink-0 text-[12px] text-subtle">{c.range95[0].toFixed(1)}–{c.range95[1].toFixed(1)}</span>
    </div>
  );
}

const TREND_TONE: Record<string, string> = {
  Rising: "bg-[#FB923C]/15 text-[#FDBA74]", Falling: "bg-[#22C55E]/15 text-[#86EFAC]",
  "No clear trend": "bg-white/[0.06] text-subtle", "Not enough data": "bg-white/[0.04] text-faint",
};

function TrendBadge({ t }: { t: { short: string; detail: string } }) {
  return (
    <span className="flex flex-col items-start gap-1">
      <span className={cn("inline-flex h-6 items-center rounded-full px-2.5 text-[12px] font-medium whitespace-nowrap", TREND_TONE[t.short])}>{t.short}</span>
      <span className="text-[12px] leading-4 text-faint">{t.detail}</span>
    </span>
  );
}

function Coverage({ c }: { c: CompareData["cities"][number] }) {
  return c.low_coverage ? (
    <span className="inline-flex items-center gap-1 font-semibold text-warn"><AlertTriangle className="size-3.5" aria-hidden />{Math.round(c.coverage_pct)}%<span className="sr-only"> (low coverage)</span></span>
  ) : <span>{Math.round(c.coverage_pct)}%</span>;
}

function RankingTable({ d, unit }: { d: CompareData; unit: string }) {
  const pct = rangeScale(d);
  const names = d.cities.map((c) => c.city);
  return (
    <>
    {/* phones: one block per city, separated by space (no boxes) */}
    <ol className="sq-stagger flex flex-col gap-5 md:hidden">
      {d.cities.map((c, i) => {
        const t = trendText(c.trend, unit);
        return (
          <li key={c.city}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="inline-flex items-center gap-2 text-[15px] font-medium"><span className="num text-faint">{i + 1}</span>
                <span aria-hidden className="size-2.5 rounded-full" style={{ background: cityColour(c.city, names) }} />{c.city}</span>
              <span className="num text-[16px] font-semibold">{c.mean == null ? "–" : c.mean.toFixed(1)} <span className="text-[12px] font-normal text-faint">{unit}</span></span>
            </div>
            <div className="mt-2"><RangeBar c={c} unit={unit} pct={pct} names={names} /></div>
            <div className="mt-2 flex items-start justify-between gap-3 text-[13px] text-subtle">
              <TrendBadge t={t} />
              <span className="shrink-0 text-right">{c.valid_days} days · <Coverage c={c} /></span>
            </div>
          </li>
        );
      })}
    </ol>
    <div className="hidden md:block">
      <table className="w-full text-[14px]">
        <thead>
          <tr className="text-left text-[12.5px] text-faint">
            <th scope="col" className="pb-3 pr-3 font-medium">#</th>
            <th scope="col" className="pb-3 pr-3 font-medium">City</th>
            <th scope="col" className="pb-3 pr-3 text-right font-medium">Mean</th>
            <th scope="col" className="w-[30%] pb-3 pr-3 font-medium">95% range</th>
            <th scope="col" className="pb-3 pr-3 text-right font-medium">Days</th>
            <th scope="col" className="pb-3 pr-3 text-right font-medium">Coverage</th>
            <th scope="col" className="pb-3 font-medium">Trend</th>
          </tr>
        </thead>
        <tbody className="sq-stagger">
          {d.cities.map((c, i) => {
            const t = trendText(c.trend, unit);
            return (
              <tr key={c.city} className="align-top odd:bg-white/[0.02] [&>*:first-child]:rounded-l-xl [&>*:last-child]:rounded-r-xl">
                <td className="num py-3 pr-3 pl-3 text-faint">{i + 1}</td>
                <th scope="row" className="py-3 pr-3 text-left font-medium">
                  <span className="inline-flex items-center gap-2"><span aria-hidden className="size-2.5 rounded-full" style={{ background: cityColour(c.city, names) }} />{c.city}</span>
                </th>
                <td className="num py-3 pr-3 text-right font-semibold whitespace-nowrap">{c.mean == null ? "–" : c.mean.toFixed(1)} <span className="text-[12px] font-normal text-faint">{unit}</span></td>
                <td className="py-3.5 pr-3"><RangeBar c={c} unit={unit} pct={pct} names={names} /></td>
                <td className="num py-3 pr-3 text-right">{c.valid_days}</td>
                <td className="num py-3 pr-3 text-right"><Coverage c={c} /></td>
                <td className="py-3 pr-3"><TrendBadge t={t} /></td>
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

/** Period presets as chips, grouped: recent, 2026, 2025 (and custom dates). */
const PERIOD_GROUPS: { label: string; test: (id: string) => boolean }[] = [
  { label: "Recent", test: (id) => /^\d+d$/.test(id) },
  { label: "2026", test: (id) => /2026/.test(id) },
  { label: "2025", test: (id) => /2025/.test(id) },
];

function PeriodPicker({ per, value, onPick }: { per: Periods; value: string; onPick: (id: string) => void }) {
  const chip = (on: boolean) => cn("inline-flex h-8 items-center rounded-full px-3 text-[13px] font-medium transition-all duration-200",
    on ? "bg-teal text-teal-ink shadow-[0_0_18px_rgb(45_212_191/0.35)]" : "bg-white/[0.05] text-subtle hover:bg-white/[0.09] hover:text-foreground");
  const used = new Set<string>();
  const groups = PERIOD_GROUPS.map((g) => {
    const items = per.presets.filter((p) => !used.has(p.id) && g.test(p.id));
    items.forEach((p) => used.add(p.id));
    return { ...g, items };
  });
  const rest = per.presets.filter((p) => !used.has(p.id));
  if (rest.length) groups.push({ label: "Other", test: () => false, items: rest });
  return (
    <div role="radiogroup" aria-labelledby="period-label" className="flex flex-col gap-3">
      {groups.filter((g) => g.items.length).map((g) => (
        <div key={g.label}>
          <p className="mb-1.5 text-[11.5px] font-medium tracking-[0.08em] text-faint uppercase">{g.label}</p>
          <div className="flex flex-wrap gap-1.5">
            {g.items.map((p) => (
              <button key={p.id} type="button" role="radio" aria-checked={value === p.id} onClick={() => onPick(p.id)} className={chip(value === p.id)}>
                {p.label.replace(/ \(two weeks\)/, "")}
              </button>
            ))}
            {g.label === "Recent" && (
              <button type="button" role="radio" aria-checked={value === "custom"} onClick={() => onPick("custom")} className={chip(value === "custom")}>
                Custom dates
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Official AQI only: search CPCB's bulletin cities and add one to the comparison. */
function CityAdder({ selected, onAdd, full }: { selected: string[]; onAdd: (c: string) => void; full: boolean }) {
  const [all, setAll] = useState<CpcbCity[] | null>(null);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(0);
  useEffect(() => {
    let live = true;
    getCpcbCities().then((d) => { if (live) setAll(d.cities); }).catch(() => { if (live) setAll([]); });
    return () => { live = false; };
  }, []);
  const hits = all ? searchCpcb(all, q, 8).filter((c) => !selected.includes(c.city)).slice(0, 6) : [];
  const show = open && q.trim().length > 0;
  const add = (c: CpcbCity) => { onAdd(c.city); setQ(""); setOpen(false); };
  return (
    <div className="relative mb-3">
      <div className={cn("flex h-10 items-center gap-2 rounded-xl bg-white/[0.05] px-3 transition-shadow focus-within:ring-1 focus-within:ring-teal", full && "opacity-50")}>
        <Search className="size-4 shrink-0 text-faint" aria-hidden />
        <input role="combobox" aria-expanded={show} aria-controls="compare-city-list" aria-autocomplete="list" aria-label="Add any CPCB bulletin city"
          aria-activedescendant={show && hits[at] ? `cmp-opt-${at}` : undefined} disabled={full}
          value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); setAt(0); }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setAt((a) => Math.min(a + 1, hits.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setAt((a) => Math.max(a - 1, 0)); }
            else if (e.key === "Enter" && hits[at]) { e.preventDefault(); add(hits[at]); }
            else if (e.key === "Escape") setOpen(false);
          }}
          onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 120)}
          placeholder={full ? "Six cities selected" : "Add any city, e.g. Lucknow"} autoComplete="off"
          className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-faint" />
        <Plus className="size-4 shrink-0 text-faint" aria-hidden />
      </div>
      {show && (
        <ul id="compare-city-list" role="listbox" aria-label="Bulletin cities"
          className="sq-pop absolute inset-x-0 top-[calc(100%+6px)] z-30 rounded-xl border border-line-strong bg-[#0d1528] p-1 shadow-float">
          {!all ? <li className="px-3 py-2 text-[13.5px] text-subtle">Loading the bulletin cities…</li>
            : hits.length === 0 ? <li className="px-3 py-2 text-[13.5px] text-subtle">No bulletin city matches “{q}”.</li>
            : hits.map((c, k) => {
              const cat = cpcbCategory(c);
              return (
                <li key={c.city} id={`cmp-opt-${k}`} role="option" aria-selected={k === at}
                  onMouseDown={(e) => { e.preventDefault(); add(c); }} onMouseEnter={() => setAt(k)}
                  className={cn("flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px]", k === at && "bg-white/[0.07]")}>
                  <MapPin className="size-3.5 shrink-0 text-faint" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{c.city}</span>
                  <span className="num font-semibold">{c.aqi}</span>
                  <span aria-hidden className="size-2.5 rounded-full" style={{ background: cat ? CATEGORY_STYLE[cat].bg : "#64748B" }} />
                </li>
              );
            })}
        </ul>
      )}
    </div>
  );
}
