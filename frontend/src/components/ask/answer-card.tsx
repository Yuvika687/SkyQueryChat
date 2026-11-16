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
  // comparisons: the cities' means stay as tiles; difference and ratio become one small tile ("3.1× · +105 µg/m³")
  const keys = keyNumbers(a.comparison ? turn.cards.filter((c) => !/^difference_|^ratio_/.test(c.field)) : turn.cards)
    .slice(0, a.comparison ? 3 : 4);
  const typeKey = (a.data_types.length > 1 ? "mixed" : a.data_types[0]) ?? null;
  const checked = a.verification?.numbers_checked;
  const lead = a.headline || a.text;
  const explanation = a.method !== undefined ? a.explanation : "";
  const fups = followUps(turn);
  const notes = (a.required_warnings ?? []).map((w) => w.text);
  const toast = useToast();
  const c = a.comparison;
  const unit = c ? (/µg/.test(c.units) ? "µg/m³" : c.units) : "";
  return (
    <div className="card flex flex-col gap-5 p-5 sm:p-6">
      {/* a) meta line */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-subtle">
        {typeKey && (
          <span className="inline-flex h-6 items-center rounded-full bg-[#60A5FA]/12 px-2.5 font-medium text-[#BFDBFE]">{TYPE_LABEL[typeKey] ?? typeKey}</span>
        )}
        {ev.period && <><span aria-hidden className="text-faint">·</span><span>{ev.period}</span></>}
        {checked ? (
          <><span aria-hidden className="text-faint">·</span>
          <span className="inline-flex items-center gap-1 font-medium text-teal">
            <Check className="size-3.5" aria-hidden />{checked} {checked === 1 ? "number" : "numbers"} checked
          </span></>
        ) : null}
        {a.status === "answered" && (
          <span className="ml-auto flex items-center">
            <IconAct label="Copy answer" onClick={() => void copyText(answerAsText(turn), toast, "Answer copied")}><Copy className="size-4" aria-hidden /></IconAct>
            <IconAct label="Copy link" onClick={() => void copyText(shareLink(turn.question), toast, "Link copied")}><Link2 className="size-4" aria-hidden /></IconAct>
          </span>
        )}
      </div>

      {/* b) the headline: 21 px, key numbers in bold and clickable for proof */}
      <NumberText text={lead} targets={targets} onProof={onProof} active={activeProof}
        className={cn(a.status !== "answered" ? "text-[17px] leading-7" : "text-[20px] leading-[1.5] font-normal text-foreground sm:text-[21px]")} />

      {/* c) key-number tiles: soft tint, no borders */}
      {(keys.length > 0 || c) && (
        <ul aria-label="Key numbers" className={cn("grid grid-cols-2 gap-3", (keys.length + (c ? 1 : 0)) >= 3 && "sm:grid-cols-3", (keys.length + (c ? 1 : 0)) >= 4 && "lg:grid-cols-4")}>
          {keys.map((k) => {
            const t = targets.find((x) => x.kind === "card" && `${x.card.dataset_id}.${x.card.field}` === k.key) ?? null;
            const scale = k.unit === "AQI" ? "aqi" : /µg/.test(k.unit) ? (/pm10/i.test(a.resolved_query?.pollutant ?? "") ? "pm10" : "pm25") : null;
            return (
              <li key={k.key} className="tile flex min-w-0 flex-col px-4 py-3">
                <p className="line-clamp-2 text-[12.5px] leading-[18px] text-subtle" title={k.label}>{k.label}</p>
                <p className="mt-1 flex items-baseline gap-1.5">
                  {t ? (
                    <ProofButton onClick={() => onProof(t)} pressed={activeProof === t.id}
                      className={cn("num rounded-md px-0.5 text-[24px] leading-8 font-medium underline decoration-teal/70 decoration-dashed decoration-[1.5px] underline-offset-[6px] hover:bg-teal/15",
                        activeProof === t.id && "bg-teal/20")}>
                      {k.value}
                    </ProofButton>
                  ) : <span className="num text-[24px] leading-8 font-medium">{k.value}</span>}
                  {k.role !== "ratio" && <span className="text-[12px] text-subtle">{k.unit}</span>}
                </p>
                {k.category && <CategoryBadge category={k.category} size="sm" className="mt-1.5 self-start" label="Category" />}
                {k.range && <p className="num mt-1 text-[12px] text-faint">({k.range})</p>}
                {scale && k.role === "level" && <ScaleBar value={k.exact} scale={scale} showEnds={false} className="mt-2.5" />}
                {k.sub && <p className="mt-1.5 text-[12px] text-faint">{k.sub}</p>}
              </li>
            );
          })}
          {c && <ComparisonTile c={c} unit={unit} />}
        </ul>
      )}

      {/* d) short explanation or bullets */}
      {explanation && <NumberText text={explanation} targets={targets} onProof={onProof} active={activeProof} className="text-[15px] leading-7 text-subtle" />}

      {/* e) one "What this means" callout, with CPCB's health statement */}
      {a.takeaway && (
        <div className="tile flex gap-3 px-4 py-3.5">
          <HeartPulse className="mt-1 size-4 shrink-0 text-teal" aria-hidden />
          <div>
            <p className="text-[13px] font-semibold text-foreground">What this means</p>
            <p className="mt-0.5 text-[14.5px] leading-6 text-subtle">{plain(readable(a.takeaway))}</p>
          </div>
        </div>
      )}

      {notes.length > 0 && (
        <ul aria-label="Notes" className="flex flex-col gap-1 text-[13px] leading-5 text-faint">
          {notes.map((n) => <li key={n} className="flex gap-2"><span aria-hidden className="mt-[8px] size-1 shrink-0 rounded-full bg-faint" />{readable(n)}</li>)}
        </ul>
      )}

      {/* f) follow-up chips (and, on phones, the way to the chart and evidence) */}
      {turn.phase === "done" && (fups.length > 0 || onEvidence) && (
        <div className="flex flex-wrap gap-2">
          {onEvidence && (turn.chart || turn.cards.length > 0) && (
            <button type="button" onClick={onEvidence}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-teal/10 px-3.5 py-1.5 text-[13.5px] font-medium text-teal hover:bg-teal/15 lg:hidden">
              <BarChart3 className="size-4" aria-hidden />Chart and evidence
            </button>
          )}
          {fups.map((q) => (
            <button key={q} type="button" disabled={busy} onClick={() => onAsk(q)}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-white/[0.05] px-3.5 py-1.5 text-left text-[13.5px] text-foreground hover:bg-white/[0.09] disabled:opacity-50">
              {q}<ArrowUpRight className="size-3.5 shrink-0 text-teal" aria-hidden />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** The comparison as one small tile: "3.1× · +105.0 µg/m³" (or "Too close to call"), common days below. Every figure
 * is from the comparison tool's result (code-built summary). */
function ComparisonTile({ c, unit }: { c: ComparisonSummary; unit: string }) {
  return (
    <li aria-label="Comparison" className={cn("tile flex min-w-0 flex-col px-4 py-3", c.too_close_to_call ? "bg-warn/[0.07]" : "bg-teal/[0.07]")}>
      <p className="truncate text-[12.5px] text-subtle">{c.higher && c.lower ? `${c.higher} vs ${c.lower}` : "Comparison"}</p>
      {c.too_close_to_call ? (
        <p className="mt-1 text-[17px] leading-8 font-semibold text-warn">Too close to call</p>
      ) : (
        <p className="num mt-1 text-[20px] leading-8 font-semibold">
          {c.ratio != null ? `${c.ratio.toFixed(1)}×` : ""}{c.difference != null && <span className="text-[14px] font-medium text-subtle"> · +{c.difference.toFixed(1)} {unit}</span>}
        </p>
      )}
      {c.n_common_days != null && <p className="mt-1 text-[12px] text-faint">{c.n_common_days} common days</p>}
    </li>
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
