import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";

export const metadata: Metadata = { title: "Page not found · SkyQueryChat", robots: { index: false } };

const PLACES = [
  { href: "/", name: "Home", line: "The latest available values for the six cities." },
  { href: "/explore", name: "Explore", line: "Every monitoring station on a map." },
  { href: "/ask", name: "Ask", line: "Ask any question about the six cities' air." },
  { href: "/compare", name: "Compare", line: "Put cities side by side over the same dates." },
];

export default function NotFound() {
  return (
    <div className="mx-auto w-full max-w-[760px] px-4 pt-[104px] pb-28 sm:px-6 md:pt-[136px]">
      <p className="text-[12px] font-semibold tracking-[0.08em] text-teal uppercase">404</p>
      <h1 className="mt-2 font-display text-[48px] leading-none sm:text-[64px]">This page doesn&apos;t exist</h1>
      <p className="mt-4 text-[16px] text-subtle">The link may be old or mistyped. SkyQueryChat covers Delhi, Mumbai, Kolkata, Chennai, Bengaluru and Hyderabad.</p>
      <p className="mt-1 text-[13.5px] text-faint">Pick a place to continue.</p>
      <ul className="mt-8 grid gap-3 sm:grid-cols-2">
        {PLACES.map((p) => (
          <li key={p.href}>
            <Link href={p.href} className="glass group flex min-h-20 items-center justify-between gap-3 rounded-2xl px-4 py-3 transition-colors hover:border-teal/60">
              <span><span className="block font-semibold">{p.name}</span><span className="block text-[13px] text-subtle">{p.line}</span></span>
              <ArrowRight className="size-4 shrink-0 text-teal transition-transform group-hover:translate-x-0.5" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
