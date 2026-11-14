"use client";

// A short term (PM2.5, AQI, CPCB, µg/m³) with its full form in a small tooltip. Opens on hover, keyboard focus
// and tap; Escape or a tap elsewhere closes it. The tooltip is portalled to <body> with fixed positioning, so it is
// never clipped by cards or scroll areas. Inside a link or button (where a second control is not allowed) use
// `plain`: the term becomes an <abbr> whose full form is in its title and in the accessible name of the parent.
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { GLOSSARY, type TermKey } from "@/lib/glossary";
import { cn } from "@/lib/utils";

export function Term({ k, children, plain, className }: {
  k: TermKey;
  /** Text to show instead of the short form (for example "PM10" written in a sentence). */
  children?: React.ReactNode;
  plain?: boolean;
  className?: string;
}) {
  const g = GLOSSARY[k];
  const label = children ?? g.short;
  if (plain) {
    return <abbr title={g.full} className={cn("no-underline", className)}>{label}</abbr>;
  }
  return <TermTip full={g.full} className={className}>{label}</TermTip>;
}

function TermTip({ full, children, className }: { full: string; children: React.ReactNode; className?: string }) {
  const id = useId();
  const btn = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false); // opened by a tap/click: stays until tapped again or elsewhere
  const [pos, setPos] = useState<{ left: number; top: number; below: boolean } | null>(null);

  const place = useCallback(() => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const below = r.top < 56;
    const half = 130; // tooltip max width is 260px: keep it inside the window
    const left = Math.min(Math.max(r.left + r.width / 2, half + 8), window.innerWidth - half - 8);
    setPos({ left, top: below ? r.bottom + 6 : r.top - 6, below });
  }, []);

  useLayoutEffect(() => { if (open) place(); }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== "Escape") return;
      if (e.type === "pointerdown" && btn.current?.contains(e.target as Node)) return;
      setOpen(false); setPinned(false);
    };
    const move = () => place();
    window.addEventListener("keydown", close);
    window.addEventListener("pointerdown", close);
    window.addEventListener("scroll", move, true);
    window.addEventListener("resize", move);
    return () => {
      window.removeEventListener("keydown", close);
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("scroll", move, true);
      window.removeEventListener("resize", move);
    };
  }, [open, place]);

  return (
    <>
      <button
        ref={btn}
        type="button"
        data-term
        aria-expanded={open}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => { if (!pinned) setOpen(false); }}
        // keyboard focus only: dialogs that move focus here on open (a mouse click) should not pop the tooltip
        onFocus={(e) => { if (safeMatches(e.currentTarget, ":focus-visible")) setOpen(true); }}
        onBlur={() => { setOpen(false); setPinned(false); }}
        onClick={() => { const next = !pinned; setPinned(next); setOpen(next); }}
        className={cn(
          "inline cursor-help rounded-[3px] p-0 align-baseline font-[inherit] text-inherit underline decoration-current/40 decoration-dotted underline-offset-[3px] hover:decoration-current focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-teal",
          className,
        )}
      >
        {children}
        <span className="sr-only"> ({full})</span>
      </button>
      {open && pos && typeof document !== "undefined" && createPortal(
        <span
          id={id}
          role="tooltip"
          className="pointer-events-none fixed z-[100] w-max max-w-[260px] rounded-lg border border-line-strong bg-raised px-2.5 py-1.5 text-center text-xs leading-snug font-normal text-foreground shadow-float"
          style={{ left: pos.left, top: pos.top, transform: `translate(-50%, ${pos.below ? "0" : "-100%"})` }}
        >
          {full}
        </span>,
        document.body,
      )}
    </>
  );
}

function safeMatches(el: Element, sel: string): boolean {
  try { return el.matches(sel); } catch { return true; }   // older engines without :focus-visible: keep focus opening it
}
