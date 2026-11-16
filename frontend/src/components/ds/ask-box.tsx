"use client";

// The question box used on Home: typing a question (or choosing a suggestion) opens Ask with it.
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function askHref(q: string): string {
  return `/ask?q=${encodeURIComponent(q.trim())}`;
}

export function AskBox({ placeholder, hint, suggestions = [], className }: {
  placeholder: string;
  hint?: string;
  suggestions?: string[];
  className?: string;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const go = (text: string) => {
    if (text.trim()) router.push(askHref(text));
  };
  return (
    <div className={className}>
      <form
        role="search"
        aria-label="Ask a question"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) go(q);
          else input.current?.focus();
        }}
        className="card sq-ring flex items-center gap-2 rounded-2xl py-2 pr-2 pl-5 focus-within:border-teal/60 focus-within:shadow-[0_0_0_4px_rgb(45_212_191/0.1),var(--shadow-card)]"
      >
        <label htmlFor="home-q" className="sr-only">Your question</label>
        <input
          ref={input}
          id="home-q"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          maxLength={500}
          placeholder={placeholder}
          autoComplete="off"
          className="h-11 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-faint sm:text-base"
        />
        <button
          type="submit"
          className="sq-shine group/ask inline-flex h-11 shrink-0 items-center gap-1.5 rounded-xl bg-gradient-to-b from-[#5EEAD4] to-teal px-5 text-sm font-semibold text-teal-ink shadow-[0_6px_20px_-6px_rgb(45_212_191/0.6)] transition-all hover:brightness-110"
        >
          Ask
          <ArrowRight className="size-4 transition-transform group-hover/ask:translate-x-0.5" aria-hidden />
        </button>
      </form>
      {hint && <p className="mt-2.5 px-1 text-[13px] text-faint">{hint}</p>}
      {suggestions.length > 0 && (
        /* Phones: one row that scrolls sideways; wider screens wrap. */
        <ul className="-mx-4 mt-3 flex snap-x gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:mx-0 md:flex-wrap md:overflow-visible md:px-0 md:pb-0" aria-label="Suggested questions">
          {suggestions.map((s) => (
            <li key={s} className="shrink-0 snap-start md:shrink">
              <button
                type="button"
                onClick={() => go(s)}
                className={cn(
                  "rounded-full border border-line bg-white/[0.03] px-3 py-1.5 text-left text-[13px] whitespace-nowrap text-subtle transition-all duration-200 md:whitespace-normal",
                  "hover:-translate-y-px hover:border-teal/50 hover:bg-teal/[0.06] hover:text-foreground",
                )}
              >
                {s}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
