"use client";

// One question and its answer in the conversation. While the agent works: its live steps. When done: the answer
// card, then "How this answer was made" collapsed. On phones the evidence follows the answer (desktop shows it
// in the right panel). Every failure has its own plain message.
import Link from "next/link";
import { useEffect, useState } from "react";
import { Clock, CloudOff, MapPin, RotateCcw, Square, Zap } from "lucide-react";
import { Skeleton } from "@/components/ds/states";
import { backupModel, servedFrom, type Turn } from "@/lib/chat-state";
import { CITIES } from "@/lib/categories";
import { fmtDate } from "@/lib/format";
import type { Target } from "@/lib/proof";
import type { Health } from "@/lib/types";
import { AnswerCard } from "./answer-card";
import { Callout } from "./answer-parts";
import { EvidencePanel } from "./evidence-panel";
import { LiveSteps, StepsSummary } from "./live-steps";

interface Props {
  turn: Turn;
  health: Health | null;
  isLatest: boolean;
  busy: boolean;
  onAsk: (q: string) => void;
  onRetry: (t: Turn) => void;
  onProof: (t: Turn, target: Target) => void;
  activeProof: string | null;
  /** phones: show the evidence under the answer */
  inlineEvidence: boolean;
}

export function TurnView({ turn, health, isLatest, busy, onAsk, onRetry, onProof, activeProof, inlineEvidence }: Props) {
  return (
    <article data-turn={turn.id} className="flex min-w-0 flex-col gap-4" aria-label={`Question: ${turn.question}`}>
      <div className="flex justify-end">
        <p className="max-w-[85%] rounded-2xl rounded-br-md border border-teal/25 bg-teal/[0.08] px-4 py-2.5 text-[14.5px]">{turn.question}</p>
      </div>
      <Body turn={turn} health={health} isLatest={isLatest} busy={busy} onAsk={onAsk} onRetry={onRetry}
        onProof={(t) => onProof(turn, t)} activeProof={activeProof} />
      {turn.answer && turn.phase === "done" && <StepsSummary turn={turn} />}
      {inlineEvidence && turn.answer && turn.phase === "done" && (turn.chart || turn.cards.length > 0) && (
        <div className="glass min-w-0 overflow-hidden rounded-3xl [contain:inline-size]"><EvidencePanel turn={turn} /></div>
      )}
    </article>
  );
}

