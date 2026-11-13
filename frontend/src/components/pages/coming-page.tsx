"use client";

// Explore and Compare are the next pages to be built. Until then they say so plainly and offer the
// closest thing that works today (an Ask question), so links from Home never lead to a dead end.
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { CITIES } from "@/lib/categories";
import { askHref } from "@/components/ds/ask-box";

export function ComingPage({ title, purpose }: { title: string; purpose: string }) {
  const params = useSearchParams();
  const raw = params.get("city");
  const city = CITIES.find((c) => c.toLowerCase() === raw?.toLowerCase()) ?? null;
  const q = city ? `How has PM2.5 in ${city} changed over the last 30 days?` : "Compare PM2.5 in Delhi and Mumbai over the last 30 days";
  return (
    <div className="mx-auto w-full max-w-[760px] px-4 pt-[104px] pb-28 sm:px-6 md:pt-[120px]">
      <h1 className="font-display text-[44px] leading-none sm:text-[56px]">{title}{city ? `: ${city}` : ""}</h1>
      <p className="mt-3 text-[17px] text-subtle">{purpose}</p>
      <div className="glass mt-8 rounded-2xl p-5">
        <p className="font-medium">This page is being built next.</p>
        <p className="mt-1 text-sm text-subtle">You can already ask about it in plain words:</p>
        <Link href={askHref(q)} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-teal px-4 text-sm font-semibold text-teal-ink hover:bg-teal-hover">
          {q}
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>
    </div>
  );
}
