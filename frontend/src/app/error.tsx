"use client";

// Any unexpected error on a page lands here: a calm message, a retry and a way home. No stack traces for visitors.
import Link from "next/link";
import { useEffect } from "react";
import { RotateCcw } from "lucide-react";

export default function PageError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.warn("page error", error.digest ?? "");
  }, [error]);
  return (
    <div className="mx-auto w-full max-w-[640px] px-4 pt-[120px] pb-28 sm:px-6">
      <p className="text-[12px] font-semibold tracking-[0.08em] text-teal uppercase">Something went wrong</p>
      <h1 className="mt-2 font-display text-[44px] leading-none sm:text-[56px]">This page hit a problem</h1>
      <p className="mt-4 text-[16px] text-subtle">It is on our side, not yours. Try again, or go back to the home page.</p>
      <div className="mt-8 flex flex-wrap gap-3">
        <button type="button" onClick={() => retry()} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-teal px-4 text-sm font-semibold text-teal-ink hover:bg-teal-hover">
          <RotateCcw className="size-4" aria-hidden />Try again
        </button>
        <Link href="/" className="inline-flex min-h-11 items-center rounded-xl border border-line-strong px-4 text-sm font-medium hover:border-teal hover:text-teal">Home</Link>
      </div>
    </div>
  );
}
