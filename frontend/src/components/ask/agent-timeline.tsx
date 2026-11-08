"use client";

import { useState } from "react";
import { AlertTriangle, Check, ChevronDown, Circle, ListTree, Loader2, MinusCircle, X } from "lucide-react";
import { buildTimeline, CORRECTED, SMALL_MS, summarise, type StepStatus, type TimelineStep } from "@/lib/timeline";
import type { Turn } from "@/lib/chat-state";
import { servedFrom } from "@/lib/chat-state";
import { fmtDuration } from "@/lib/format";
import { cn } from "@/lib/utils";

const STATUS_TEXT: Record<StepStatus, string> = {
  waiting: "Waiting",
  running: "Running",
  done: "Done",
  warning: "Done with a warning",
  failed: "Failed",
  skipped: "Not needed",
};

function StatusIcon({ s }: { s: StepStatus }) {
  const common = "size-4";
  switch (s) {
    case "done":
      return <Check className={cn(common, "text-teal")} aria-hidden />;
    case "running":
      return <Loader2 className={cn(common, "animate-spin text-teal")} aria-hidden />;
    case "warning":
      return <AlertTriangle className={cn(common, "text-warn")} aria-hidden />;
    case "failed":
      return <X className={cn(common, "text-danger")} aria-hidden />;
    case "skipped":
      return <MinusCircle className={cn(common, "text-subtle/70")} aria-hidden />;
    default:
      return <Circle className={cn(common, "text-subtle/60")} aria-hidden />;
  }
}

/** What screen readers hear as the agent works (one always-mounted live region on the Ask screen). */
export function announcement(turn: Turn | null): string {
  if (!turn) return "";
  if (turn.phase === "waking") return "Starting the analysis service.";
  const current = buildTimeline(turn.steps, turn.phase).find((s) => s.status === "running");
  if (turn.phase === "streaming") return current ? `${current.label}…` : "";
  return turn.phase === "done" ? "Answer ready." : turn.phase === "error" ? "The answer failed." : "";
}

export function AgentTimeline({ turn, inDrawer = false }: { turn: Turn | null; inDrawer?: boolean }) {
  if (!turn) {
    return (
      <div className="p-4">
        <h2 className="text-[18px] leading-[26px] font-semibold">Agent steps</h2>
        <p className="mt-2 text-sm text-subtle">Ask a question to see each step the agent takes, as it happens.</p>
      </div>
    );
  }
  const phase = turn.phase === "waking" ? "streaming" : turn.phase;
  const steps = buildTimeline(turn.steps, phase);
  const cached = servedFrom(turn);
  return (
    <div className="p-4">
      <div className={cn("flex items-baseline justify-between gap-2", inDrawer && "pr-10")}>
        <h2 className="text-[18px] leading-[26px] font-semibold">Agent steps</h2>
        {turn.done && <span className="num text-xs text-subtle">{fmtDuration(turn.done.elapsed_ms)}</span>}
      </div>
      <p className="mt-1 line-clamp-2 text-xs leading-4 text-subtle" title={turn.question}>{turn.question}</p>
      {cached && (
        <p className="mt-2 rounded-lg border border-line bg-raised px-2.5 py-1.5 text-xs leading-4 text-subtle">
          Saved answer: these are the steps from when it was first worked out.
        </p>
      )}
      <ol className="mt-4 flex flex-col">
        {steps.map((s, i) => (
          <StepRow key={s.key} step={s} last={i === steps.length - 1} />
        ))}
      </ol>
    </div>
  );
}

