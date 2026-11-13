"use client";

// The right-hand panel for one answer: "Evidence" (chart, evidence table, how the answer was made) and "Data"
// (the values used). Clicking a highlighted number swaps the panel to that number's proof, with a Back button,
// so the proof never covers the answer. On phones the same content sits under the answer and the proof is a sheet.
import { ArrowLeft, Check } from "lucide-react";
import { useState } from "react";
import { CategoryBadge, ScaleBar } from "@/components/ds/data-display";
import { EmptyNote } from "@/components/ds/states";
import type { Turn } from "@/lib/chat-state";
import { chartTable } from "@/lib/chart-data";
import { evidenceFor } from "@/lib/evidence";
import { readable } from "@/lib/format";
import { fmtNumber } from "@/lib/key-numbers";
import type { Proof } from "@/lib/proof";
import { cn } from "@/lib/utils";
import { ChartPanel, DataTable } from "./answer-parts";
import { StepsSummary } from "./live-steps";

export function EvidencePanel({ turn, className }: { turn: Turn; className?: string }) {
  const [tab, setTab] = useState<"evidence" | "data">("evidence");
  const a = turn.answer;
  if (!a) return null;
  const ev = evidenceFor(turn);
  const dataType = (a.data_types.length > 1 ? "mixed" : a.data_types[0]) ?? null;
  const table = chartTable(turn.chart);
  const rows: [string, string | null][] = [
    ["Data", ev.dataType], ["Period", ev.period], ["Stations", ev.stationsDetail ?? ev.stations],
    ["Coverage", ev.coverageDetail ?? ev.coverageText], ["Source", ev.source],
    ["Checked", a.verification?.numbers_checked ? (a.verification.numbers_checked === 1 ? "The 1 number matches the analysis" : `All ${a.verification.numbers_checked} numbers match the analysis`) : null],
  ];
  return (
    <div className={cn("flex min-h-0 min-w-0 flex-col", className)}>
      <div role="tablist" aria-label="Evidence or data" className="flex gap-1 border-b border-line px-4 pt-3">
        {(["evidence", "data"] as const).map((k) => (
          <button key={k} role="tab" type="button" aria-selected={tab === k} onClick={() => setTab(k)}
            className={cn("-mb-px border-b-2 px-3 pb-2.5 text-[13.5px] font-medium", tab === k ? "border-teal text-foreground" : "border-transparent text-subtle hover:text-foreground")}>
            {k === "evidence" ? "Evidence" : "Data"}
          </button>
        ))}
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-5 overflow-y-auto p-4" role="tabpanel">
        {tab === "evidence" ? (
          <>
            {turn.chart && turn.chart.series?.some((s) => s.data.length > 0) ? (
              <ChartPanel spec={turn.chart} dataType={dataType} answerText={a.headline || a.text} compact />
            ) : (
              <EmptyNote title="No chart for this answer" hint="Ask about a period (for example “over the last 30 days”) to get a chart." />
            )}
            <dl className="grid grid-cols-[96px_1fr] overflow-hidden rounded-xl border border-line text-[13px]">
              {rows.filter(([, v]) => v).map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="border-b border-line bg-white/[0.02] px-3 py-2 text-faint last-of-type:border-0">{k}</dt>
                  <dd className="border-b border-line px-3 py-2 last-of-type:border-0">{readable(v)}</dd>
                </div>
              ))}
            </dl>
            <StepsSummary turn={turn} />
          </>
        ) : (
          <>
            {turn.cards.length > 0 && (
              <section>
                <h3 className="mb-2 text-[12px] font-medium tracking-wide text-faint uppercase">Values in the answer</h3>
                <ul className="flex flex-col gap-1.5 text-[13px]">
                  {turn.cards.map((c) => (
                    <li key={c.field} className="flex justify-between gap-3 rounded-lg border border-line px-3 py-2">
                      <span className="text-subtle">{readable(c.label)}</span>
                      <span className="num shrink-0 font-semibold">{fmtNumber(c)} <span className="font-normal text-faint">{/index/i.test(c.unit) ? "AQI" : c.unit}</span></span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {table.rows.length > 0 ? (
              <DataTable columns={table.columns} rows={table.rows.map((r) => r.map((x) => (typeof x === "string" ? readable(x) : x)))} caption={readable(turn.chart?.title ?? "Values")} />
            ) : turn.cards.length === 0 ? (
              <EmptyNote title="No data table for this answer" hint="This answer has no values to list. The Evidence tab says why." />
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

/** onBack: shows a Back button (desktop panel). The phone sheet has its own close button. */
export function ProofView({ proof, onBack, backLabel = "Back to evidence" }: { proof: Proof; onBack?: () => void; backLabel?: string }) {
  return (
    <div className="flex flex-col gap-4" aria-label={`Proof: ${proof.title}`}>
      {onBack && (
        <button type="button" onClick={onBack} className="inline-flex min-h-9 items-center gap-1.5 self-start rounded-full text-[13px] text-subtle hover:text-foreground">
          <ArrowLeft className="size-4" aria-hidden />{backLabel}
        </button>
      )}
      <div>
        <p className="text-[11px] font-semibold tracking-[0.08em] text-teal uppercase">Proof</p>
        <h2 className="mt-1 font-display text-[26px] leading-tight">{proof.title}</h2>
      </div>
      <p className="flex items-baseline gap-2">
        <span className="num text-[44px] leading-none font-medium">{proof.value}</span>
        <span className="text-sm text-subtle">{proof.unit}</span>
        {proof.category && <CategoryBadge category={proof.category} className="ml-auto" label="Category" />}
      </p>
      {proof.scale && <ScaleBar value={proof.raw} scale={proof.scale} />}
      <section>
        <h3 className="mb-1.5 text-[11px] font-medium tracking-wide text-faint uppercase">How it was worked out</h3>
        <p className="rounded-xl border border-line bg-white/[0.03] px-3.5 py-3 text-[14px] leading-6">{proof.how}</p>
      </section>
      {proof.rows.length > 0 && (
        <section>
          <h3 className="mb-1.5 text-[11px] font-medium tracking-wide text-faint uppercase">{proof.rows.some((r) => r.title.startsWith("Bulletin")) ? "Bulletins used" : "Rows used"}</h3>
          <ul className="flex flex-col gap-1.5">
            {proof.rows.map((r) => (
              <li key={r.title} className="grid grid-cols-[1fr_auto] gap-x-3 rounded-xl border border-line px-3.5 py-2.5 text-[13px]">
                <span className="font-medium">{r.title}</span>
                <span className="num text-right text-[17px] font-semibold">{r.value}</span>
                <span className="text-faint">{r.sub}</span>
                <span className="text-right text-[12px] text-subtle">{r.category ?? ""}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section>
        <h3 className="mb-1.5 text-[11px] font-medium tracking-wide text-faint uppercase">About this number</h3>
        <dl className="grid grid-cols-[96px_1fr] gap-x-3 gap-y-1.5 text-[13px]">
          {proof.facts.map(([k, v]) => (
            <div key={k} className="contents"><dt className="text-faint">{k}</dt><dd>{readable(v)}</dd></div>
          ))}
        </dl>
      </section>
      <p className="flex items-start gap-2.5 rounded-xl border border-teal/35 bg-teal/[0.07] px-3.5 py-3 text-[13px]">
        <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-teal/20 text-teal"><Check className="size-3" aria-hidden /></span>
        {proof.check}
      </p>
    </div>
  );
}
