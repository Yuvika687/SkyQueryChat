"use client";

// City page: everything about one city's air from real monitoring data. No AI on this page; every figure
// comes from the read-only /api/city endpoint (the same Python analysis the Ask answers use).
import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowRight, ChevronLeft, ChevronRight, MapPin } from "lucide-react";
import { LazyChart } from "@/components/chart/lazy-chart";
import { askHref } from "@/components/ds/ask-box";
import { CategoryBadge, ScaleBar, categoryOf } from "@/components/ds/data-display";
import { DataGate } from "@/components/ds/data-state";
import { Section, Segmented } from "@/components/ds/section";
import { CATEGORY_STYLE, normaliseCategory } from "@/lib/categories";
import { buildOption } from "@/lib/chart-options";
import { fmtDate, fmtSpan } from "@/lib/format";
import { getCityPage, type CityPage, type DayValue } from "@/lib/pages-api";
import { trendText } from "@/lib/trend-text";
import type { ChartSpec } from "@/lib/types";
import { useBackendData } from "@/lib/use-backend-data";
import { cn } from "@/lib/utils";

export function CityScreen({ slug, city }: { slug: string; city: string }) {
  const state = useBackendData((sig) => getCityPage(slug, sig), slug);
  return (
    <div className="mx-auto w-full max-w-[1240px] px-4 pt-[84px] pb-[calc(104px+env(safe-area-inset-bottom))] sm:px-8 md:pt-[104px] md:pb-12">
      <header className="mb-6">
        <p className="text-[12px] font-semibold tracking-[0.08em] text-teal uppercase">City</p>
        <h1 className="mt-1 font-display text-[48px] leading-none sm:text-[64px]">{city}</h1>
        <p className="mt-3 text-[16px] text-subtle">Everything about {city}&apos;s air, from real monitoring data.</p>
        <p className="mt-1 text-[13.5px] text-faint">Scroll for the last 30 days, a calendar, Diwali and the stations; each section says where its numbers come from.</p>
      </header>
      <DataGate state={state} what={`${city} page`}>
        {(d) => <CityBody d={d} />}
      </DataGate>
    </div>
  );
}

function CityBody({ d }: { d: CityPage }) {
  return (
    <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-12">
      <Hero d={d} className="lg:col-span-5" />
      <Trend30 d={d} className="lg:col-span-7" />
      <Calendar d={d} className="lg:col-span-6" />
      <Weather d={d} className="lg:col-span-6" />
      <Diwali d={d} className="lg:col-span-12" />
      <Unusual d={d} className="lg:col-span-12" />
      <Stations d={d} className="lg:col-span-12" />
    </div>
  );
}

// ------------------------------------------------------------------ hero
function Hero({ d, className }: { d: CityPage; className?: string }) {
  const h = d.hero;
  const cat = categoryOf(h.pm25, "pm25");
  return (
    <section aria-labelledby="hero-title" className={cn("glass relative flex flex-col overflow-hidden rounded-2xl p-5 shadow-card sm:p-6", className)}>
      <div aria-hidden className="pointer-events-none absolute -top-24 -right-24 size-64 rounded-full bg-teal/10 blur-3xl" />
      <h2 id="hero-title" className="text-[13px] text-subtle">
        PM2.5 · 24-hour city average · latest available, <strong className="font-semibold text-foreground">{fmtDate(h.date)}</strong>
      </h2>
      <p className="mt-4 flex flex-wrap items-baseline gap-x-2 gap-y-2">
        <span className="num text-[64px] leading-none font-medium tracking-tight">{h.pm25.toFixed(1)}</span>
        <span className="text-[15px] text-subtle">µg/m³</span>
        <CategoryBadge category={cat} label="PM2.5 category" className="ml-auto" />
      </p>
      <ScaleBar value={h.pm25} scale="pm25" className="mt-5" />
      <dl className="mt-6 grid grid-cols-3 gap-3 border-t border-line pt-4 text-[13px]">
        <div><dt className="text-faint">PM10</dt><dd className="num mt-0.5 text-[17px] font-semibold">{h.pm10.toFixed(1)} <span className="text-[12px] font-normal text-subtle">µg/m³</span></dd></div>
        <div><dt className="text-faint">Stations reporting</dt><dd className="num mt-0.5 text-[17px] font-semibold">{h.stations_reporting} <span className="text-[12px] font-normal text-subtle">of {h.stations_total}</span></dd></div>
        <div><dt className="text-faint">Among six cities</dt><dd className="mt-0.5 text-[17px] font-semibold">{h.rank_of_six === 1 ? "Highest" : h.rank_of_six === 6 ? "Lowest" : `${ordinal(h.rank_of_six)} highest`}</dd></div>
      </dl>
      <p className="mt-4 text-[12px] text-faint">Measured at reference monitors ({d.source}).</p>
      <AskChips city={d.city} className="mt-auto pt-5" />
    </section>
  );
}

