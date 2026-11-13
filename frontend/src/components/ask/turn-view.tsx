"use client";

import { useEffect, useState } from "react";
import { Bot, Clock, CloudOff, ListTree, MapPin, RotateCcw, Square, Zap } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { backupModel, servedFrom, type Turn } from "@/lib/chat-state";
import { CITIES } from "@/lib/categories";
import { evidenceFor } from "@/lib/evidence";
import { followUps } from "@/lib/followups";
import { fmtDate, readable } from "@/lib/format";
import { buildTimeline } from "@/lib/timeline";
import type { Health } from "@/lib/types";
import { cn } from "@/lib/utils";
import { AgentSummary } from "./agent-timeline";
import { Callout, ChartPanel, CopyOnly, DataTypeBadge, EvidenceArea, KeyNumbers, RequiredNotes } from "./answer-parts";

interface Props {
  turn: Turn;
  health: Health | null;
  isLatest: boolean;
  busy: boolean;
  onAsk: (q: string) => void;
  onRetry: (t: Turn) => void;
  onShowSteps: (t: Turn) => void;
  showStepsButton: boolean;
}

export function TurnView({ turn, health, isLatest, busy, onAsk, onRetry, onShowSteps, showStepsButton }: Props) {
  return (
    <article data-turn={turn.id} className="flex flex-col gap-4" aria-label={`Question: ${turn.question}`}>
      <div className="flex justify-end">
        <p className="max-w-[85%] rounded-2xl rounded-br-md bg-raised px-4 py-2.5 text-sm">{turn.question}</p>
      </div>
      <div className="flex gap-3">
        <span className="mt-0.5 hidden size-8 shrink-0 place-items-center rounded-lg bg-teal/15 text-teal sm:grid" aria-hidden>
          <Bot className="size-4" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <Body turn={turn} health={health} isLatest={isLatest} busy={busy} onAsk={onAsk} onRetry={onRetry} />
          {/* While running: the side panel shows the steps on wide screens; smaller screens get a live
              button that opens them in a drawer. After the answer: one compact, expandable summary. */}
          {showStepsButton && (turn.phase === "streaming" || turn.phase === "waking") && (
            <button
              type="button"
              onClick={() => onShowSteps(turn)}
              className="inline-flex h-9 w-fit items-center gap-1.5 rounded-lg border border-line px-2.5 text-xs font-medium text-subtle hover:border-teal hover:text-teal xl:hidden"
            >
              <ListTree className="size-4" aria-hidden />
              {`Agent steps: ${currentStepLabel(turn)}`}
            </button>
          )}
          {turn.phase !== "streaming" && turn.phase !== "waking" && <AgentSummary turn={turn} />}
        </div>
      </div>
    </article>
  );
}

function currentStepLabel(t: Turn) {
  const s = buildTimeline(t.steps, "streaming").find((x) => x.status === "running");
  return s ? s.label : "working";
}

function Body({ turn, health, isLatest, busy, onAsk, onRetry }: Omit<Props, "onShowSteps" | "showStepsButton">) {
  const notices = turn.notices.map((n) => (
    <Callout key={n.code} tone={n.code === "low" ? "warn" : "info"} icon={n.code === "cached_fallback" ? Clock : Zap}>
      {n.message}
    </Callout>
  ));

  if (turn.phase === "waking") {
    return (
      <>
        <Callout tone="info" icon={Clock} title="Starting the analysis service">
          This can take a minute or two.
        </Callout>
        <AnswerSkeleton />
      </>
    );
  }

  if (turn.phase === "error" && turn.error) {
    return (
      <>
        {notices}
        <ErrorState turn={turn} isLatest={isLatest} busy={busy} onAsk={onAsk} onRetry={onRetry} />
      </>
    );
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
        <AnswerSkeleton />
      </>
    );
  }
  return (
    <>
      {notices}
      <AnswerView turn={turn} health={health} onAsk={onAsk} busy={busy} />
    </>
  );
}

function AnswerSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-label="Loading answer" role="status">
      <Skeleton className="h-4 w-11/12 bg-raised" />
      <Skeleton className="h-4 w-8/12 bg-raised" />
      <div className="grid grid-cols-2 gap-3">
        <Skeleton className="h-24 rounded-xl bg-raised" />
        <Skeleton className="h-24 rounded-xl bg-raised" />
      </div>
      <Skeleton className="h-56 rounded-xl bg-raised" />
      <span className="sr-only">Working on the answer…</span>
    </div>
  );
}

function RetryButton({ onClick, disabled, label = "Retry" }: { onClick: () => void; disabled?: boolean; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-teal px-3 text-sm font-medium text-background hover:bg-teal-hover disabled:opacity-50"
    >
      <RotateCcw className="size-4" aria-hidden />
      {label}
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

function ErrorState({ turn, isLatest, busy, onAsk, onRetry }: { turn: Turn; isLatest: boolean; busy: boolean; onAsk: (q: string) => void; onRetry: (t: Turn) => void }) {
  const e = turn.error!;
  const wait = useCountdown(e.code === "rate_limited" ? e.retry_after_s : undefined, turn.startedAt);
  const retry = isLatest ? <RetryButton disabled={busy || wait > 0} onClick={() => onRetry(turn)} label={wait > 0 ? `Retry in ${wait} s` : "Retry"} /> : null;
  switch (e.code) {
    case "ai_limit":
      return (
        <div className="flex flex-col gap-3">
          <Callout tone="warn" title="Live AI limit reached">{e.message}</Callout>
          {e.demo_questions && e.demo_questions.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-medium text-subtle">These saved answers still work:</p>
              <QuestionChips questions={e.demo_questions} onAsk={onAsk} disabled={busy} />
            </div>
          )}
        </div>
      );
    case "ai_busy":
      return (
        <div className="flex flex-col gap-3">
          <Callout tone="warn" title="The AI service is busy. Try again in a moment.">{e.message}</Callout>
          {retry}
          {e.demo_questions && e.demo_questions.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-medium text-subtle">Or open a saved answer:</p>
              <QuestionChips questions={e.demo_questions.slice(0, 4)} onAsk={onAsk} disabled={busy} />
            </div>
          )}
        </div>
      );
    case "rate_limited":
      return (
        <div className="flex flex-col gap-3">
          <Callout tone="warn" title="The AI service is busy. Try again in a moment.">{e.message}</Callout>
          {retry}
        </div>
      );
    case "backend_waking":
    case "network":
      return (
        <div className="flex flex-col gap-3">
          <Callout tone="error" icon={CloudOff} title="We couldn't reach the analysis service">{e.message}</Callout>
          {retry}
        </div>
      );
    case "invalid_input":
      return <Callout tone="warn" title="That question couldn't be sent">{e.message}</Callout>;
    default:
      return (
        <div className="flex flex-col gap-3">
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
          <button
            type="button"
            disabled={disabled}
            onClick={() => onAsk(q)}
            className="min-h-9 rounded-lg border border-line bg-surface px-3 py-1.5 text-left text-xs font-medium hover:border-teal hover:text-teal disabled:opacity-50"
          >
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

function AnswerView({ turn, health, onAsk, busy }: { turn: Turn; health: Health | null; onAsk: (q: string) => void; busy: boolean }) {
  const a = turn.answer!;
  const ev = evidenceFor(turn);
  const cached = servedFrom(turn);
  const backup = backupModel(turn);
  const unsupported = unsupportedCities(turn);
  const required = a.required_warnings ?? [];
  const requiredText = new Set(required.map((w) => w.text));
  const other = turn.warnings.filter((w) => !requiredText.has(w));
  const modelledOnly = a.data_types.length === 1 && a.data_types[0] === "modelled";
  const dataType = (a.data_types.length > 1 ? "mixed" : a.data_types[0]) ?? null;
  const fups = followUps(turn);
  // The lead is the model's number-checked headline. Older saved answers carried a code-written headline next
  // to the model's sentence; that sentence is kept as support when the answer drew on more than one dataset.
  const lead = readable(a.headline || a.text);
  const support = a.headline && (turn.sources?.sources.length ?? 0) > 1 && a.text !== a.headline ? readable(a.text) : null;
  // Newer answers send the code-written method separately; in older ones `explanation` was that method text.
  const method = a.method ?? a.explanation;
  const explanation = a.method !== undefined ? readable(a.explanation) : "";
  const copyText = [
    lead,
    support ?? "",
    explanation,
    ...turn.cards.map((c) => `${c.label}: ${c.value} ${c.unit}`.trim()),
    ev.period ? `Period: ${ev.period}` : "",
    ev.source ? `Source: ${ev.source}` : "",
  ].filter(Boolean).join("\n");
  const windows = health?.data_windows;

  return (
    <div className="flex flex-col gap-5">
      {/* the main insight comes first */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {dataType && <DataTypeBadge type={dataType} />}
          {cached && (
            <span className="inline-flex h-6 items-center gap-1 rounded-full px-1.5 text-xs font-medium text-subtle">
              <Clock className="size-3" aria-hidden />
              {cached === "demo" ? "Saved demo answer" : "Saved answer"}
            </span>
          )}
          {backup && (
            <span className="inline-flex h-6 items-center gap-1 rounded-full border border-warn/40 px-2 text-xs font-medium text-warn">
              <Zap className="size-3" aria-hidden />
              Backup model: {backup}
            </span>
          )}
          {turn.phase === "streaming" && <span className="text-xs text-subtle">Finishing…</span>}
        </div>
        {a.status === "unavailable" && (
          <Callout tone="warn" title={unavailableTitle(turn)}>
            {windows ? (
              <>Measured station data covers {fmtDate(windows.measured_start)} to {fmtDate(windows.measured_end)}; official AQI bulletins run to {fmtDate(windows.aqi_end)}. Try a period inside those dates.</>
            ) : (
              <>Try a different period or city.</>
            )}
          </Callout>
        )}
        <p className={cn(a.status === "answered" ? "text-base leading-7 font-medium sm:text-[17px]" : "text-[15px] leading-6")}>{lead}</p>
        {support && <p className="text-sm leading-6 text-subtle">{support}</p>}
      </div>
      {a.status === "clarify" && a.clarifying_question && (
        <Callout tone="info" title="One question first">{a.clarifying_question}</Callout>
      )}
      {unsupported.length > 0 && (
        <div>
          <p className="mb-2 text-sm text-subtle">
            {unsupported.join(", ")} {unsupported.length === 1 ? "isn't" : "aren't"} covered. SkyQueryChat covers these six cities:
          </p>
          <ul className="flex flex-wrap gap-2">
            {CITIES.map((c) => (
              <li key={c}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onAsk(replaceCity(turn.question, unsupported, c))}
                  className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-line px-3 text-xs font-medium hover:border-teal hover:text-teal disabled:opacity-50"
                >
                  <MapPin className="size-3.5" aria-hidden />{c}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* required warnings come from code and are always shown */}
      <RequiredNotes notes={required} />
      {modelledOnly && <Callout tone="modelled" title="Modelled data">These values come from a model, not monitors, and can underestimate severe pollution.</Callout>}

      <KeyNumbers cards={turn.cards} answerType={dataType} />

      {turn.chart && turn.chart.series?.some((s) => s.data.length > 0) ? (
        <ChartPanel spec={turn.chart} dataType={dataType} answerText={copyText} />
      ) : null}

      {explanation && <p className="text-sm leading-6 text-subtle">{explanation}</p>}

      <EvidenceArea ev={ev} rq={a.resolved_query} explanation={method} notes={other} />

      {!turn.chart && <div><CopyOnly answerText={copyText} /></div>}

      {fups.length > 0 && turn.phase === "done" && (
        <div>
          <p className="mb-2 text-xs font-medium text-subtle">Ask next</p>
          <QuestionChips questions={fups} onAsk={onAsk} disabled={busy} />
        </div>
      )}
    </div>
  );
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
