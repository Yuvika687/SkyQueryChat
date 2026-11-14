"use client";

// The official CPCB AQI for a date, as its own chip, kept visibly separate from the measured PM concentration.
// Comes only from our stored 4 PM bulletins; a missing bulletin says so (never estimated).
import { CATEGORY_STYLE, normaliseCategory } from "@/lib/categories";
import { fmtDate } from "@/lib/format";
import type { OfficialAqi } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Term } from "./term";

/** Plain-text form for accessible names: "Official AQI 313, Very poor (CPCB 4 PM bulletin, 11 Nov 2026)". */
export function officialAqiText(a: OfficialAqi | null | undefined): string {
  if (!a) return "";
  if (!a.available || a.aqi == null) return "Official AQI: bulletin not available";
  const cat = normaliseCategory(a.category);
  return `Official AQI (Air Quality Index) ${a.aqi}, ${cat ?? a.category} (CPCB 4 PM bulletin, ${fmtDate(a.date)})`;
}

export function OfficialAqiChip({ aqi, size = "md", plain, showSource = true, className }: {
  aqi: OfficialAqi | null | undefined;
  size?: "sm" | "md";
  /** Inside a link or button: no interactive tooltips. */
  plain?: boolean;
  showSource?: boolean;
  className?: string;
}) {
  if (!aqi) return null;
  const sm = size === "sm";
  const box = cn(
    "inline-flex max-w-full flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded-lg border border-line-strong bg-white/[0.03] text-subtle",
    sm ? "px-2 py-0.5 text-[11.5px]" : "px-2.5 py-1 text-[12.5px]",
    className,
  );
  if (!aqi.available || aqi.aqi == null) {
    return (
      <span data-testid="official-aqi" className={box}>
        <span>Official <Term k="aqi" plain={plain} />: bulletin not available</span>
      </span>
    );
  }
  const cat = normaliseCategory(aqi.category);
  const st = cat ? CATEGORY_STYLE[cat] : CATEGORY_STYLE.None;
  return (
    <span data-testid="official-aqi" className={box}>
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
        <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: st.bg }} />
        <span>Official <Term k="aqi" plain={plain} /></span>
        <b className="num font-semibold text-foreground">{aqi.aqi}</b>
        <span aria-hidden>·</span>
        <span className="font-medium text-foreground">{cat ?? aqi.category}</span>
      </span>
      {showSource && (
        <span className="whitespace-nowrap text-faint">
          (<Term k="cpcb" plain={plain} /> 4 PM bulletin, {fmtDate(aqi.date)})
        </span>
      )}
    </span>
  );
}