function StepRow({ step, last }: { step: TimelineStep; last: boolean }) {
  const [open, setOpen] = useState(false);
  const hasDetail = Boolean(step.input || step.result || step.note || step.durationMs != null);
  const id = `step-${step.key}`;
  return (
    <li className="relative flex gap-3 pb-3">
      {!last && <span className="absolute top-6 left-[11px] h-[calc(100%-20px)] w-px bg-line" aria-hidden />}
      <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border border-line bg-surface">
        <StatusIcon s={step.status} />
      </span>
      <div className="min-w-0 flex-1">
        <button
          type="button"
          disabled={!hasDetail}
          aria-expanded={hasDetail ? open : undefined}
          aria-controls={hasDetail ? id : undefined}
          onClick={() => setOpen((o) => !o)}
          className={cn(
            "flex w-full items-center gap-2 rounded-md text-left text-sm",
            step.status === "waiting" || step.status === "skipped" ? "text-subtle" : "text-foreground",
            hasDetail && "hover:text-teal",
          )}
        >
          <span className="flex-1">
            {step.label}
            <span className="sr-only">: {STATUS_TEXT[step.status]}</span>
          </span>
          {step.durationMs != null && step.durationMs >= SMALL_MS && <span className="num text-[11px] text-subtle">{fmtDuration(step.durationMs)}</span>}
          {hasDetail && <ChevronDown className={cn("size-4 text-subtle transition-transform", open && "rotate-180")} aria-hidden />}
        </button>
        <p className={cn("text-xs leading-4", step.status === "warning" ? "text-warn" : step.status === "failed" ? "text-danger" : "text-subtle")}>
          {STATUS_TEXT[step.status]}
          {step.note && !open && step.note !== CORRECTED ? ` · ${step.note}` : ""}
          {step.note === CORRECTED && !open ? <span className="text-subtle"> · {CORRECTED}</span> : null}
        </p>
        {open && hasDetail && (
          <dl id={id} className="mt-2 space-y-1.5 rounded-lg border border-line bg-raised p-2.5 text-xs leading-4">
            {step.input && (
              <div>
                <dt className="text-subtle">Input</dt>
                <dd className="text-foreground">{step.input}</dd>
              </div>
            )}
            {step.result && (
              <div>
                <dt className="text-subtle">Result</dt>
                <dd className="text-foreground">{step.result}</dd>
              </div>
            )}
            {step.note && (
              <div>
                <dt className="text-subtle">Note</dt>
                <dd className="text-foreground">{step.note}</dd>
              </div>
            )}
            {step.durationMs != null && (
              <div>
                <dt className="text-subtle">Duration</dt>
                <dd className="num text-foreground">{fmtDuration(step.durationMs)}</dd>
              </div>
            )}
          </dl>
        )}
      </div>
    </li>
  );
}

/** After the answer: one compact line ("6 steps · 2.4 s · Corrected a number before answering") that
 * expands to the full step list. Real failures stay visible in red. */
export function AgentSummary({ turn }: { turn: Turn }) {
  const [open, setOpen] = useState(false);
  const phase = turn.phase === "waking" ? "streaming" : turn.phase;
  const steps = buildTimeline(turn.steps, phase);
  const sum = summarise(steps);
  if (!turn.steps.length) return null;
  const id = `agent-steps-${turn.id}`;
  const cached = servedFrom(turn);
  return (
    <div className="text-xs leading-5">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className={cn("inline-flex min-h-8 items-center gap-1.5 rounded-md text-left font-medium hover:text-teal", sum.failed ? "text-danger" : "text-subtle")}
      >
        {sum.failed ? <X className="size-3.5" aria-hidden /> : <ListTree className="size-3.5" aria-hidden />}
        <span>
          Agent steps: {sum.failed ? "a step failed" : `${sum.steps} done`}
          {turn.done && !cached ? ` · ${fmtDuration(turn.done.elapsed_ms)}` : ""}
          {cached ? " · saved run" : ""}
          {sum.corrected && !sum.failed ? ` · ${CORRECTED}` : ""}
        </span>
        <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <ol id={id} className="mt-2 flex max-w-md flex-col">
          {steps.map((s, i) => (
            <StepRow key={s.key} step={s} last={i === steps.length - 1} />
          ))}
        </ol>
      )}
    </div>
  );
}