const ordinal = (n: number) => `${n}${n === 2 ? "nd" : n === 3 ? "rd" : "th"}`;

// ------------------------------------------------------------------ 30 days
function lineSpec(city: string, pol: "pm25" | "pm10", days: DayValue[]): ChartSpec {
  const name = pol === "pm25" ? "PM2.5" : "PM10";
  return { type: "line", title: `${city} ${name}, daily`, x: { field: "date", type: "time" }, y: { field: "value", label: `${name} (µg/m³)` },
    series: [{ name: city, data: days.map((x) => [x.date, x.value]) }], units: "µg/m³" };
}

function Trend30({ d, className }: { d: CityPage; className?: string }) {
  const [pol, setPol] = useState<"pm25" | "pm10">("pm25");
  const days = d.trend30[pol];
  const option = useMemo(() => buildOption(lineSpec(d.city, pol, days), "measured"), [d.city, pol, days]);
  const gaps = days.filter((x) => x.value == null).length;
  const t = trendText(d.trend30.trend);
  return (
    <Section id="t30" title="Last 30 days" className={className}
      line={<>Daily city average, {fmtSpan(d.trend30.start, d.trend30.end)}. {gaps ? `${gaps} days without enough stations are left as gaps.` : "Every day has a value."}</>}
      action={<Segmented label="Pollutant" value={pol} onChange={setPol} options={[{ value: "pm25", label: "PM2.5" }, { value: "pm10", label: "PM10" }]} />}>
      <LazyChart option={option} height={300} ariaLabel={`${d.city} ${pol === "pm25" ? "PM2.5" : "PM10"} by day, ${fmtSpan(d.trend30.start, d.trend30.end)}`} />
      <p className="mt-3 text-[13px] text-subtle"><strong className="font-semibold text-foreground">PM2.5 trend: {t.short}.</strong> {t.detail}. Mann-Kendall test with Sen&apos;s slope.</p>
    </Section>
  );
}

