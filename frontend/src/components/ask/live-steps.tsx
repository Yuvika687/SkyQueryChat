"use client";

// The agent's real steps from the stream (plan, each tool, number checks, writing), shown one by one while it
// works, then collapsed into "How this answer was made · N steps · 9.4 s". The model's name appears only here.
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Check, ChevronDown, Loader2, PenLine, RotateCcw, Search, ShieldCheck, Wrench } from "lucide-react";
import type { Turn } from "@/lib/chat-state";
import { readable } from "@/lib/format";
import { summariseArgs } from "@/lib/timeline";
import type { StepEvent } from "@/lib/types";
import { cn } from "@/lib/utils";

const TOOL: Record<string, string> = {
  check_request: "Checked the question is in the data",
  city_trend: "Loaded the city's daily values",
  compare_cities: "Compared the cities on matching days",
  diwali_aqi: "Loaded official CPCB bulletins around Diwali",
  delhi_pm_diwali: "Loaded Delhi's measured PM around Diwali",
  unusual_days: "Looked for unusual days",
  weather_association: "Matched air quality with modelled weather",
  data_coverage: "Checked data coverage",
};

export interface ShownStep { key: string; icon: "plan" | "tool" | "check" | "fix" | "write"; text: string; sub?: string }

/** Plain-language steps from the raw events; no prompts, keys or model output. */
export function shownSteps(events: StepEvent[], answered: boolean): ShownStep[] {
  const out: ShownStep[] = [];
  for (const e of events) {
    const d = e.detail ?? {};
    if (e.type === "plan") {
      const t = readable(String(d.summary ?? e.title).replace(/^Plan:\s*/i, ""));
      out.push({ key: `p${e.seq}`, icon: "plan", text: t.charAt(0).toUpperCase() + t.slice(1) });
    }
    else if (e.type === "tool_call") {
      const args = d.args as Record<string, unknown> | undefined;
      out.push({ key: `t${e.seq}`, icon: "tool", text: TOOL[e.title] ?? `Used ${e.title.replace(/_/g, " ")}`, sub: summariseArgs(args) || undefined });
    } else if (e.type === "tool_error") {
      const last = out[out.length - 1];
      if (last?.icon === "tool") last.sub = "skipped: not needed for this question";
    } else if (e.type === "retry") out.push({ key: `r${e.seq}`, icon: "fix", text: "Corrected a number before answering" });
    else if (e.type === "verification" && e.title === "passed") {
      const n = d.checked_numbers as number | undefined;
      out.push({ key: `v${e.seq}`, icon: "check", text: n ? `Checked all ${n} numbers against the analysis` : "Checked every number" });
    }
  }
  if (answered) out.push({ key: "write", icon: "write", text: "Wrote the answer" });
  return out;
}

const ICONS = { plan: Search, tool: Wrench, check: ShieldCheck, fix: RotateCcw, write: PenLine };

export function LiveSteps({ turn }: { turn: Turn }) {
  const reduce = useReducedMotion();
  const steps = shownSteps(turn.steps, false);
  return (
    <ol aria-label="What the analyst is doing" className="flex flex-col gap-2">
      <AnimatePresence initial={false}>
        {steps.map((s, i) => {
          const Icon = ICONS[s.icon];
          return (
            <motion.li
              key={s.key}
              initial={reduce ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
              className="flex items-start gap-2.5 text-[13.5px]"
            >
              <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-teal/10 text-teal">
                {i === steps.length - 1 ? <Loader2 className="size-3 animate-spin" aria-hidden /> : <Check className="size-3" aria-hidden />}
              </span>
              <span>
                <span className="text-foreground">{s.text}</span>
                {s.sub && <span className="block text-[12px] text-faint">{s.sub}</span>}
              </span>
              <Icon className="sr-only" aria-hidden />
            </motion.li>
          );
        })}
      </AnimatePresence>
      {!steps.length && (
        <li className="flex items-center gap-2.5 text-[13.5px] text-subtle">
          <Loader2 className="size-4 animate-spin text-teal" aria-hidden />Reading the question
        </li>
      )}
    </ol>
  );
}

function seconds(t: Turn): string | null {
  // a saved answer is served at once: show how long the original run took (from its step times)
  if (t.done?.elapsed_ms != null && !t.done.cached) return `${(t.done.elapsed_ms / 1000).toFixed(1)} s`;
  const ts = t.steps.map((s) => (s.ts ? Date.parse(s.ts) : NaN)).filter(Number.isFinite);
  return ts.length > 1 ? `${((Math.max(...ts) - Math.min(...ts)) / 1000).toFixed(1)} s` : null;
}

/** Collapsed "How this answer was made" summary; expands to the steps (and the model's name). */
export function StepsSummary({ turn, open, className }: { turn: Turn; open?: boolean; className?: string }) {
  const steps = shownSteps(turn.steps, !!turn.answer);
  if (!steps.length) return null;
  const model = (turn.answer?.model || turn.done?.model || "").replace(/^.*:/, "");
  const secs = seconds(turn);
  return (
    <details className={cn("group rounded-xl border border-line bg-white/[0.02]", className)} open={open}>
      <summary className="flex cursor-pointer list-none items-center gap-2.5 px-3.5 py-2.5 text-[13px] text-subtle [&::-webkit-details-marker]:hidden">
        <span className="grid size-5 place-items-center rounded-full bg-teal/15 text-teal"><Check className="size-3" aria-hidden /></span>
        <span><b className="font-semibold text-foreground">How this answer was made</b> · {steps.length} steps{secs ? ` · ${secs}` : ""}</span>
        <ChevronDown className="ml-auto size-4 transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <ol className="flex flex-col gap-1.5 px-4 pb-3 pl-11 text-[13px]">
        {steps.map((s) => (
          <li key={s.key} className="list-decimal text-subtle">
            <span className="text-foreground">{s.text}</span>
            {s.sub && <span className="text-faint"> · {s.sub}</span>}
          </li>
        ))}
        {model && <li className="list-none pt-1 text-[12px] text-faint">Written by {model}; Python calculated every number.</li>}
      </ol>
    </details>
  );
}
