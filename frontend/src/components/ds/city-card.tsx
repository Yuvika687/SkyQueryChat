"use client";

import Link from "next/link";
import { fmtDate } from "@/lib/format";
import type { LatestCity } from "@/lib/types";
import { CategoryBadge, ScaleBar, Sparkline, StatNumber, categoryOf } from "./data-display";

/** One city's latest available value: figure, category, scale bar, stations reporting and 7 days. */
export function CityCard({ city, rank, date, pollutantLabel = "PM2.5" }: {
  city: LatestCity;
  rank: number;
  date: string;
  pollutantLabel?: string;
}) {
  const cat = categoryOf(city.value, "pm25");
  return (
    <Link
      href={`/explore?city=${encodeURIComponent(city.city)}`}
      className="glass group flex h-full flex-col rounded-2xl p-5 shadow-card transition-colors hover:border-line-strong"
      aria-label={`${city.city}: ${city.value} µg/m³ ${pollutantLabel}, ${cat ?? "no category"}, ${fmtDate(date)}. Open in Explore.`}
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-baseline gap-2.5 text-base font-semibold">
          <span className="num text-xs font-medium text-faint" aria-hidden>{String(rank).padStart(2, "0")}</span>
          {city.city}
        </h3>
        <CategoryBadge category={cat} label={`${pollutantLabel} category`} />
      </div>
      <p className="mt-3 mb-4 flex items-baseline gap-1.5">
        <StatNumber value={city.value} className="text-[40px] leading-none font-medium tracking-tight" />
        <span className="text-sm text-subtle">µg/m³</span>
      </p>
      <ScaleBar value={city.value} scale="pm25" />
      <div className="mt-auto flex items-end justify-between gap-3 pt-4 text-[12.5px] text-faint">
        <span>{city.stations_reporting} of {city.stations_total} stations reporting</span>
        <span className="flex items-end gap-2">
          <span className="text-[11px]">7 days</span>
          <Sparkline points={city.series} width={104} height={28} />
        </span>
      </div>
    </Link>
  );
}
