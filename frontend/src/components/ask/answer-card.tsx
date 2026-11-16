"use client";

// The answer: data-type badge, period, "N numbers checked", the model's headline with clickable numbers, key
// numbers with category and scale bar, the short explanation, notes and follow-ups that ask at once.
import { ArrowUpRight, BarChart3, Check, Copy, HeartPulse, Link2 } from "lucide-react";
import { useMemo } from "react";
import { CategoryBadge, ScaleBar } from "@/components/ds/data-display";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { copyText, useToast } from "@/components/ds/toast";
import type { Turn } from "@/lib/chat-state";
import { evidenceFor } from "@/lib/evidence";
import { followUps } from "@/lib/followups";
import { readable } from "@/lib/format";
import { keyNumbers } from "@/lib/key-numbers";
import type { ComparisonSummary } from "@/lib/types";
import { segments, targetsFor, type Target } from "@/lib/proof";
import { cn } from "@/lib/utils";

const TYPE_LABEL: Record<string, string> = {
  measured: "Measured PM", official_aqi: "Official AQI", modelled: "Weather association", mixed: "Measured PM + weather",
};

/** A clickable number. Its hint is a tooltip anchored to the number itself (a native title tooltip could appear far
 * from it, over the navigation). */
function ProofButton({ label, pressed, onClick, className, children }: {
  label?: string; pressed: boolean; onClick: () => void; className: string; children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<button type="button" onClick={onClick} aria-haspopup="dialog" aria-pressed={pressed} aria-label={label} className={className} />}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6}>See where this number came from</TooltipContent>
    </Tooltip>
  );
}

/** Text with clickable numbers. Supports the answer's light formatting: **bold** key numbers and "- " bullet lines. */
export function NumberText({ text, targets, onProof, active, className }: {
  text: string; targets: Target[]; onProof: (t: Target) => void; active: string | null; className?: string;
}) {
  const lines = useMemo(() => readable(text).split(/\n+/).map((l) => l.trim()).filter(Boolean), [text]);
  const bullets = lines.length > 1 && lines.every((l) => /^[-•]\s+/.test(l));
  const inline = (line: string, key: string) =>
    line.split(/(\*\*[^*]+\*\*)/).filter(Boolean).map((part, j) => {
      const bold = /^\*\*[^*]+\*\*$/.test(part);
      const body = segments(bold ? part.slice(2, -2) : part, targets).map((sg, i) =>
        sg.target ? (
          <ProofButton key={i} onClick={() => onProof(sg.target!)} pressed={active === sg.target.id}
            className={cn("num rounded-[5px] px-0.5 font-semibold text-foreground underline decoration-teal decoration-dashed decoration-[1.5px] underline-offset-4",
              "hover:bg-teal/15 hover:decoration-solid", active === sg.target.id && "bg-teal/20 decoration-solid")}>
            {sg.text}
          </ProofButton>
        ) : <span key={i}>{sg.text}</span>);
      return bold ? <strong key={`${key}-${j}`} className="font-semibold text-foreground">{body}</strong> : <span key={`${key}-${j}`}>{body}</span>;
    });
  if (bullets) {
    return (
      <ul className={cn("flex flex-col gap-1", className)}>
        {lines.map((l, i) => (
          <li key={i} className="flex gap-2"><span aria-hidden className="mt-[0.7em] size-1.5 shrink-0 rounded-full bg-teal/70" /><span>{inline(l.replace(/^[-•]\s+/, ""), `l${i}`)}</span></li>
        ))}
      </ul>
    );
  }
  return <p className={className}>{lines.map((l, i) => <span key={i}>{i > 0 && " "}{inline(l, `l${i}`)}</span>)}</p>;
}

const plain = (t: string) => t.replace(/\*\*([^*]+)\*\*/g, "$1");

