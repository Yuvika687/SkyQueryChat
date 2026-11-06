"use client";

import { ArrowUpRight, CalendarHeart, GitCompareArrows, LineChart, Sparkles, Wind } from "lucide-react";

// Exact questions from docs/ui-design-spec.md (Ask screen, empty state).
export const SUGGESTED = [
  { q: "Compare Delhi and Mumbai over the last 30 days", icon: GitCompareArrows },
  { q: "Was Delhi worse around Diwali 2025 than Diwali 2024?", icon: CalendarHeart },
  { q: "Show PM2.5 levels in Kolkata for the last 30 days", icon: LineChart },
  { q: "Which days were unusually polluted in Delhi?", icon: Sparkles },
  { q: "How did wind speed relate to PM2.5 in Hyderabad?", icon: Wind },
];

export function EmptyState({ onAsk, disabled }: { onAsk: (q: string) => void; disabled?: boolean }) {
  return (
    <section className="mx-auto flex w-full max-w-[760px] flex-col gap-6 px-4 py-10 sm:py-16" aria-labelledby="empty-title">
      <div>
        <h2 id="empty-title" className="text-[24px] leading-8 font-semibold">What do you want to know about the air?</h2>
        <p className="mt-2 text-sm text-subtle">
          PM2.5 and PM10 for Delhi, Mumbai, Kolkata, Chennai, Bengaluru and Hyderabad. Every answer shows its data type, period, stations, coverage and source.
        </p>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2">
        {SUGGESTED.map(({ q, icon: Icon }) => (
          <li key={q}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onAsk(q)}
              className="group flex min-h-[76px] w-full items-start gap-3 rounded-xl border border-line bg-surface p-4 text-left text-sm transition-colors hover:border-teal hover:bg-raised disabled:opacity-60"
            >
              <Icon className="mt-0.5 size-5 shrink-0 text-teal" aria-hidden />
              <span className="flex-1">{q}</span>
              <ArrowUpRight className="size-4 shrink-0 text-subtle group-hover:text-teal" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
