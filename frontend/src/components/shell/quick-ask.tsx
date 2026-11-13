"use client";

// Quick ask: Cmd+K (Mac) or Ctrl+K from any page opens a small question box with four suggestions; it opens Ask.
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, CornerDownLeft, Search } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { askHref } from "@/components/ds/ask-box";

export const QUICK_QUESTIONS = [
  "How bad was Delhi's air on Diwali 2026?",
  "Compare Delhi and Mumbai over the last 30 days",
  "Is rain associated with lower PM2.5 in Mumbai?",
  "Which of the six cities had the highest PM2.5 in winter 2025?",
];

const Ctx = createContext<() => void>(() => {});
export const useQuickAsk = () => useContext(Ctx);

export function isMac() {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
}

export function QuickAskProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const back = useRef<HTMLElement | null>(null);
  const show = useCallback(() => {
    back.current = document.activeElement as HTMLElement | null;
    setOpen(true);
  }, []);
  const close = useCallback(() => {
    setOpen(false);
    setTimeout(() => back.current?.focus?.(), 0);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (open) close();
        else show();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, show, close]);
  return (
    <Ctx.Provider value={show}>
      {children}
      <AnimatePresence>{open && <QuickAsk onClose={close} />}</AnimatePresence>
    </Ctx.Provider>
  );
}

function QuickAsk({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  const go = (text: string) => {
    const t = text.trim();
    if (!t) return;
    onClose();
    router.push(askHref(t));
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
    if (e.key !== "Tab" || !box.current) return;
    // keep focus inside the box
    const f = [...box.current.querySelectorAll<HTMLElement>("input, button")];
    const i = f.indexOf(document.activeElement as HTMLElement);
    if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
  };
  return (
    <motion.div className="fixed inset-0 z-[80] flex items-start justify-center bg-[#02050c]/70 px-4 pt-[14vh] backdrop-blur-sm"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <motion.div ref={box} role="dialog" aria-modal="true" aria-label="Quick ask" onKeyDown={onKey}
        initial={{ opacity: 0, y: -8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4, scale: 0.99 }}
        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-[560px] overflow-hidden rounded-2xl border border-line-strong bg-[#0d1528]/[0.98] shadow-float">
        <form onSubmit={(e) => { e.preventDefault(); go(q); }} className="flex items-center gap-3 border-b border-line px-4">
          <Search className="size-4 shrink-0 text-teal" aria-hidden />
          <label htmlFor="quick-q" className="sr-only">Ask a question</label>
          <input id="quick-q" ref={input} value={q} onChange={(e) => setQ(e.target.value)} maxLength={500} autoComplete="off"
            placeholder="Ask about the air in the six cities" className="h-14 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-faint" />
          <button type="submit" disabled={!q.trim()} aria-label="Ask"
            className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg bg-teal px-2.5 text-xs font-semibold text-teal-ink disabled:opacity-40">
            Ask <CornerDownLeft className="size-3.5" aria-hidden />
          </button>
        </form>
        <p className="px-4 pt-3 pb-1 text-[11px] font-medium tracking-wide text-faint uppercase">Suggestions</p>
        <ul className="px-2 pb-2">
          {QUICK_QUESTIONS.map((s) => (
            <li key={s}>
              <button type="button" onClick={() => go(s)}
                className="group flex min-h-11 w-full items-center justify-between gap-3 rounded-xl px-3 text-left text-[14px] text-subtle hover:bg-white/[0.05] hover:text-foreground focus-visible:bg-white/[0.05] focus-visible:text-foreground">
                {s}<ArrowRight className="size-4 shrink-0 text-teal opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
        <p className="border-t border-line px-4 py-2 text-[11.5px] text-faint">Opens Ask. Esc to close.</p>
      </motion.div>
    </motion.div>
  );
}