/** Plain-text copy of an answer: headline, explanation, notes, period, source and the number check. */
export function answerAsText(turn: Turn): string {
  const a = turn.answer!;
  const ev = evidenceFor(turn);
  const parts = [`Q: ${turn.question}`, plain(readable(a.headline || a.text))];
  if (a.method !== undefined && a.explanation) parts.push(plain(readable(a.explanation)));
  if (a.takeaway) parts.push(plain(readable(a.takeaway)));
  for (const w of a.required_warnings ?? []) parts.push(`Note: ${readable(w.text)}`);
  const facts = [ev.dataType && `Data: ${ev.dataType}`, ev.period && `Period: ${readable(ev.period)}`, ev.source && `Source: ${readable(ev.source)}`,
    a.verification?.numbers_checked ? `${a.verification.numbers_checked} ${a.verification.numbers_checked === 1 ? "number" : "numbers"} checked against the analysis` : null].filter(Boolean);
  parts.push(facts.join(" · "));
  return parts.join("\n\n") + "\n";
}

export function shareLink(question: string): string {
  return `${window.location.origin}/ask?q=${encodeURIComponent(question)}`;
}

export function AnswerCard({ turn, onProof, activeProof, onAsk, busy, onEvidence }: {
  turn: Turn; onProof: (t: Target) => void; activeProof: string | null; onAsk: (q: string) => void; busy: boolean;
  /** opens the chart and evidence (right panel on wide screens, bottom sheet on phones) */
  onEvidence?: () => void;
}) {
  const a = turn.answer!;
  const ev = evidenceFor(turn);
  const targets = useMemo(() => targetsFor(turn), [turn]);
  // the comparison card already shows each city's mean, range, the difference and ratio
  const keys = keyNumbers(a.comparison ? turn.cards.filter((c) => !/^[A-Z][A-Za-z]+_mean$|^difference_|^ratio_/.test(c.field)) : turn.cards);
  const typeKey = (a.data_types.length > 1 ? "mixed" : a.data_types[0]) ?? null;
  const checked = a.verification?.numbers_checked;
  const lead = a.headline || a.text;
  const explanation = a.method !== undefined ? a.explanation : "";
  const fups = followUps(turn);
  const notes = (a.required_warnings ?? []).map((w) => w.text);
  const toast = useToast();
  return (
    <div className="glass flex flex-col gap-4 rounded-3xl p-5 shadow-card sm:p-6">
      <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-subtle">
        {typeKey && (
          <span className="inline-flex h-6 items-center rounded-full border border-[#93C5FD]/45 px-2.5 font-medium text-[#BFDBFE]">{TYPE_LABEL[typeKey] ?? typeKey}</span>
        )}
        {ev.period && <span>{ev.period}</span>}
        {checked ? (
          <span className="inline-flex h-6 items-center gap-1 rounded-full bg-teal/10 px-2.5 font-medium text-teal">
            <Check className="size-3.5" aria-hidden />{checked} {checked === 1 ? "number" : "numbers"} checked
          </span>
        ) : null}
        {a.status === "answered" && (
          <span className="ml-auto flex items-center gap-0.5">
            <IconAct label="Copy link" onClick={() => void copyText(shareLink(turn.question), toast, "Link copied")}><Link2 className="size-4" aria-hidden /></IconAct>
            <IconAct label="Copy answer" onClick={() => void copyText(answerAsText(turn), toast, "Answer copied")}><Copy className="size-4" aria-hidden /></IconAct>
          </span>
        )}
      </div>

      {a.comparison && <ComparisonCard c={a.comparison} />}

      {/* short headlines keep the display serif; long ones switch to the sans at a readable size */}
      <NumberText text={lead} targets={targets} onProof={onProof} active={activeProof}
        className={cn(a.status !== "answered" ? "text-[16px] leading-7"
          : lead.length > 120 ? "text-[19px] leading-[1.5] font-medium sm:text-[21px]"
            : "font-display text-[26px] leading-[1.22] sm:text-[30px]")} />

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
                    <ProofButton onClick={() => onProof(t)} pressed={activeProof === t.id}
                      className={cn("num rounded-md px-0.5 text-[26px] leading-8 font-medium underline decoration-teal decoration-dashed decoration-[1.5px] underline-offset-[6px] hover:bg-teal/15",
                        activeProof === t.id && "bg-teal/20")}>
                      {k.value}
                    </ProofButton>
                  ) : <span className="num text-[26px] leading-8 font-medium">{k.value}</span>}
                  {k.role !== "ratio" && <span className="text-[12px] text-subtle">{k.unit}</span>}
                  {k.category && <CategoryBadge category={k.category} size="sm" className="ml-auto" label="Category" />}
                </p>
                {k.range && <p className="num mt-1 text-[12px] text-subtle">({k.range})</p>}
                {scale && k.role === "level" && <ScaleBar value={k.exact} scale={scale} className="mt-3" />}
                {k.sub && <p className="mt-2 text-[12px] text-faint">{k.sub}</p>}
              </li>
            );
          })}
        </ul>
      )}

      {explanation && <NumberText text={explanation} targets={targets} onProof={onProof} active={activeProof} className="text-[15px] leading-7 text-subtle" />}

      {a.takeaway && (
        <p className="flex gap-2.5 rounded-xl border border-line bg-white/[0.03] px-3.5 py-2.5 text-[14px] leading-6">
          <HeartPulse className="mt-1 size-4 shrink-0 text-teal" aria-hidden />
          <span>{plain(readable(a.takeaway))}</span>
        </p>
      )}

      {onEvidence && (turn.chart || turn.cards.length > 0) && turn.phase === "done" && (
        <button type="button" onClick={onEvidence}
          className="inline-flex h-9 w-fit items-center gap-2 rounded-full border border-line-strong px-3.5 text-[13px] font-medium text-subtle hover:border-teal/60 hover:text-foreground">
          <BarChart3 className="size-4 text-teal" aria-hidden />Chart and evidence
        </button>
      )}

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

