"use client";

// Data display pieces: category badge, pollution scale bar, sparkline and a counting number.
// CPCB category colours are used only here (data meaning); each is paired with the category name.
import { useEffect, useRef, useState } from "react";
import { animate, useInView, useReducedMotion } from "framer-motion";
import { CATEGORY_STYLE, aqiCategory, pmCategory, type Category } from "@/lib/categories";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";

export type Scale = "pm25" | "pm10" | "aqi";

export function categoryOf(value: number | null | undefined, scale: Scale): Category | null {
  return scale === "aqi" ? aqiCategory(value) : pmCategory(value, scale);
}

// ------------------------------------------------------------------ CategoryBadge
export function CategoryBadge({ category, size = "md", label, className }: {
  category: Category | null;
  size?: "sm" | "md";
  /** Screen-reader prefix, e.g. "PM2.5 category". */
  label?: string;
  className?: string;
}) {
  const st = category ? CATEGORY_STYLE[category] : CATEGORY_STYLE.None;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-md font-semibold whitespace-nowrap",
        size === "sm" ? "h-5 px-1.5 text-[11px]" : "h-6 px-2 text-xs",
        className,
      )}
      style={{ background: st.bg, color: st.fg }}
    >
      {label && <span className="sr-only">{label}: </span>}
      {st.label}
    </span>
  );
}

// ------------------------------------------------------------------ ScaleBar
const ORDER: Category[] = ["Good", "Satisfactory", "Moderate", "Poor", "Very poor", "Severe"];
const RANGES: Record<Scale, [number, number][]> = {
  pm25: [[0, 30], [31, 60], [61, 90], [91, 120], [121, 250], [251, 350]],
  pm10: [[0, 50], [51, 100], [101, 250], [251, 350], [351, 430], [431, 510]],
  aqi: [[0, 50], [51, 100], [101, 200], [201, 300], [301, 400], [401, 500]],
};
const UNIT: Record<Scale, string> = { pm25: "µg/m³", pm10: "µg/m³", aqi: "AQI" };

/** Six equal segments from Good to Severe; the marker sits inside the value's own segment. */
export function ScaleBar({ value, scale, showEnds = true, className }: { value: number; scale: Scale; showEnds?: boolean; className?: string }) {
  const cat = categoryOf(value, scale) ?? "Severe";
  const i = ORDER.indexOf(cat);
  const [lo, hi] = RANGES[scale][i];
  const frac = Math.max(0.04, Math.min(0.96, (Math.round(value) - lo) / Math.max(1, hi - lo)));
  const left = ((i + frac) / 6) * 100;
  const [rlo, rhi] = RANGES[scale][i];
  const range = i === 5 ? `above ${rlo - 1}` : `${rlo}–${rhi}`;
  return (
    <div
      className={cn("relative", className)}
      role="img"
      aria-label={`${value} ${UNIT[scale]} is ${CATEGORY_STYLE[cat].label} (${range}${scale === "aqi" ? "" : " µg/m³"}), on a scale from Good to Severe`}
    >
      <div className="grid h-1.5 grid-cols-6 gap-0.5 overflow-hidden rounded-full opacity-90">
        {ORDER.map((c) => <span key={c} style={{ background: CATEGORY_STYLE[c].bg }} />)}
      </div>
      <span
        className="absolute -top-1 h-3.5 w-[3px] -translate-x-1/2 rounded-full bg-white shadow-[0_0_0_2px_var(--sq-bg)]"
        style={{ left: `${left.toFixed(1)}%` }}
        aria-hidden
      />
      {showEnds && (
        <div className="mt-1.5 flex justify-between text-[11px] leading-none text-faint" aria-hidden>
          <span>Good</span>
          <span>Severe</span>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Sparkline
/** Small line of daily values. Missing days stay as gaps. The last point gets a dot. */
export function Sparkline({ points, width = 112, height = 30, label, className }: {
  points: { date: string; value: number | null }[];
  width?: number;
  height?: number;
  label?: string;
  className?: string;
}) {
  const vals = points.map((p) => p.value).filter((v): v is number => v != null);
  if (vals.length < 2) return null;
  const min = Math.min(...vals), max = Math.max(...vals), pad = 3;
  const X = (i: number) => pad + (i * (width - 2 * pad)) / Math.max(1, points.length - 1);
  const Y = (v: number) => height - pad - ((v - min) / Math.max(1e-9, max - min)) * (height - 2 * pad);
  let d = "", pen = false;
  points.forEach((p, i) => {
    if (p.value == null) { pen = false; return; }
    d += `${pen ? "L" : "M"}${X(i).toFixed(1)},${Y(p.value).toFixed(1)}`;
    pen = true;
  });
  const lastI = points.length - 1, last = points[lastI];
  const desc = label ?? `Daily values ${fmtDate(points[0].date)} to ${fmtDate(last.date)}: ` +
    points.map((p) => (p.value == null ? "no value" : String(p.value))).join(", ");
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={desc} className={cn("text-[#9FB3D9]", className)}>
      <path d={d} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
      {last.value != null && <circle cx={X(lastI)} cy={Y(last.value)} r={2.6} fill="currentColor" />}
    </svg>
  );
}

// ------------------------------------------------------------------ StatNumber
/** A figure that counts up once when it comes into view. Reduced motion shows the final value at once.
 * The accessible text is always the exact final value. */
export function StatNumber({ value, decimals = 1, className }: { value: number; decimals?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const reduce = useReducedMotion();
  const final = value.toFixed(decimals);
  const [shown, setShown] = useState((0).toFixed(decimals));
  useEffect(() => {
    if (!inView || reduce) return;
    const c = animate(0, value, { duration: 0.9, ease: [0.16, 1, 0.3, 1], onUpdate: (v) => setShown(v.toFixed(decimals)) });
    return () => c.stop();
  }, [inView, reduce, value, decimals]);
  return (
    <span ref={ref} className={cn("num", className)}>
      <span aria-hidden>{reduce ? final : shown}</span>
      <span className="sr-only">{final}</span>
    </span>
  );
}
