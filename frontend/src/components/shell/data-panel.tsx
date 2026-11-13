"use client";

// "Data & accuracy": short, plain facts only. Sources and licences, coverage, the latest date, stored first-pass
// evaluation scores (read from /api/accuracy, never recomputed here), the number checker, the CPCB cross-check and
// known limits.
import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ds/states";
import { getAccuracy, getLimits } from "@/lib/api";
import { fmtDate, fmtRange } from "@/lib/format";
import { CREDIT_ITEMS } from "@/lib/map-base";
import type { EvalSummary, Scoreboard } from "@/lib/types";
import { useApp } from "./app-context";

const SETS: { key: string; name: string; note: string; history?: string }[] = [
  { key: "main", name: "Main question set", note: "trends, comparisons, Diwali, weather, unusual days and trick questions" },
  { key: "holdout2", name: "Unseen questions", note: "kept apart and never used to tune the app" },
  { key: "holdout", name: "First unseen set", note: "retired after it was used once" },
  { key: "diwali2026", name: "Diwali 2026 questions", note: "added after the Diwali 2026 bulletins arrived" },
  { key: "analysis", name: "Statistics questions", note: "95% ranges, “too close to call”, trends and weather associations",
    history: "after fixing a trend-wording bug found in a first run of 5/8" },
];

// Limits a visitor should know about (the API also lists internal engineering notes).
const VISITOR_LIMITS = ["network_gaps", "delhi_999", "five_city_diwali_pm", "station_sets", "peer_outliers", "weather_modelled",
  "verifier_scope", "llm_quota", "diwali_2026_night_gap", "openaq_outage_oct_2026", "delhi_diwali_estimate_gap"];

const SOURCES: { k: string; v: string; licence: string; href: string }[] = [
  { k: "Measured PM2.5 and PM10", v: "CPCB reference monitors (and a few AirNow and AirGradient sensors), via the OpenAQ archive", licence: "licence set by each data provider", href: "https://openaq.org" },
  { k: "Official AQI", v: "CPCB daily city bulletins at 4 PM, via UrbanEmissions and cpcb.gov.in", licence: "GODL-India", href: "https://cpcb.gov.in/AQI_Bulletin.php" },
  { k: "Delhi PM, Diwali 2024 and 2025", v: "OpenCity Delhi station files (supporting context only)", licence: "public domain", href: "https://data.opencity.in" },
  { k: "Weather (modelled)", v: "Open-Meteo, reanalysis from Copernicus C3S", licence: "CC BY 4.0", href: "https://open-meteo.com" },
];