/** "Delhi is 2.5× Hyderabad · +50.0 µg/m³ · 526 common days", then each city's mean side by side. Every figure is
 * from the comparison tool's result (code-built summary). */
function ComparisonCard({ c }: { c: ComparisonSummary }) {
  const unit = /µg/.test(c.units) ? "µg/m³" : c.units;
  const head = c.too_close_to_call
    ? `${c.higher} and ${c.lower} are too close to call`
    : c.higher && c.lower && c.ratio != null ? `${c.higher} is ${c.ratio.toFixed(1)}× ${c.lower}` : null;
  const facts = [
    head,
    !c.too_close_to_call && c.difference != null ? `+${c.difference.toFixed(1)} ${unit}` : null,
    c.n_common_days != null ? `${c.n_common_days} common days` : null,
  ].filter(Boolean);
  return (
    <section aria-label="Comparison" className="rounded-2xl border border-teal/30 bg-teal/[0.06] px-4 py-3.5">
      {facts.length > 0 && <p className="text-[15px] font-semibold text-foreground">{facts.join(" · ")}</p>}
      <ul className={cn("mt-3 grid gap-3", c.cities.length === 2 ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-3")}>
        {c.cities.map((x) => (
          <li key={x.city} className="rounded-xl border border-line bg-white/[0.03] px-3 py-2.5">
            <p className="text-[12px] text-subtle">{x.city}</p>
            <p className="mt-0.5"><span className="num text-[22px] font-medium">{x.mean.toFixed(1)}</span> <span className="text-[12px] text-subtle">{unit}</span></p>
            {x.range95 && <p className="num text-[12px] text-faint">(95% range {x.range95[0].toFixed(1)}–{x.range95[1].toFixed(1)})</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function IconAct({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<button type="button" onClick={onClick} aria-label={label}
        className="grid size-8 place-items-center rounded-full text-subtle hover:bg-white/[0.05] hover:text-foreground" />}>
        {children}
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}
