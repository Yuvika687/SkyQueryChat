"use client";

// Explore side-panel pieces: controls, date player, legend, city ranking, station list and station panel.
import Link from "next/link";
import { ArrowLeft, MessageSquare, Pause, Play, X } from "lucide-react";
import { CATEGORY_STYLE, pmCategory, type Category } from "@/lib/categories";
import {
  LEGEND_RANGES, POLLUTANT_LABEL, dayStatus, fmtLastReading, rankCities, rankStations, stationQuestion, statusColour,
  type Pollutant,
} from "@/lib/explore";
import { fmtDate, fmtSpan } from "@/lib/format";
import type { ExploreData, ExploreStation } from "@/lib/types";
import { cn } from "@/lib/utils";
import { askHref } from "@/components/ds/ask-box";
import { CategoryBadge, ScaleBar, Sparkline } from "@/components/ds/data-display";

const ORDER: Category[] = ["Good", "Satisfactory", "Moderate", "Poor", "Very poor", "Severe"];

// ------------------------------------------------------------------ controls
export function PollutantToggle({ value, onChange }: { value: Pollutant; onChange: (p: Pollutant) => void }) {
  return (
    <div role="radiogroup" aria-label="Pollutant" className="inline-flex h-9 rounded-full border border-line-strong bg-background/40 p-0.5">
      {(["pm25", "pm10"] as Pollutant[]).map((p) => (
        <button
          key={p}
          type="button"
          role="radio"
          aria-checked={value === p}
          onClick={() => onChange(p)}
          className={cn("rounded-full px-3.5 text-[13px] font-medium", value === p ? "bg-teal text-teal-ink" : "text-subtle hover:text-foreground")}
        >
          {POLLUTANT_LABEL[p]}
        </button>
      ))}
    </div>
  );
}

export function LowCostToggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-[13px] text-subtle">
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
      <span aria-hidden className="relative h-5 w-9 rounded-full border border-line-strong bg-background/50 transition-colors peer-checked:border-teal peer-checked:bg-teal/30 peer-focus-visible:outline-2 peer-focus-visible:outline-teal after:absolute after:top-0.5 after:left-0.5 after:size-3.5 after:rounded-full after:bg-subtle after:transition-transform peer-checked:after:translate-x-4 peer-checked:after:bg-teal" />
      Low-cost sensors
    </label>
  );
}

export function TimeControl({ dates, day, onDay, playing, onPlay, canPlay, compact }: {
  dates: string[];
  day: number;
  onDay: (i: number) => void;
  playing: boolean;
  onPlay: () => void;
  canPlay: boolean;
  compact?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium tracking-wide text-faint uppercase">{day === dates.length - 1 ? "Latest available day" : "Selected day"}</p>
          <p className={cn("num font-display leading-none", compact ? "text-[30px]" : "text-[38px]")} aria-live="polite">{fmtDate(dates[day])}</p>
        </div>
        {canPlay ? (
          <button
            type="button"
            onClick={onPlay}
            className="inline-flex h-10 items-center gap-1.5 rounded-full bg-teal px-4 text-sm font-semibold text-teal-ink hover:bg-teal-hover"
          >
            {playing ? <Pause className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />}
            {playing ? "Pause" : "Play 30 days"}
          </button>
        ) : (
          <p className="max-w-[150px] text-right text-[11px] text-faint">Autoplay is off because your device asks for less motion.</p>
        )}
      </div>
      <label htmlFor="day-slider" className="sr-only">Day</label>
      <input
        id="day-slider"
        type="range"
        min={0}
        max={dates.length - 1}
        step={1}
        value={day}
        onChange={(e) => onDay(Number(e.target.value))}
        aria-valuetext={fmtDate(dates[day])}
        className="w-full accent-[var(--sq-accent)]"
      />
      <div className="flex justify-between text-[11px] text-faint">
        <span>{fmtDate(dates[0])}</span>
        <span>{fmtDate(dates[dates.length - 1])}</span>
      </div>
    </div>
  );
}

