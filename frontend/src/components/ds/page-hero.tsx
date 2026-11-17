"use client";

// Page header shared by Compare (and any page that wants it): a small eyebrow chip with a live dot, the title with a
// moving light, and a line that rises in. Decoration only; the h1 text stays plain for screen readers.
import { motion, useReducedMotion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function PageHero({ eyebrow, icon: Icon, title, children, className, aside }: {
  eyebrow: string; icon: LucideIcon; title: string; children?: React.ReactNode; className?: string;
  /** right-hand decoration or stats on wide screens */
  aside?: React.ReactNode;
}) {
  const reduce = useReducedMotion();
  const rise = (i: number) => reduce ? {} : {
    initial: { opacity: 0, y: 14, filter: "blur(6px)" }, animate: { opacity: 1, y: 0, filter: "blur(0px)" },
    transition: { duration: 0.6, delay: 0.06 * i, ease: [0.16, 1, 0.3, 1] as const },
  };
  return (
    <header className={cn("relative mb-8 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between", className)}>
      <div className="min-w-0">
        <motion.span {...rise(0)} className="inline-flex h-7 items-center gap-2 rounded-full border border-teal/25 bg-teal/[0.08] pr-3 pl-2.5 text-[12.5px] font-medium text-teal">
          <span aria-hidden className="sq-live size-1.5 rounded-full bg-teal text-teal" />
          <Icon className="size-3.5" aria-hidden />
          {eyebrow}
        </motion.span>
        <motion.h1 {...rise(1)} className="page-title sq-title-grad mt-4">{title}</motion.h1>
        {children && <motion.div {...rise(2)} className="mt-3 max-w-[720px]">{children}</motion.div>}
      </div>
      {aside && <motion.div {...rise(3)} className="shrink-0">{aside}</motion.div>}
    </header>
  );
}
