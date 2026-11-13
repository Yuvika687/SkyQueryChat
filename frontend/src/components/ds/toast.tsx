"use client";

// Small confirmation toasts ("Link copied", "Chart downloaded"). One polite live region; motion follows the
// visitor's reduced-motion setting (MotionConfig in Providers).
import { AnimatePresence, motion } from "framer-motion";
import { Check, CircleAlert } from "lucide-react";
import { createContext, useCallback, useContext, useRef, useState } from "react";

type Toast = { id: number; text: string; tone: "ok" | "error" };
const Ctx = createContext<(text: string, tone?: "ok" | "error") => void>(() => {});
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const next = useRef(1);
  const show = useCallback((text: string, tone: "ok" | "error" = "ok") => {
    const id = next.current++;
    setItems((xs) => [...xs.slice(-2), { id, text, tone }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 2600);
  }, []);
  return (
    <Ctx.Provider value={show}>
      {children}
      <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-[calc(96px+env(safe-area-inset-bottom))] z-[70] flex flex-col items-center gap-2 px-4 md:bottom-6">
        <AnimatePresence initial={false}>
          {items.map((t) => (
            <motion.p key={t.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }} transition={{ duration: 0.18 }}
              className="glass inline-flex items-center gap-2 rounded-full px-4 py-2 text-[13px] font-medium shadow-float">
              {t.tone === "ok" ? <Check className="size-4 text-teal" aria-hidden /> : <CircleAlert className="size-4 text-danger" aria-hidden />}
              {t.text}
            </motion.p>
          ))}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  );
}

/** Copy text, with a toast either way (clipboard can be blocked). */
export async function copyText(text: string, toast: (t: string, tone?: "ok" | "error") => void, done = "Copied") {
  try {
    await navigator.clipboard.writeText(text);
    toast(done);
  } catch {
    toast("Copying is blocked in this browser", "error");
  }
}

/** Save a file in the browser. */
export function download(name: string, body: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** CSV text from rows (quoted where needed). */
export function toCSV(rows: (string | number | null | undefined)[][]): string {
  const cell = (v: string | number | null | undefined) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(cell).join(",")).join("\n") + "\n";
}