export function DataPanel({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { health, latest } = useApp();
  const [board, setBoard] = useState<Scoreboard | null>(null);
  const [limits, setLimits] = useState<{ id: string; title: string }[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open || board) return;
    let active = true;
    getAccuracy().then((b) => active && setBoard(b)).catch(() => active && setFailed(true));
    getLimits().then((l) => active && setLimits(l.limits)).catch(() => active && setLimits([]));
    return () => { active = false; };
  }, [open, board]);

  const w = health?.data_windows ?? {};
  const since = board?.answer_wording_since;
  const cc = board?.crosscheck?.by_city;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[min(440px,100vw)] overflow-y-auto border-line bg-surface p-0">
        <SheetHeader className="border-b border-line px-5 py-4">
          <SheetTitle className="font-display text-[28px] leading-8 font-normal">Data &amp; accuracy</SheetTitle>
          <SheetDescription className="text-[13px] text-subtle">Where the numbers come from and how well the answers are checked.</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-6 px-5 py-5 pb-[calc(24px+env(safe-area-inset-bottom))] text-sm">
          <Section title="Latest available">
            <p className="text-[13.5px]">
              {latest ? <><strong className="font-semibold">{fmtDate(latest.date)}</strong> <span className="text-subtle">is the latest day every city has a PM2.5 value.</span></> : <Skeleton className="h-5 w-48" />}
            </p>
            {w.measured_start && (
              <ul className="mt-2 flex flex-col gap-1 text-[13px] text-subtle">
                <li>Measured PM: {fmtRange(w.measured_start, w.measured_end)}</li>
                {w.aqi_end && <li>Official AQI: to {fmtDate(w.aqi_end)}</li>}
                {w.weather_end && <li>Weather: {fmtRange(w.weather_start, w.weather_end)}</li>}
              </ul>
            )}
          </Section>

          <Section title="Sources and licences">
            <ul className="flex flex-col gap-2.5">
              {SOURCES.map((s) => (
                <li key={s.k}>
                  <p className="font-medium">{s.k}</p>
                  <p className="text-[13px] text-subtle">{s.v} · <a className="underline underline-offset-2 hover:text-teal" href={s.href} target="_blank" rel="noreferrer">{s.licence}</a></p>
                </li>
              ))}
            </ul>
          </Section>

          <Section title="Map credits">
            <ul className="flex flex-col gap-1.5 text-[13px] text-subtle">
              {CREDIT_ITEMS.map((c) => (
                <li key={c.label}>
                  <span className="text-foreground">{c.label}:</span>{" "}
                  {c.links.map((l, k) => (
                    <span key={l.href}>{k > 0 ? ", " : ""}<a className="underline underline-offset-2 hover:text-teal" href={l.href} target="_blank" rel="noreferrer">{l.text}</a></span>
                  ))}
                  {c.licence && <> ({c.licence})</>}
                </li>
              ))}
            </ul>
          </Section>

          <Section title="Cities and stations">
            {latest ? (
              <>
                <ul className="grid grid-cols-1 gap-x-4 gap-y-1.5 min-[420px]:grid-cols-2">
                  {[...latest.cities].sort((a, b) => a.city.localeCompare(b.city)).map((c) => (
                    <li key={c.city} className="flex justify-between gap-2">
                      <span>{c.city}</span>
                      <span className="num text-subtle">{c.primary_stations} stations</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-[13px] text-faint">Reference monitors used for city averages. Low-cost sensors are shown on the map but kept out of averages.</p>
              </>
            ) : <Skeleton className="h-16" />}
          </Section>

          <Section title="How numbers are checked">
            <p className="text-[13px] text-subtle">Python calculates every number; the AI only writes the words around them.</p>
            <p className="mt-1 text-[13px] text-subtle">Before an answer is shown, each number and date in it is matched against the calculation; anything that doesn&apos;t match is sent back to be corrected.</p>
          </Section>

          <Section title="Test results">
            <p className="mb-3 text-[13px] text-subtle">First-pass results: one complete run of each question set, as recorded.</p>
            {failed ? <p className="text-[13px] text-faint">The test results could not be loaded right now.</p> : !board ? <Skeleton className="h-28" /> : (
              <ul className="flex flex-col gap-2">
                {SETS.map((s) => {
                  const run = board.sets[s.key]?.main_first_pass;
                  if (!run) return null;
                  const o: EvalSummary = (run.summary.overall ?? run.summary) as EvalSummary;
                  const day = run.started.slice(0, 10);
                  const older = since && day < since;
                  return (
                    <li key={s.key} className="rounded-xl border border-line bg-white/[0.02] px-3.5 py-3">
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="font-medium">{s.name}</p>
                        <p className="num text-base font-semibold">{o.pass}/{o.turns}</p>
                      </div>
                      {s.history && <p className="text-[12.5px] text-subtle">{o.pass}/{o.turns} ({s.history})</p>}
                      <p className="text-[12.5px] text-faint">{s.note}</p>
                      <p className="mt-1.5 text-[12.5px] text-subtle">
                        {o.pass_pct}% passed
                        {o.numbers_traceable_pct != null && <> · {o.numbers_traceable_pct}% of numbers traced to the data</>}
                        {" · "}{fmtDate(day)}{older ? " (earlier answer wording)" : ""}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>

          {cc && (
            <Section title="Cross-check with CPCB">
              <p className="mb-2 text-[13px] text-subtle">An AQI estimated from our PM data alone, compared with CPCB&apos;s official AQI on the same days (a data check; never shown as AQI).</p>
              <p className="mb-1.5 text-[12px] text-faint">Share of days within 20% of the official value:</p>
              <ul className="flex flex-col gap-1 text-[13px]">
                {Object.entries(cc).sort(([a], [b]) => a.localeCompare(b)).map(([c, v]) => (
                  <li key={c} className="flex justify-between gap-2"><span>{c}</span><span className="num text-subtle">{v.within_20pct}% of {v.days} days</span></li>
                ))}
              </ul>
            </Section>
          )}

          <Section title="Known limits">
            {!limits ? <Skeleton className="h-20" /> : (
              <ul className="flex list-disc flex-col gap-1.5 pl-4 text-[13px] text-subtle marker:text-faint">
                {limits.filter((l) => VISITOR_LIMITS.includes(l.id)).map((l) => <li key={l.id}>{l.title}</li>)}
                <li>Weather results are associations, never causes.</li>
                <li>The free server sleeps when idle; the first visit can take about a minute.</li>
              </ul>
            )}
          </Section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2.5 text-xs font-medium tracking-wide text-faint uppercase">{title}</h3>
      {children}
    </section>
  );
}
