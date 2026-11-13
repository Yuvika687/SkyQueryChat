"use client";

// The answer: data-type badge, period, "N numbers checked", the model's headline with clickable numbers, key
// numbers with category and scale bar, the short explanation, notes and follow-ups that ask at once.
import { ArrowUpRight, Check } from "lucide-react";
import { useMemo } from "react";
import { CategoryBadge, ScaleBar } from "@/components/ds/data-display";
import type { Turn } from "@/lib/chat-state";
import { evidenceFor } from "@/lib/evidence";
import { followUps } from "@/lib/followups";
import { readable } from "@/lib/format";
import { keyNumbers } from "@/lib/key-numbers";
import { segments, targetsFor, type Target } from "@/lib/proof";
import { cn } from "@/lib/utils";

const TYPE_LABEL: Record<string, string> = {
  measured: "Measured PM", official_aqi: "Official AQI", modelled: "Weather association", mixed: "Measured PM + weather",
};

export function NumberText({ text, targets, onProof, active, className }: {
  text: string; targets: Target[]; onProof: (t: Target) => void; active: string | null; className?: string;
}) {
  const segs = useMemo(() => segments(readable(text), targets), [text, targets]);
  return (
    <p className={className}>
      {segs.map((s, i) =>
        s.target ? (
          <button
            key={i}
            type="button"
            onClick={() => onProof(s.target!)}
            aria-haspopup="dialog"
            aria-pressed={active === s.target.id}
            title="See where this number came from"
            className={cn("num rounded-[5px] px-0.5 font-semibold text-foreground underline decoration-teal decoration-dashed decoration-[1.5px] underline-offset-4",
              "hover:bg-teal/15 hover:decoration-solid", active === s.target.id && "bg-teal/20 decoration-solid")}
          >
            {s.text}
          </button>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </p>
  );
}

export function AnswerCard({ turn, onProof, activeProof, onAsk, busy }: {
  turn: Turn; onProof: (t: Target) => void; activeProof: string | null; onAsk: (q: string) => void; busy: boolean;
}) {
  const a = turn.answer!;
  const ev = evidenceFor(turn);
  const targets = useMemo(() => targetsFor(turn), [turn]);
  const keys = keyNumbers(turn.cards);
  const typeKey = (a.data_types.length > 1 ? "mixed" : a.data_types[0]) ?? null;
  const checked = a.verification?.numbers_checked;
  const lead = a.headline || a.text;
  const explanation = a.method !== undefined ? a.explanation : "";
  const fups = followUps(turn);
  const notes = (a.required_warnings ?? []).map((w) => w.text);
  return (
    <div className="glass flex flex-col gap-4 rounded-3xl p-5 shadow-card sm:p-6">
      <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-subtle">
        {typeKey && (
          <span className="inline-flex h-6 items-center rounded-full border border-[#93C5FD]/45 px-2.5 font-medium text-[#BFDBFE]">{TYPE_LABEL[typeKey] ?? typeKey}</span>
        )}
        {ev.period && <span>{ev.period}</span>}
        {checked ? (
          <span className="inline-flex h-6 items-center gap-1 rounded-full bg-teal/10 px-2.5 font-medium text-teal">
            <Check className="size-3.5" aria-hidden />{checked} numbers checked
          </span>
        ) : null}
      </div>

      <NumberText text={lead} targets={targets} onProof={onProof} active={activeProof}
        className={cn(a.status === "answered" ? "font-display text-[26px] leading-[1.22] sm:text-[30px]" : "text-[16px] leading-7")} />

      {keys.length > 0 && (
        <ul aria-label="Key numbers" className={cn("grid gap-3", keys.length >= 3 ? "sm:grid-cols-3" : keys.length === 2 ? "sm:grid-cols-2" : "")}>
          {keys.map((k) => {
            const t = targets.find((x) => x.kind === "card" && `${x.card.dataset_id}.${x.card.field}` === k.key) ?? null;
            const scale = k.unit === "AQI" ? "aqi" : /µg/.test(k.unit) ? (/pm10/i.test(a.resolved_query?.pollutant ?? "") ? "pm10" : "pm25") : null;
            return (
              <li key={k.key} className="rounded-2xl border border-line bg-white/[0.025] px-4 py-3">
                <p className="text-[12px] text-subtle">{k.label}</p>
                <p className="mt-1 flex items-baseline gap-1.5">
                  {t ? (
                    <button type="button" onClick={() => onProof(t)} aria-pressed={activeProof === t.id} title="See where this number came from"
                      className={cn("num rounded-md px-0.5 text-[26px] leading-8 font-medium underline decoration-teal decoration-dashed decoration-[1.5px] underline-offset-[6px] hover:bg-teal/15",
                        activeProof === t.id && "bg-teal/20")}>
                      {k.value}
                    </button>
                  ) : <span className="num text-[26px] leading-8 font-medium">{k.value}</span>}
                  <span className="text-[12px] text-subtle">{k.unit}</span>
                  {k.category && <CategoryBadge category={k.category} size="sm" className="ml-auto" label="Category" />}
                </p>
                {scale && <ScaleBar value={k.exact} scale={scale} className="mt-3" />}
                {k.sub && <p className="mt-2 text-[12px] text-faint">{k.sub}</p>}
              </li>
            );
          })}
        </ul>
      )}

      {explanation && <NumberText text={explanation} targets={targets} onProof={onProof} active={activeProof} className="text-[15px] leading-7 text-subtle" />}

      {notes.length > 0 && (
        <ul aria-label="Notes" className="flex flex-col gap-1 text-[13px] leading-5 text-faint">
          {notes.map((n) => <li key={n} className="flex gap-2"><span aria-hidden className="mt-[7px] size-1 shrink-0 rounded-full bg-faint" />{readable(n)}</li>)}
        </ul>
      )}

      {fups.length > 0 && turn.phase === "done" && (
        <div>
          <p className="mb-2 text-[12px] font-medium text-faint">Ask next</p>
          <ul className="flex flex-wrap gap-2">
            {fups.map((q) => (
              <li key={q}>
                <button type="button" disabled={busy} onClick={() => onAsk(q)}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-line-strong bg-white/[0.03] px-3.5 py-1.5 text-left text-[13px] hover:border-teal/60 disabled:opacity-50">
                  {q}<ArrowUpRight className="size-3.5 shrink-0 text-teal" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
