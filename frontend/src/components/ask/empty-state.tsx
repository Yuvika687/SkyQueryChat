"use client";

import { ArrowUpRight, CalendarDays, CalendarHeart, CheckCircle2, CloudRain, GitCompareArrows, LineChart, MapPinned, Sparkles } from "lucide-react";

// Exact questions from docs/ui-design-spec.md (Ask screen, empty state).
export const SUGGESTED = [
  { q: "Compare Delhi and Mumbai over the last 30 days", icon: GitCompareArrows },
  { q: "Was Delhi worse around Diwali 2025 than Diwali 2024?", icon: CalendarHeart },
  { q: "Show PM2.5 levels in Kolkata for the last 30 days", icon: LineChart },
  { q: "Is rain associated with lower PM2.5 in Mumbai?", icon: CloudRain },
];

/** Any festival, any date, any bulletin city: a slow endless row of examples (pauses on hover). */
export const OCCASIONS = [
  "Rohtak AQI on Diwali 2025 and 2026",
  "Delhi AQI on Holi 2026",
  "Lucknow AQI on 9 November",
  "Patna air on Chhath Puja",
  "Kolkata during Durga Puja 2025",
  "Jaipur on New Year 2026",
  "Mumbai on Ganesh Chaturthi",
  "Chandigarh on Dussehra 2026",
  "Varanasi on Dev Deepawali",
  "Delhi on Christmas 2025",
];

const POINTS = [
  { icon: MapPinned, text: "329 CPCB cities" },
  { icon: CalendarDays, text: "Any festival or date" },
  { icon: CheckCircle2, text: "Every number checked" },
];

export function EmptyState({ onAsk, disabled }: { onAsk: (q: string) => void; disabled?: boolean }) {
  const chip = (q: string, k: string, hidden?: boolean) => (
    <button key={k} type="button" disabled={disabled} onClick={() => onAsk(q)} tabIndex={hidden ? -1 : undefined}
      className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-white/[0.07] bg-white/[0.04] px-3.5 text-[13.5px] whitespace-nowrap text-subtle transition-all hover:-translate-y-0.5 hover:border-teal/40 hover:bg-teal/[0.08] hover:text-foreground disabled:opacity-60">
      <Sparkles className="size-3.5 text-teal" aria-hidden />{q}
    </button>
  );
  return (
    <section className="mx-auto flex w-full max-w-[760px] flex-col gap-7 px-4 py-8 sm:py-14" aria-labelledby="empty-title">
      <div className="sq-card-in flex flex-col items-start gap-5 sm:flex-row sm:items-center">
        {/* decoration: a small glowing "sky" orb with orbiting rings */}
        <span aria-hidden className="sq-float relative grid size-16 shrink-0 place-items-center">
          <span className="sq-ripple absolute inset-0 rounded-full border border-teal/50" />
          <span className="sq-ripple absolute inset-0 rounded-full border border-teal/40" style={{ animationDelay: "1.3s" }} />
          <span className="size-10 rounded-full shadow-[0_0_40px_rgb(45_212_191/0.55)]"
            style={{ background: "radial-gradient(circle at 35% 30%, #CFFAF4, #5EEAD4 30%, #14B8A6 60%, #0B3F3A 100%)" }} />
        </span>
        <div>
          <h2 id="empty-title" className="sq-title-grad text-[26px] leading-8 font-semibold tracking-tight">Hi! What would you like to know about the air?</h2>
          <p className="mt-2 text-sm leading-6 text-subtle">
            Ask about PM2.5, PM10 or official AQI in Delhi, Mumbai, Kolkata, Chennai, Bengaluru or Hyderabad, or the official
            AQI in any of 329 CPCB bulletin cities, on any festival or date. Every number in an answer is calculated from
            real data and checked; click one to see where it came from.
          </p>
          <p className="mt-3 flex flex-wrap gap-2">
            {POINTS.map(({ icon: Icon, text }) => (
              <span key={text} className="inline-flex h-7 items-center gap-1.5 rounded-full bg-teal/[0.08] px-2.5 text-[12.5px] font-medium text-teal">
                <Icon className="size-3.5" aria-hidden />{text}
              </span>
            ))}
          </p>
        </div>
      </div>
      <ul className="sq-stagger grid grid-cols-1 gap-3 min-[480px]:grid-cols-2">
        {SUGGESTED.map(({ q, icon: Icon }) => (
          <li key={q}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onAsk(q)}
              className="card sq-glow group sq-lift flex h-full min-h-[76px] w-full items-start gap-3 rounded-2xl p-4 text-left text-sm transition-colors hover:-translate-y-0.5 disabled:opacity-60"
            >
              <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-xl bg-teal/10 text-teal transition-transform duration-300 group-hover:scale-110 group-hover:rotate-[-6deg]">
                <Icon className="size-[18px]" />
              </span>
              <span className="flex-1 pt-1.5 font-medium">{q}</span>
              <ArrowUpRight className="mt-1.5 size-4 shrink-0 text-subtle transition-all group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-teal" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
      <div className="sq-card-in" style={{ animationDelay: "0.25s" }}>
        <p className="mb-2.5 inline-flex items-center gap-1.5 text-[12px] font-medium tracking-[0.08em] text-faint uppercase">
          <CalendarHeart className="size-3.5 text-teal" aria-hidden />Festivals and dates, any city
        </p>
        <div className="sq-marquee -mx-1 px-1 py-1" role="group" aria-label="Festival and date questions">
          <div className="sq-marquee-track">
            {OCCASIONS.map((q) => chip(q, q))}
            {/* the second copy only makes the loop seamless */}
            <span aria-hidden className="contents">{OCCASIONS.map((q) => chip(q, `${q}-2`, true))}</span>
          </div>
        </div>
      </div>
    </section>
  );
}