// ------------------------------------------------------------------ calendar heatmap
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function Calendar({ d, className }: { d: CityPage; className?: string }) {
  const months = useMemo(() => {
    const m = new Map<string, DayValue[]>();
    for (const x of d.calendar.days) {
      const k = x.date.slice(0, 7);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(x);
    }
    return [...m.entries()].filter(([, v]) => v.some((x) => x.value != null));
  }, [d.calendar.days]);
  const [i, setI] = useState(months.length - 1);
  const [key, days] = months[Math.min(i, months.length - 1)];
  const [y, mo] = key.split("-").map(Number);
  const lead = (new Date(Date.UTC(y, mo - 1, 1)).getUTCDay() + 6) % 7;
  const label = `${MONTHS[mo - 1]} ${y}`;
  const withData = days.filter((x) => x.value != null).length;
  return (
    <Section id="cal" title="Calendar" className={className}
      line="Daily PM2.5 for each month with data. Grey days had too few stations for a city value."
      action={
        <div className="flex items-center gap-1">
          <button type="button" aria-label="Previous month" disabled={i === 0} onClick={() => setI(i - 1)}
            className="grid size-9 place-items-center rounded-lg border border-line text-subtle hover:text-foreground disabled:opacity-40"><ChevronLeft className="size-4" aria-hidden /></button>
          <label className="sr-only" htmlFor="cal-month">Month</label>
          <select id="cal-month" value={i} onChange={(e) => setI(Number(e.target.value))}
            className="h-9 rounded-lg border border-line bg-surface px-2 text-[13px]">
            {months.map(([k], j) => { const [yy, mm] = k.split("-").map(Number); return <option key={k} value={j}>{MONTHS[mm - 1]} {yy}</option>; })}
          </select>
          <button type="button" aria-label="Next month" disabled={i >= months.length - 1} onClick={() => setI(i + 1)}
            className="grid size-9 place-items-center rounded-lg border border-line text-subtle hover:text-foreground disabled:opacity-40"><ChevronRight className="size-4" aria-hidden /></button>
        </div>
      }>
      <table className="w-full table-fixed border-separate border-spacing-1">
        <caption className="sr-only">{`${d.city} daily PM2.5, ${label}. ${withData} days with a value.`}</caption>
        <thead><tr>{WEEKDAYS.map((w) => <th key={w} scope="col" className="pb-1 text-[11px] font-medium text-faint">{w}</th>)}</tr></thead>
        <tbody>
          {Array.from({ length: Math.ceil((lead + days.length) / 7) }, (_, row) => (
            <tr key={row}>
              {Array.from({ length: 7 }, (_, col) => {
                const k = row * 7 + col - lead;
                const x = days[k];
                if (!x) return <td key={col} />;
                const cat = x.value == null ? null : categoryOf(x.value, "pm25");
                const st = cat ? CATEGORY_STYLE[cat] : null;
                return (
                  <td key={col} className="p-0">
                    <div title={`${fmtDate(x.date)}: ${x.value == null ? "no city value" : `${x.value.toFixed(1)} µg/m³, ${st!.label}`}`}
                      aria-label={`${fmtDate(x.date)}: ${x.value == null ? "no city value" : `${x.value.toFixed(1)} µg/m³, ${st!.label}`}`}
                      className={cn("flex aspect-square flex-col justify-between rounded-md p-1 text-[10.5px] leading-none sm:p-1.5 sm:text-[11px]",
                        !st && "bg-white/[0.05] text-faint", cat === "Severe" && "ring-1 ring-white/35 ring-inset")}
                      style={st ? { background: st.bg, color: st.fg } : undefined}>
                      <span>{Number(x.date.slice(8))}</span>
                      <span className="num hidden self-end font-semibold sm:block">{x.value == null ? "" : Math.round(x.value)}</span>
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5 text-[11.5px] text-subtle" aria-label="Colour key">
        {(["Good", "Satisfactory", "Moderate", "Poor", "Very poor", "Severe"] as const).map((c) => (
          <li key={c} className="flex items-center gap-1.5"><span aria-hidden className="size-2.5 rounded-sm" style={{ background: CATEGORY_STYLE[c].bg }} />{CATEGORY_STYLE[c].label}</li>
        ))}
        <li className="flex items-center gap-1.5"><span aria-hidden className="size-2.5 rounded-sm bg-white/[0.12]" />No city value</li>
      </ul>
    </Section>
  );
}

// ------------------------------------------------------------------ Diwali
function Diwali({ d, className }: { d: CityPage; className?: string }) {
  return (
    <Section id="diwali" title="Diwali" className={className}
      line="Official AQI from CPCB's 4 PM bulletins. Diwali night shows in the next day's bulletin, so the festival level is the mean of the two bulletins after Diwali.">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {d.diwali.years.map((y) => {
          const cat = normaliseCategory(y.category);
          return (
            <article key={y.year} className="min-w-0 rounded-xl border border-line bg-white/[0.02] p-4">
              <h3 className="flex items-baseline justify-between gap-2">
                <span className="font-display text-[22px]">Diwali {y.year}</span>
                <span className="text-[12px] text-faint">{fmtDate(y.diwali_date)}</span>
              </h3>
              {y.status === "ok" && y.level != null ? (
                <>
                  <p className="mt-2 flex items-baseline gap-2">
                    <span className="num text-[34px] leading-none font-medium">{y.level}</span>
                    <span className="text-[13px] text-subtle">AQI</span>
                    <CategoryBadge category={cat} size="sm" className="ml-auto" label="AQI category" />
                  </p>
                  <ul className="mt-3 flex flex-col gap-1.5 text-[12.5px]">
                    {y.bulletins.map((b) => (
                      <li key={b.date} className="flex items-start justify-between gap-3 rounded-lg bg-white/[0.03] px-2.5 py-1.5">
                        <span className="min-w-0"><span className="font-medium">Bulletin {fmtDate(b.date)}</span><br />
                          <span className="text-faint">4 PM {fmtDate(b.evening_of)} – 4 PM {fmtDate(b.date)}</span></span>
                        <span className="num shrink-0 text-[15px] font-semibold">{Math.round(b.aqi)}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-3 text-[12.5px] text-subtle">
                    Week before: <span className="num font-semibold text-foreground">{y.week_before}</span> AQI.
                    {y.change_range_pct && <> Change from the week before: <span className="num font-semibold text-foreground">{signed(y.change_range_pct[0])}% to {signed(y.change_range_pct[1])}%</span>, depending on which baseline week is used.</>}
                  </p>
                </>
              ) : (
                <p className="mt-3 text-[13px] text-subtle">Official AQI for this Diwali is not available.</p>
              )}
            </article>
          );
        })}
      </div>
      <p className="mt-3 text-[12px] text-faint">AQI is an index of several pollutants, not a PM2.5 or PM10 concentration. Source: {d.diwali.source}. The rise is timing only, not proof of what caused it.</p>
      {d.diwali.pm_context && (
        <div className="mt-4 rounded-xl border border-warn/30 bg-warn/[0.06] p-4">
          <h3 className="text-[14px] font-semibold">Delhi measured PM2.5 around Diwali (supporting context only)</h3>
          <ul className="mt-2 flex flex-col gap-1.5 text-[13px]">
            {d.diwali.pm_context.filter((p) => p.festival_pm25 != null).map((p) => (
              <li key={p.year}>
                <strong>{p.year}:</strong> festival-day mean <span className="num font-semibold">{p.lower_bound ? "at least " : ""}{p.festival_pm25} µg/m³</span>
                {p.lower_bound
                  ? ` (lower bound: values above 999 µg/m³ are blank in this source${p.blank_share_diwali_night != null ? `; ${p.blank_share_diwali_night}% of Diwali-night readings blank` : ""})`
                  : " (OpenAQ; not comparable with 2024 or 2025, which came from a different source and station panel)"}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[12px] text-subtle">No percentage change is given for PM: the blank share differs between years.</p>
        </div>
      )}
    </Section>
  );
}

const signed = (v: number) => (v > 0 ? `+${v}` : v < 0 ? `−${Math.abs(v)}` : "0");

// ------------------------------------------------------------------ unusual days
function Unusual({ d, className }: { d: CityPage; className?: string }) {
  const days = d.unusual.days;
  return (
    <Section id="unusual" title="Unusual days" className={className}
      line={`Days far from the 15-day median of their neighbours (PM2.5; ${d.unusual.tested} days tested). The 12 most recent are shown.`}>
      {days.length === 0 ? <p className="text-[13px] text-subtle">No unusual days were flagged.</p> : (
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {days.map((u) => {
            const tags = u.reason.split("; ").slice(1);
            return (
              <li key={u.date} className="rounded-xl border border-line px-3.5 py-2.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-medium">{fmtDate(u.date)}</span>
                  <span className="num text-[15px] font-semibold">{u.value.toFixed(1)} <span className="text-[11.5px] font-normal text-subtle">µg/m³</span></span>
                </div>
                <p className="mt-0.5 text-[12.5px] text-subtle">{u.direction === "unusually high" ? "Unusually high" : "Unusually low"}; the 15-day median was {u.median.toFixed(1)}.</p>
                {tags.length > 0 && <p className="mt-1.5 flex flex-wrap gap-1.5">{tags.map((t) => (
                  <span key={t} className={cn("rounded-md px-1.5 py-0.5 text-[11.5px]", /Diwali/.test(t) ? "bg-teal/15 text-teal" : "bg-white/[0.05] text-subtle")}>{t}</span>
                ))}</p>}
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-3 text-[12px] text-faint">Flags come from the data only; they do not say what caused a day.</p>
    </Section>
  );
}

// ------------------------------------------------------------------ weather association
function Weather({ d, className }: { d: CityPage; className?: string }) {
  const [v, setV] = useState<"rainfall" | "wind speed">("rainfall");
  const w = d.weather[v];
  const option = useMemo(() => buildOption(w.chart, "measured"), [w.chart]);
  const ends = w.groups.length ? [w.groups[0], w.groups[w.groups.length - 1]] : [];
  return (
    <Section id="weather" title="Weather and air" className={className}
      line="An association, not a cause: each dot is a day; the dashed line is fitted in Python (Theil-Sen)."
      action={<Segmented label="Weather" value={v} onChange={setV} options={[{ value: "rainfall", label: "Rainfall" }, { value: "wind speed", label: "Wind" }]} />}>
      <LazyChart option={option} height={240} ariaLabel={`${d.city}: daily PM2.5 against ${v}`} />
      {w.rho != null && (
        <p className="mt-3 text-[13px]">
          <strong className="font-semibold">{cap(w.strength ?? "")} association</strong>: Spearman ρ <span className="num">{fmtSigned(w.rho)}</span>
          {w.range[0] != null && <> (95% range <span className="num">{fmtSigned(w.range[0])}</span> to <span className="num">{fmtSigned(w.range[1]!)}</span>)</>}, {w.days} days.
        </p>
      )}
      <div className="mt-2 grid grid-cols-2 gap-2">
        {ends.map((g) => (
          <div key={g.label} className="rounded-xl border border-line px-3 py-2">
            <p className="text-[12px] text-subtle">{cap(g.label.replace(/\s*\(.*\)$/, "").replace(">=", "≥"))}</p>
            <p className="num mt-0.5 text-[17px] font-semibold">{g.mean.toFixed(1)} <span className="text-[11.5px] font-normal text-subtle">µg/m³ · {g.days} days</span></p>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[12px] text-faint">Weather is modelled (Open-Meteo reanalysis); PM is measured. Season and emissions change together with weather.</p>
    </Section>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const fmtSigned = (v: number) => (v < 0 ? `−${Math.abs(v).toFixed(2)}` : v.toFixed(2));

// ------------------------------------------------------------------ stations
function Stations({ d, className }: { d: CityPage; className?: string }) {
  return (
    <Section id="stations" title="Stations" className={className}
      line="Every station with PM2.5 data in the last 30 days. Coverage is the share of those days with a 24-hour value. Open one to see it on the map.">
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {d.stations.map((s) => (
          <li key={s.id}>
            <Link href={`/explore?city=${encodeURIComponent(d.city)}&station=${s.id}`}
              className="flex min-h-14 items-center gap-3 rounded-xl border border-line px-3 py-2 transition-colors hover:border-teal/60 focus-visible:border-teal">
              <MapPin className={cn("size-4 shrink-0", s.tier === "low_cost" ? "text-warn" : "text-teal")} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-medium">{s.name.replace(/\s+-\s+[A-Z]{2,}.*$/, "")}</span>
                <span className="block text-[12px] text-faint">{s.provider} · {s.tier === "low_cost" ? "Low-cost sensor (indicative)" : s.type}</span>
              </span>
              <span className="text-right text-[12px] text-subtle"><span className="num block text-[14px] font-semibold text-foreground">{Math.round(s.coverage_pct)}%</span>coverage</span>
            </Link>
          </li>
        ))}
      </ul>
    </Section>
  );
}

// ------------------------------------------------------------------ ask
function AskChips({ city, className }: { city: string; className?: string }) {
  const qs = [
    `How has PM2.5 in ${city} changed over the last 30 days?`,
    `How bad was ${city}'s air on Diwali 2026?`,
    `Is rain associated with lower PM2.5 in ${city}?`,
  ];
  return (
    <div className={className}>
      <h3 className="mb-2 text-[13px] font-semibold">Ask about {city}</h3>
      <ul className="flex flex-col gap-1.5">
        {qs.map((q) => (
          <li key={q}>
            <Link href={askHref(q)} className="group flex min-h-11 items-center justify-between gap-3 rounded-xl border border-line bg-white/[0.02] px-3 py-2 text-[13.5px] transition-colors hover:border-teal/60">
              {q}<ArrowRight className="size-4 shrink-0 text-teal transition-transform group-hover:translate-x-0.5" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
