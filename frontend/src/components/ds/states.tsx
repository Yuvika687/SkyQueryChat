"use client";

// Loading, error and wake-up states, plus the one entrance animation used across the app.
import { motion, useReducedMotion } from "framer-motion";
import { CloudOff, Loader2, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

export function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return <div aria-hidden className={cn("sq-shimmer rounded-lg bg-raised/70", className)} {...props} />;
}

/** Shown when the free backend is asleep (it wakes on the first request). */
export function WakeUpState({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <div role="status" className={cn("glass flex items-start gap-3 rounded-2xl px-4 py-3.5", className)}>
      <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-teal" aria-hidden />
      <div className="min-w-0">
        <p className="text-sm font-medium">Waking up the data server, this can take up to a minute</p>
        {!compact && <p className="mt-0.5 text-[13px] text-subtle">The free server sleeps when nobody is using it. The page fills in on its own once it is ready.</p>}
      </div>
    </div>
  );
}

export function ErrorState({ title, message, onRetry, className }: {
  title: string;
  message: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div role="alert" className={cn("glass flex items-start gap-3 rounded-2xl px-4 py-3.5", className)}>
      <CloudOff className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-0.5 text-[13px] text-subtle">{message}</p>
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-line-strong px-3 text-xs font-medium hover:border-teal hover:text-teal"
        >
          <RotateCcw className="size-3.5" aria-hidden />
          Try again
        </button>
      )}
    </div>
  );
}

/** Subtle fade-and-rise on first appearance. Off for visitors who prefer reduced motion. */
export function FadeIn({ children, delay = 0, className, as = "div" }: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
  as?: "div" | "section" | "li";
}) {
  const reduce = useReducedMotion();
  const M = motion[as];
  if (reduce) {
    const Tag = as;
    return <Tag className={className}>{children}</Tag>;
  }
  return (
    <M
      className={className}
      initial={{ opacity: 0, y: 10 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -40px 0px" }}
      transition={{ duration: 0.45, delay, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </M>
  );
}

/** Friendly empty state for a chart, table or panel: what is missing and what to try. */
export function EmptyNote({ title, hint, className }: { title: string; hint?: string; className?: string }) {
  return (
    <div className={cn("rounded-xl border border-dashed border-line px-4 py-5 text-center", className)}>
      <p className="text-[13.5px] font-medium">{title}</p>
      {hint && <p className="mt-1 text-[12.5px] text-subtle">{hint}</p>}
    </div>
  );
}