export function Legend({ pollutant }: { pollutant: Pollutant }) {
  return (
    <div aria-label={`${POLLUTANT_LABEL[pollutant]} categories, 24-hour mean in µg/m³`}>
      <p className="mb-1.5 text-[11px] text-faint">{POLLUTANT_LABEL[pollutant]} categories, 24-hour mean (µg/m³)</p>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11.5px] text-subtle">
        {ORDER.map((c, i) => (
          <li key={c} className="flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 shrink-0 rounded-[3px]" style={{ background: CATEGORY_STYLE[c].bg }} />
            <span className="whitespace-nowrap">{CATEGORY_STYLE[c].label} <span className="num text-faint">{LEGEND_RANGES[pollutant][i]}</span></span>
          </li>
        ))}
        <li className="col-span-2 flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 shrink-0 rounded-[3px] bg-[#64748B]" />
          <span>Grey: not enough data (under 16 valid hours) or no readings</span>
        </li>
      </ul>
    </div>
  );
}

// ------------------------------------------------------------------ lists
export function CityRanking({ data, day, onCity }: { data: ExploreData; day: number; onCity: (c: string) => void }) {
  const pol = data.pollutant;
  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold">Six cities, highest first</h2>
      <ol className="flex flex-col gap-1">
        {rankCities(data, day).map((c, i) => {
          const cat = pmCategory(c.value, pol);
          return (
            <li key={c.city}>
              <button
                type="button"
                onClick={() => onCity(c.city)}
                className="flex min-h-11 w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left hover:bg-white/[0.04]"
              >
                <span className="num w-5 text-xs text-faint" aria-hidden>{String(i + 1).padStart(2, "0")}</span>
                <span className="flex-1 font-medium">{c.city}</span>
                {c.value != null ? (
                  <>
                    <span className="num text-[15px] font-semibold">{c.value.toFixed(1)}</span>
                    <CategoryBadge category={cat} size="sm" />
                  </>
                ) : (
                  <span className="text-xs text-faint">No city value</span>
                )}
              </button>
            </li>
          );
        })}
      </ol>
      <p className="mt-2 text-[11.5px] text-faint">24-hour city average in µg/m³ on {fmtDate(data.dates[day])}. Choose a city to see its stations.</p>
    </div>
  );
}

