"use client";

import Link from "next/link";
import { fmtDate } from "@/lib/format";
import type { LatestCity } from "@/lib/types";
import { healthNote } from "@/lib/health";
import { CategoryBadge, ScaleBar, Sparkline, StatNumber, categoryOf } from "./data-display";
import { DayChange } from "./day-change";
import { OfficialAqiChip, officialAqiText } from "./official-aqi";
import { Term } from "./term";

/** One city's latest available value: figure, category, scale bar, stations reporting and 7 days.
 * Phones get a compact version (about a third of the height) with the same facts. */
export function CityCard({ city, rank, date, pollutantLabel = "PM2.5" }: {
  city: LatestCity;
  rank: number;
  date: string;
  pollutantLabel?: "PM2.5" | "PM10";
}) {
  const termKey = pollutantLabel === "PM10" ? "pm10" : "pm25";
  const cat = categoryOf(city.value, "pm25");
  const rankText = String(rank).padStart(2, "0");
  const health = healthNote(cat);
  return (
    <Link
      href={`/city/${city.city.toLowerCase()}`}
      className="glass group sq-lift flex h-full flex-col rounded-2xl px-4 py-3 shadow-card transition-colors hover:border-line-strong md:p-5"
      aria-label={`${city.city}: ${city.value} µg/m³ ${pollutantLabel}, ${cat ?? "no category"}, ${fmtDate(date)}${city.change != null && city.previous ? `, ${city.change > 0 ? "up" : city.change < 0 ? "down" : "no change"} ${Math.abs(city.change).toFixed(1)} from ${fmtDate(city.previous.date)}` : ""}, ${city.stations_reporting} of ${city.stations_total} stations reporting.${city.official_aqi ? ` ${officialAqiText(city.official_aqi)}.` : ""}${health ? ` CPCB health note: ${health}.` : ""} Open the city page.`}
    >
      {/* phone: two rows */}
      <div className="flex items-center gap-2.5 md:hidden">
        <span className="num w-5 text-xs text-faint" aria-hidden>{rankText}</span>
        <h3 className="min-w-0 truncate text-[15px] font-semibold">{city.city}</h3>
        <CategoryBadge category={cat} size="sm" />
        <span className="ml-auto flex items-baseline gap-1">
          <StatNumber value={city.value} className="text-[22px] leading-none font-medium" />
          <span className="text-[11px] text-subtle">µg/m³</span>
        </span>
      </div>
      <div className="mt-2 flex items-center gap-3 pl-[30px] md:hidden">
        <ScaleBar value={city.value} scale="pm25" showEnds={false} className="flex-1" />
        <DayChange change={city.change} previous={city.previous} className="text-[11px]" />
        <Sparkline points={city.series} width={72} height={20} />
      </div>
      <p className="mt-1.5 pl-[30px] text-[11px] text-faint md:hidden"><Term k={termKey} plain /> concentration, not <Term k="aqi" plain /></p>
      <div className="mt-1.5 pl-[30px] md:hidden"><OfficialAqiChip aqi={city.official_aqi} size="sm" plain /></div>

      {/* wider screens: full card */}
      <div className="hidden items-center justify-between gap-3 md:flex">
        <h3 className="flex items-baseline gap-2.5 text-base font-semibold">
          <span className="num text-xs font-medium text-faint" aria-hidden>{rankText}</span>
          {city.city}
        </h3>
        <CategoryBadge category={cat} label={`${pollutantLabel} category`} />
      </div>
      <p className="mt-3 hidden items-baseline gap-1.5 md:flex">
        <StatNumber value={city.value} className="text-[40px] leading-none font-medium tracking-tight" />
        <span className="text-sm text-subtle">µg/m³</span>
        <DayChange change={city.change} previous={city.previous} className="ml-auto self-center" />
      </p>
      <p className="mt-1 mb-3 hidden text-xs text-faint md:block">
        <Term k={termKey} plain /> concentration (<Term k="ugm3" plain />), not <Term k="aqi" plain />
      </p>
      <ScaleBar value={city.value} scale="pm25" className="hidden md:block" />
      <div className="mt-3 hidden md:block"><OfficialAqiChip aqi={city.official_aqi} plain /></div>
      <div className="mt-auto hidden items-end justify-between gap-3 pt-4 text-[12.5px] text-faint md:flex">
        {/* hover/focus: CPCB's health note for the category replaces the stations line (same space, no jump) */}
        <span className="relative min-h-8 flex-1">
          <span className="absolute inset-x-0 bottom-0 transition-opacity duration-200 group-hover:opacity-0 group-focus-visible:opacity-0">{city.stations_reporting} of {city.stations_total} stations reporting</span>
          {health && <span aria-hidden className="absolute inset-x-0 bottom-0 line-clamp-2 leading-4 text-subtle opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100">CPCB: {health}</span>}
        </span>
        <span className="flex items-end gap-2">
          <span className="text-[11px]">7 days</span>
          <Sparkline points={city.series} width={104} height={28} />
        </span>
      </div>
    </Link>
  );
}