function Body({ turn, health, isLatest, busy, onAsk, onRetry, onProof, activeProof }: Omit<Props, "onProof" | "inlineEvidence"> & { onProof: (t: Target) => void }) {
  const notices = turn.notices.map((n) => (
    <Callout key={n.code} tone={n.code === "low" ? "warn" : "info"} icon={n.code === "cached_fallback" ? Clock : Zap}>{n.message}</Callout>
  ));
  const cached = servedFrom(turn);
  const backup = backupModel(turn);

  if (turn.phase === "waking") {
    return (
      <div className="glass flex flex-col gap-3 rounded-3xl p-5">
        <Callout tone="info" icon={Clock} title="Waking up the data server, this can take up to a minute">
          Your question will be sent as soon as it is ready.
        </Callout>
        <AnswerSkeleton />
      </div>
    );
  }
  if (turn.phase === "error" && turn.error) {
    return <>{notices}<ErrorState turn={turn} isLatest={isLatest} busy={busy} onAsk={onAsk} onRetry={onRetry} /></>;
  }
  if (turn.phase === "stopped" && !turn.answer) {
    return (
      <div className="flex flex-wrap items-center gap-3 text-sm text-subtle">
        <span className="inline-flex items-center gap-1.5"><Square className="size-3.5" aria-hidden />Stopped before the answer was ready.</span>
        {isLatest && <RetryButton disabled={busy} onClick={() => onRetry(turn)} />}
      </div>
    );
  }
  if (!turn.answer) {
    return (
      <>
        {notices}
        <div className="glass flex flex-col gap-4 rounded-3xl p-5" role="status" aria-live="polite">
          <p className="text-[12px] font-medium tracking-wide text-faint uppercase">Working on it</p>
          <LiveSteps turn={turn} />
          <AnswerSkeleton />
        </div>
      </>
    );
  }
  const a = turn.answer;
  const unsupported = unsupportedCities(turn);
  return (
    <>
      {notices}
      {(cached || backup) && (
        <p className="flex flex-wrap gap-2 text-[12px] text-faint">
          {cached && <span className="inline-flex items-center gap-1"><Clock className="size-3" aria-hidden />{cached === "demo" ? "Saved demo answer" : "Saved answer"}</span>}
          {backup && <span className="inline-flex items-center gap-1 text-warn"><Zap className="size-3" aria-hidden />Backup model</span>}
        </p>
      )}
      {a.status === "unavailable" && (
        <Callout tone="warn" title={unavailableTitle(turn)}>
          {health?.data_windows ? (
            <>Measured station data covers {fmtDate(health.data_windows.measured_start)} to {fmtDate(health.data_windows.measured_end)}; official AQI bulletins run to {fmtDate(health.data_windows.aqi_end)}. Try a period inside those dates.</>
          ) : <>Try a different period or city.</>}
        </Callout>
      )}
      {a.status === "clarify" && a.clarifying_question && <Callout tone="info" title="One question first">{a.clarifying_question}</Callout>}
      {unsupported.length > 0 && (
        <div>
          <p className="mb-2 text-sm text-subtle">{unsupported.join(", ")} {unsupported.length === 1 ? "isn't" : "aren't"} covered. SkyQueryChat covers these six cities:</p>
          <ul className="flex flex-wrap gap-2">
            {CITIES.map((c) => (
              <li key={c}>
                <button type="button" disabled={busy} onClick={() => onAsk(replaceCity(turn.question, unsupported, c))}
                  className="inline-flex min-h-9 items-center gap-1 rounded-full border border-line-strong px-3 text-xs font-medium hover:border-teal hover:text-teal disabled:opacity-50">
                  <MapPin className="size-3.5" aria-hidden />{c}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <AnswerCard turn={turn} onProof={onProof} activeProof={activeProof} onAsk={onAsk} busy={busy} />
    </>
  );
}

function AnswerSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-hidden>
      <Skeleton className="h-5 w-11/12" />
      <Skeleton className="h-5 w-8/12" />
      <div className="grid grid-cols-3 gap-3"><Skeleton className="h-20 rounded-2xl" /><Skeleton className="h-20 rounded-2xl" /><Skeleton className="h-20 rounded-2xl" /></div>
    </div>
  );
}

function RetryButton({ onClick, disabled, label = "Try again" }: { onClick: () => void; disabled?: boolean; label?: string }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className="inline-flex h-9 w-fit items-center gap-1.5 rounded-full bg-teal px-4 text-sm font-semibold text-teal-ink hover:bg-teal-hover disabled:opacity-50">
      <RotateCcw className="size-4" aria-hidden />{label}
    </button>
  );
}

function useCountdown(seconds: number | undefined, startedAt: number) {
  const [left, setLeft] = useState(() => (seconds ? Math.max(0, Math.ceil(seconds - (Date.now() - startedAt) / 1000)) : 0));
  useEffect(() => {
    if (!seconds) return;
    const id = setInterval(() => {
      const l = Math.max(0, Math.ceil(seconds - (Date.now() - startedAt) / 1000));
      setLeft(l);
      if (l <= 0) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [seconds, startedAt]);
  return left;
}

/** "in 40 seconds", "in about 3 minutes", "in about 5 hours" */
export function waitText(s: number): string {
  if (s <= 90) return `in ${s} second${s === 1 ? "" : "s"}`;
  if (s <= 90 * 60) return `in about ${Math.round(s / 60)} minutes`;
  return `in about ${Math.round(s / 3600)} hours`;
}

function ErrorState({ turn, isLatest, busy, onAsk, onRetry }: { turn: Turn; isLatest: boolean; busy: boolean; onAsk: (q: string) => void; onRetry: (t: Turn) => void }) {
  const e = turn.error!;
  const wait = useCountdown(e.code === "rate_limited" ? e.retry_after_s : undefined, turn.startedAt);
  const retry = isLatest ? <RetryButton disabled={busy || wait > 0} onClick={() => onRetry(turn)} label={wait > 0 ? `Try again ${waitText(wait)}` : "Try again"} /> : null;
  const saved = e.demo_questions && e.demo_questions.length > 0 && (
    <div>
      <p className="mb-2 text-xs font-medium text-subtle">These saved answers still work:</p>
      <QuestionChips questions={e.demo_questions.slice(0, 4)} onAsk={onAsk} disabled={busy} />
    </div>
  );
  const box = "glass flex flex-col gap-3 rounded-3xl p-5";
  switch (e.code) {
    case "ai_limit":
      return (
        <div className={box}>
          <Callout tone="warn" title="Today's AI limit has been reached">
            The free AI quota for today is used up, so new questions can&apos;t be answered until it resets.{" "}
            <Link className="font-medium text-teal underline underline-offset-2" href="/explore">Explore</Link> and{" "}
            <Link className="font-medium text-teal underline underline-offset-2" href="/compare">Compare</Link> still work, because they don&apos;t use AI.
          </Callout>
          {saved}
        </div>
      );
    case "rate_limited":
      return (
        <div className={box}>
          <Callout tone="warn" title="You've asked a lot of questions in a short time">
            {wait > 0 ? `You can ask again ${waitText(wait)}.` : "You can ask again now."} The limit keeps the free service fair for everyone.
          </Callout>
          {retry}
        </div>
      );
    case "ai_busy":
      return (
        <div className={box}>
          <Callout tone="warn" title="The AI service is busy right now">Please try again in about a minute.</Callout>
          {retry}
          {saved}
        </div>
      );
    case "backend_waking":
    case "network":
      return (
        <div className={box}>
          <Callout tone="error" icon={CloudOff} title="We couldn't reach the data server">{e.message}</Callout>
          {retry}
        </div>
      );
    case "invalid_input":
      return <Callout tone="warn" title="That question couldn't be sent">{e.message}</Callout>;
    default:
      return (
        <div className={box}>
          <Callout tone="error" title="The answer couldn't be completed">{e.message}</Callout>
          {retry}
        </div>
      );
  }
}

function QuestionChips({ questions, onAsk, disabled }: { questions: string[]; onAsk: (q: string) => void; disabled?: boolean }) {
  return (
    <ul className="flex flex-wrap gap-2">
      {questions.map((q) => (
        <li key={q}>
          <button type="button" disabled={disabled} onClick={() => onAsk(q)}
            className="min-h-9 rounded-full border border-line-strong px-3 py-1.5 text-left text-xs font-medium hover:border-teal hover:text-teal disabled:opacity-50">
            {q}
          </button>
        </li>
      ))}
    </ul>
  );
}

function unsupportedCities(t: Turn): string[] {
  return t.steps.flatMap((s) => (s.type === "tool_result" && s.title === "check_request" ? ((s.detail.unsupported as string[]) ?? []) : []));
}

// Diwali dates verified in backend/config (DoPT holiday lists; Drik Panchang).
const DIWALI_2026 = "2026-11-08";

function unavailableTitle(t: Turn): string {
  const rq = t.answer?.resolved_query;
  const text = `${t.question} ${rq?.assumptions?.join(" ") ?? ""}`;
  const today = new Date().toISOString().slice(0, 10);
  if (/diwali\s*2026/i.test(text) && today <= addDays(DIWALI_2026, 2)) return "Diwali 2026 falls on 8 November. Data isn't available yet.";
  if (t.answer?.data_types.includes("official_aqi")) return "Official AQI isn't available for this period";
  if (t.answer?.data_types.includes("modelled")) return "Modelled data isn't available for this period";
  return "Measured data isn't available for this period";
}

function addDays(iso: string, n: number): string {
  return new Date(Date.parse(iso + "T00:00:00Z") + n * 86_400_000).toISOString().slice(0, 10);
}

function replaceCity(q: string, from: string[], to: string): string {
  let out = q;
  for (const f of from) out = out.replace(new RegExp(f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), to);
  return out === q ? `${q} (${to})` : out;
}