export function StationList({ city, stations, day, date, pollutant, selected, onStation, onBack, cityValue }: {
  city: string;
  date: string;
  stations: ExploreStation[];
  day: number;
  pollutant: Pollutant;
  selected: number | null;
  onStation: (id: number) => void;
  onBack: () => void;
  cityValue: number | null;
}) {
  const ranked = rankStations(stations, day);
  const withValue = ranked.filter((s) => s.values[day] != null).length;
  return (
    <div>
      <button type="button" onClick={onBack} className="mb-2 inline-flex min-h-9 items-center gap-1.5 rounded-full text-[13px] text-subtle hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden />
        All six cities
      </button>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="font-display text-[30px] leading-none">{city}</h2>
        {cityValue != null && (
          <p className="text-[13px] text-subtle">City average <span className="num font-semibold text-foreground">{cityValue.toFixed(1)}</span> µg/m³</p>
        )}
      </div>
      <p className="mb-2 text-[12px] text-faint">{withValue} of {stations.length} stations have a 24-hour value on {fmtDate(date)}.</p>
      <ol className="flex flex-col gap-0.5" aria-label={`${city} stations`}>
        {ranked.map((s) => {
          const st = dayStatus(s, day, pollutant);
          const col = statusColour(st);
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onStation(s.id)}
                aria-pressed={selected === s.id}
                className={cn("flex min-h-11 w-full items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left hover:bg-white/[0.04]",
                  selected === s.id && "bg-teal/10 ring-1 ring-teal/50")}
              >
                <span aria-hidden className={cn("h-5 w-1.5 shrink-0", s.tier === "low_cost" ? "rounded-full" : "rounded-sm")} style={{ background: col.bg }} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">{shortName(s.name)}</span>
                  <span className="block text-[11px] text-faint">{s.tier === "primary" ? s.provider : s.type}</span>
                </span>
                {st.kind === "value" ? (
                  <span className="text-right">
                    <span className="num block text-[14px] font-semibold">{st.value.toFixed(1)}</span>
                    <span className="block text-[10.5px] text-subtle">{CATEGORY_STYLE[st.category].label}</span>
                  </span>
                ) : (
                  <span className="text-right text-[11px] text-faint">{st.kind === "not_enough" ? `Not enough data` : "No readings"}</span>
                )}
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function shortName(name: string): string {
  return name.replace(/\s*-\s*(DPCC|CPCB|IMD|IITM|MPCB|KSPCB|TSPCB|TNPCB|WBPCB|APPCB|BSPCB)\s*$/i, "").trim() || name;
}

export function StationPanel({ station, data, day, onClose }: { station: ExploreStation; data: ExploreData; day: number; onClose: () => void }) {
  const pol = data.pollutant;
  const st = dayStatus(station, day, pol);
  const series = data.dates.map((d, i) => ({ date: d, value: station.values[i] }));
  const q = stationQuestion(station, pol, data.dates[0], data.dates[data.dates.length - 1]);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium tracking-wide text-faint uppercase">{station.type}</p>
          <h2 className="mt-1 text-[19px] leading-6 font-semibold">{station.name}</h2>
          <p className="mt-0.5 text-[12.5px] text-subtle">{station.city} · {station.provider} · {station.km_from_centre} km from the city centre</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close station" className="grid size-9 shrink-0 place-items-center rounded-full border border-line-strong text-subtle hover:text-foreground">
          <X className="size-4" aria-hidden />
        </button>
      </div>

      <div className="rounded-2xl border border-line bg-white/[0.02] p-4">
        <p className="text-[12px] text-faint">{POLLUTANT_LABEL[pol]}, 24-hour mean, {fmtDate(data.dates[day])}</p>
        {st.kind === "value" ? (
          <>
            <p className="mt-1 mb-3 flex items-baseline gap-2">
              <span className="num text-[40px] leading-none font-medium">{st.value.toFixed(1)}</span>
              <span className="text-sm text-subtle">µg/m³</span>
              <CategoryBadge category={st.category} className="ml-auto" label={`${POLLUTANT_LABEL[pol]} category`} />
            </p>
            <ScaleBar value={st.value} scale={pol} />
            <p className="mt-3 text-[13px] text-subtle">Valid hours: <span className="num font-semibold text-foreground">{st.hours} of 24</span></p>
          </>
        ) : (
          <p className="mt-2 text-[15px] font-medium">
            {st.kind === "not_enough" ? (
              <>Not enough data: <span className="num">{st.hours} of 24</span> valid hours (a 24-hour value needs 16)</>
            ) : (
              <>No readings from this station on this day</>
            )}
          </p>
        )}
      </div>

      <div>
        <div className="mb-1 flex items-baseline justify-between text-[12px] text-faint">
          <span>Last 30 days ({fmtSpan(data.dates[0], data.dates[data.dates.length - 1])})</span>
          <span>gaps = no 24-hour value</span>
        </div>
        <Sparkline points={series} width={320} height={64} className="w-full text-teal" />
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
        <dt className="text-faint">Provider</dt><dd>{station.provider}</dd>
        <dt className="text-faint">Monitor type</dt><dd>{station.type}</dd>
        <dt className="text-faint">Last reading</dt><dd>{fmtLastReading(station.last_reading_utc)}</dd>
      </dl>

      <div>
        <Link href={askHref(q)} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-teal px-4 text-sm font-semibold text-teal-ink hover:bg-teal-hover">
          <MessageSquare className="size-4" aria-hidden />
          Ask about this station
        </Link>
        <p className="mt-1.5 text-[11.5px] text-faint">Opens Ask with: “{q}” Answers use the city average, which includes this station.</p>
      </div>
    </div>
  );
}
