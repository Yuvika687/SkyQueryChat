"use client";

// Page section card: a serif title, a one-line purpose and the content.
import { motion } from "framer-motion";
import { useId } from "react";
import { cn } from "@/lib/utils";

export function Section({ id, title, line, action, className, children }: {
  id: string;
  title: string;
  line?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className={cn("card min-w-0 p-5 sm:p-6", className)}>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={id} className="section-title">{title}</h2>
          {line && <p className="mt-1.5 text-[14px] text-subtle">{line}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Two- or three-way switch (pollutant, weather variable, metric). */
export function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  const id = useId();
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-xl bg-white/[0.05] p-0.5">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}
          className={cn("relative isolate min-h-9 rounded-[10px] px-3 text-[13px] font-medium transition-colors duration-200",
            value === o.value ? "text-teal-ink" : "text-subtle hover:text-foreground")}>
          {value === o.value && (
            <motion.span layoutId={`seg-${id}`} aria-hidden transition={{ type: "spring", stiffness: 460, damping: 36 }}
              className="absolute inset-0 -z-10 rounded-[10px] bg-gradient-to-b from-[#5EEAD4] to-teal shadow-[0_4px_16px_-4px_rgb(45_212_191/0.6)]" />
          )}
          {o.label}
        </button>
      ))}
    </div>
  );
}
