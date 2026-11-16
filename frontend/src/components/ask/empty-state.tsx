"use client";

import { ArrowUpRight, CalendarHeart, CloudRain, GitCompareArrows, LineChart } from "lucide-react";

// Exact questions from docs/ui-design-spec.md (Ask screen, empty state).
export const SUGGESTED = [
  { q: "Compare Delhi and Mumbai over the last 30 days", icon: GitCompareArrows },
  { q: "Was Delhi worse around Diwali 2025 than Diwali 2024?", icon: CalendarHeart },
  { q: "Show PM2.5 levels in Kolkata for the last 30 days", icon: LineChart },
  { q: "Is rain associated with lower PM2.5 in Mumbai?", icon: CloudRain },
];

export function EmptyState({ onAsk, disabled }: { onAsk: (q: string) => void; disabled?: boolean }) {
  return (
    <section className="sq-rise mx-auto flex w-full max-w-[760px] flex-col gap-7 px-4 py-8 sm:py-14" aria-labelledby="empty-title">
      <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center">
        {/* decoration: a small glowing "sky" orb with orbiting rings */}
        <span aria-hidden className="relative grid size-16 shrink-0 place-items-center">
          <span className="sq-ripple absolute inset-0 rounded-full border border-teal/50" />
          <span className="sq-ripple absolute inset-0 rounded-full border border-teal/40" style={{ animationDelay: "1.3s" }} />
          <span className="size-10 rounded-full shadow-[0_0_40px_rgb(45_212_191/0.55)]"
            style={{ background: "radial-gradient(circle at 35% 30%, #CFFAF4, #5EEAD4 30%, #14B8A6 60%, #0B3F3A 100%)" }} />
        </span>
        <div>
          <h2 id="empty-title" className="text-[26px] leading-8 font-semibold tracking-tight">Hi! What would you like to know about the air?</h2>
          <p className="mt-2 text-sm leading-6 text-subtle">
            Ask about PM2.5, PM10 or official AQI in Delhi, Mumbai, Kolkata, Chennai, Bengaluru or Hyderabad, or the official
            AQI in any of 329 CPCB bulletin cities. Every number in an answer is calculated from real data and checked;
            click one to see where it came from.
          </p>
        </div>
      </div>
      <ul className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2">
        {SUGGESTED.map(({ q, icon: Icon }, i) => (
          <li key={q} className="sq-rise" style={{ animationDelay: `${0.08 + i * 0.06}s` }}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onAsk(q)}
              className="card sq-glow group sq-lift flex h-full min-h-[76px] w-full items-start gap-3 rounded-2xl p-4 text-left text-sm transition-colors disabled:opacity-60"
            >
              <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-xl bg-teal/10 text-teal transition-transform duration-300 group-hover:scale-110">
                <Icon className="size-[18px]" />
              </span>
              <span className="flex-1 pt-1.5 font-medium">{q}</span>
              <ArrowUpRight className="mt-1.5 size-4 shrink-0 text-subtle transition-all group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-teal" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
