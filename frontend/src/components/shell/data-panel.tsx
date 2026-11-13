"use client";

// "Data & accuracy": short, plain facts only. Sources, cities and stations, latest dates, and the stored
// first-pass evaluation scores (read from /api/accuracy; never recomputed here).
import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ds/states";
import { getAccuracy } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import type { EvalSummary, Scoreboard } from "@/lib/types";
import { useApp } from "./app-context";

const SETS: { key: string; name: string; note: string }[] = [
  { key: "main", name: "Main question set", note: "trends, comparisons, Diwali, weather, unusual days and trick questions" },
  { key: "holdout2", name: "Unseen questions", note: "kept apart and never used to tune the app" },
  { key: "diwali2026", name: "Diwali 2026 questions", note: "added after the Diwali 2026 bulletins arrived" },
];

export function DataPanel({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { health, latest } = useApp();
  const [board, setBoard] = useState<Scoreboard | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open || board) return;
    let active = true;
    getAccuracy().then((b) => active && setBoard(b)).catch(() => active && setFailed(true));
    return () => { active = false; };
  }, [open, board]);

  const w = health?.data_windows ?? {};
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[min(420px,100vw)] overflow-y-auto border-line bg-surface p-0">
        <SheetHeader className="border-b border-line px-5 py-4">
          <SheetTitle className="font-display text-[28px] leading-8 font-normal">Data &amp; accuracy</SheetTitle>
          <SheetDescription className="text-[13px] text-subtle">Where the numbers come from and how well the answers are checked.</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-6 px-5 py-5 text-sm">
          <Section title="Sources">
            <ul className="flex flex-col gap-2.5">
              <Fact k="Measured PM2.5 and PM10" v={`CPCB monitoring stations, via OpenAQ${w.measured_start ? ` · ${fmtDate(w.measured_start)} to ${fmtDate(w.measured_end)}` : ""}`} />
              <Fact k="Official AQI" v={`CPCB daily city bulletins${w.aqi_end ? ` · to ${fmtDate(w.aqi_end)}` : ""}`} />
              <Fact k="Weather (modelled)" v={`Open-Meteo, reanalysis from Copernicus C3S${w.weather_end ? ` · to ${fmtDate(w.weather_end)}` : ""}`} />
            </ul>
          </Section>

          <Section title="Cities and stations">
            {latest ? (
              <>
                <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                  {[...latest.cities].sort((a, b) => a.city.localeCompare(b.city)).map((c) => (
                    <li key={c.city} className="flex justify-between gap-2">
                      <span>{c.city}</span>
                      <span className="num text-subtle">{c.primary_stations} stations</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-[13px] text-faint">
                  Reference monitors only. Latest available day: <span className="text-subtle">{fmtDate(latest.date)}</span>.
                </p>
              </>
            ) : (
              <Skeleton className="h-16" />
            )}
          </Section>

          <Section title="How accurate are the answers?">
            <p className="mb-3 text-[13px] text-subtle">
              Python calculates every number. Before an answer is shown, each number in it is checked against the calculation.
              These are first-pass test results, as recorded:
            </p>
            {failed ? (
              <p className="text-[13px] text-faint">The test results could not be loaded right now.</p>
            ) : !board ? (
              <Skeleton className="h-28" />
            ) : (
              <ul className="flex flex-col gap-2">
                {SETS.map((s) => {
                  const run = board.sets[s.key]?.main_first_pass;
                  if (!run) return null;
                  const o: EvalSummary = (run.summary.overall ?? run.summary) as EvalSummary;
                  return (
                    <li key={s.key} className="rounded-xl border border-line bg-white/[0.02] px-3.5 py-3">
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="font-medium">{s.name}</p>
                        <p className="num text-base font-semibold">{o.pass} of {o.turns}</p>
                      </div>
                      <p className="text-[12.5px] text-faint">{s.note}</p>
                      <p className="mt-1.5 text-[12.5px] text-subtle">
                        {o.pass_pct}% passed
                        {o.numbers_traceable_pct != null && <> · {o.numbers_traceable_pct}% of numbers traced to the data</>}
                        {" · "}{fmtDate(run.started.slice(0, 10))}
                      </p>
                    </li>
                  );
                })}
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

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <li>
      <p className="font-medium">{k}</p>
      <p className="text-[13px] text-subtle">{v}</p>
    </li>
  );
}
