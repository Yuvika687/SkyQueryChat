"use client";

// Explore side-panel pieces: controls, date player, legend, city ranking, station list and station panel.
import Link from "next/link";
import { useState } from "react";
import { healthNote } from "@/lib/health";
import { ArrowLeft, ArrowRight, MessageSquare, Pause, Play, Search, X } from "lucide-react";
import { CATEGORY_STYLE, pmCategory, type Category } from "@/lib/categories";
import {
  LEGEND_RANGES, POLLUTANT_LABEL, dayStatus, fmtLastReading, monitorType, rankCities, rankStations, stationQuestion, statusColour,
  type Pollutant,
} from "@/lib/explore";
import { StationChart } from "./station-chart";
import { fmtDate, fmtSpan } from "@/lib/format";
import type { ExploreData, ExploreStation } from "@/lib/types";
import { cn } from "@/lib/utils";
import { askHref } from "@/components/ds/ask-box";
import { CategoryBadge, ScaleBar } from "@/components/ds/data-display";

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

// Verified Diwali dates (backend/config/events.json).
const DIWALI = ["2024-10-31", "2025-10-20", "2026-11-08"];

/** Faint daily averages behind the slider: one line per series, gaps kept as gaps. */
function MiniChart({ dates, series }: { dates: string[]; series: { colour: string; values: (number | null)[] }[] }) {
  const max = Math.max(1, ...series.flatMap((s) => s.values.filter((v): v is number => v != null)));
  const n = Math.max(1, dates.length - 1);
  const path = (vals: (number | null)[]) => vals.map((v, k) => {
    if (v == null) return "";
    const cmd = k === 0 || vals[k - 1] == null ? "M" : "L";
    return `${cmd}${((k / n) * 100).toFixed(2)},${(32 - (v / max) * 28).toFixed(2)}`;
  }).join("");
  const dots = (vals: (number | null)[]) => vals.map((v, k) => v != null && (k === 0 || vals[k - 1] == null) && (k === vals.length - 1 || vals[k + 1] == null)
    ? <circle key={k} cx={(k / n) * 100} cy={32 - (v / max) * 28} r={0.9} /> : null);
  const diwali = dates.findIndex((d) => DIWALI.includes(d));
  return (
    <svg aria-hidden viewBox="0 0 100 34" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
      {diwali >= 0 && <line x1={(diwali / n) * 100} x2={(diwali / n) * 100} y1={0} y2={34} stroke="#F5B942" strokeOpacity={0.55} strokeWidth={1} vectorEffect="non-scaling-stroke" strokeDasharray="2 2" />}
      {series.map((s, k) => (
        <g key={k} stroke={s.colour} fill={s.colour} strokeOpacity={series.length > 1 ? 0.45 : 0.7} fillOpacity={0.6}>
          <path d={path(s.values)} fill="none" strokeWidth={1.3} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
          {dots(s.values)}
        </g>
      ))}
    </svg>
  );
}

/** Slim timeline: play (1x / 2x), the day shown, and a slider over a faint chart of the daily averages. */
export function TimeControl({ dates, day, onDay, playing, onPlay, canPlay, speed, onSpeed, series, compact }: {
  dates: string[];
  day: number;
  onDay: (i: number) => void;
  playing: boolean;
  onPlay: () => void;
  canPlay: boolean;
  speed: 1 | 2;
  onSpeed: (s: 1 | 2) => void;
  series: { colour: string; values: (number | null)[] }[];
  compact?: boolean;
}) {
  const last = day === dates.length - 1;
  const diwali = dates.findIndex((d) => DIWALI.includes(d));
  const label = (
    <p className="min-w-0 text-[13px] whitespace-nowrap text-subtle" aria-live="polite">
      {last ? "Latest available: " : "Showing "}<strong className="num font-semibold text-foreground">{fmtDate(dates[day])}</strong>
    </p>
  );
  const play = canPlay ? (
    <div className="flex shrink-0 items-center gap-1.5">
      <button type="button" onClick={onPlay}
        className="inline-flex h-9 items-center gap-1.5 rounded-full bg-teal px-3.5 text-[13px] font-semibold whitespace-nowrap text-teal-ink hover:bg-teal-hover">
        {playing ? <Pause className="size-3.5" aria-hidden /> : <Play className="size-3.5" aria-hidden />}
        {playing ? "Pause" : "Play last 30 days"}
      </button>
      <div role="radiogroup" aria-label="Playback speed" className="inline-flex rounded-full border border-line p-0.5">
        {([1, 2] as const).map((v) => (
          <button key={v} type="button" role="radio" aria-checked={speed === v} onClick={() => onSpeed(v)}
            className={cn("h-7 min-w-8 rounded-full px-2 text-[12px] font-medium", speed === v ? "bg-white/[0.1] text-foreground" : "text-faint hover:text-foreground")}>
            {v}×
          </button>
        ))}
      </div>
    </div>
  ) : (
    <p className="max-w-[170px] text-[11px] leading-4 text-faint">Autoplay is off because your device asks for less motion. Drag the slider.</p>
  );
  // chart above the track: the line sits on the slider's baseline, dates below (never on top of the chart)
  const slider = (
    <div className="min-w-0 flex-1">
      <div className="relative h-[46px]">
        <div className="absolute inset-x-[8px] top-[6px] h-[26px]"><MiniChart dates={dates} series={series} /></div>
        {diwali >= 0 && (
          <span aria-hidden className="pointer-events-none absolute -top-1 -translate-x-1/2 text-[10px] leading-none font-medium text-warn"
            style={{ left: `calc(8px + (100% - 16px) * ${diwali / Math.max(1, dates.length - 1)})` }}>Diwali</span>
        )}
        <label htmlFor="day-slider" className="sr-only">Day</label>
        <input id="day-slider" type="range" min={0} max={dates.length - 1} step={1} value={day}
          onChange={(e) => onDay(Number(e.target.value))} aria-valuetext={fmtDate(dates[day])}
          className="sq-range absolute inset-x-0 top-[22px] h-6 w-full" />
      </div>
      <div className="flex justify-between px-[2px] text-[10.5px] leading-none text-faint">
        <span>{fmtDate(dates[0])}</span>
        <span>{fmtDate(dates[dates.length - 1])}</span>
      </div>
    </div>
  );
  if (compact) {
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-3">{label}{play}</div>
        {slider}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-4">
      {play}
      <div className="w-[208px] shrink-0">{label}</div>
      {slider}
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

export function StationList({ city, stations, day, date, pollutant, selected, onStation, onHighlight, onBack, cityValue }: {
  city: string;
  date: string;
  onHighlight: (id: number | null) => void;
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
      <Link href={`/city/${city.toLowerCase()}`} className="mb-3 inline-flex min-h-9 items-center gap-1.5 rounded-full text-[13px] font-medium text-teal hover:underline">
        Open city page<ArrowRight className="size-3.5" aria-hidden />
      </Link>
      <ol className="flex flex-col gap-0.5" aria-label={`${city} stations`}>
        {ranked.map((s) => {
          const st = dayStatus(s, day, pollutant);
          const col = statusColour(st);
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onStation(s.id)}
                onMouseEnter={() => onHighlight(s.id)}
                onMouseLeave={() => onHighlight(null)}
                onFocus={() => onHighlight(s.id)}
                onBlur={() => onHighlight(null)}
                aria-pressed={selected === s.id}
                className={cn("flex min-h-11 w-full items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left hover:bg-white/[0.04]",
                  selected === s.id && "bg-teal/10 ring-1 ring-teal/50")}
              >
                <span aria-hidden className={cn("size-3 shrink-0 ring-1 ring-white/60", s.tier === "low_cost" ? "rotate-45 rounded-[2px]" : "rounded-full")} style={{ background: col.bg }} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">{shortName(s.name)}</span>
                  <span className="block text-[11px] text-faint">{s.tier === "primary" ? s.provider : monitorType(s)}</span>
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

/** "DTU, New Delhi - CPCB" -> "DTU, New Delhi": the operator suffix is shown once, under the title. */
export function shortName(name: string): string {
  return name.replace(/\s*-\s*[A-Z][A-Za-z]{1,8}\s*$/, "").trim() || name;
}

export function StationPanel({ station, data, day, onClose }: { station: ExploreStation; data: ExploreData; day: number; onClose: () => void }) {
  const pol = data.pollutant;
  const st = dayStatus(station, day, pol);
  const q = stationQuestion(station, pol, data.dates[0], data.dates[data.dates.length - 1]);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-[20px] leading-6 font-semibold">{shortName(station.name)}</h2>
          <p className="mt-1 text-[13px] text-subtle">{station.provider} · {monitorType(station)}</p>
          <p className="mt-0.5 text-[12px] text-faint">{station.city} · {station.km_from_centre} km from the city centre</p>
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
            {healthNote(st.category) && (
              <p className="mt-2 text-[12.5px] text-subtle"><span className="text-faint">CPCB health note:</span> {healthNote(st.category)}.</p>
            )}
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
        <p className="mb-1 text-[12px] text-faint">Last 30 days · {fmtSpan(data.dates[0], data.dates[data.dates.length - 1])}</p>
        {station.values.some((v) => v != null) ? (
          <StationChart dates={data.dates} values={station.values} day={day} pollutant={pol} />
        ) : (
          <p className="rounded-xl border border-dashed border-line px-3.5 py-4 text-[13px] text-subtle">
            No 24-hour values for this station in this period. Try {pol === "pm25" ? "PM10" : "PM2.5"} or another station.
          </p>
        )}
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
        <dt className="text-faint">Provider</dt><dd>{station.provider}</dd>
        <dt className="text-faint">Monitor type</dt><dd>{monitorType(station)}</dd>
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

/** Find any station by name across the six cities (combobox: arrows, Enter, Escape). Choosing one flies to it. */
export function StationSearch({ stations, onPick }: { stations: ExploreStation[]; onPick: (s: ExploreStation) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(0);
  const norm = (x: string) => x.toLowerCase().normalize("NFD").replace(/[^a-z0-9 ]/g, " ");
  const words = norm(q).split(/\s+/).filter(Boolean);
  const hits = words.length
    ? stations.filter((s) => words.every((w) => norm(`${s.name} ${s.city}`).includes(w))).slice(0, 8)
    : [];
  const pick = (s: ExploreStation) => { onPick(s); setQ(""); setOpen(false); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setAt((a) => Math.min(a + 1, hits.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setAt((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter" && hits[at]) { e.preventDefault(); pick(hits[at]); }
    else if (e.key === "Escape") { setOpen(false); }
  };
  const show = open && words.length > 0;
  return (
    <div className="relative">
      <label htmlFor="station-search" className="sr-only">Find a station</label>
      <div className="flex h-10 items-center gap-2 rounded-xl border border-line bg-white/[0.03] px-3 focus-within:border-teal">
        <Search className="size-4 shrink-0 text-faint" aria-hidden />
        <input id="station-search" role="combobox" aria-expanded={show} aria-controls="station-results" aria-autocomplete="list"
          aria-activedescendant={show && hits[at] ? `station-opt-${hits[at].id}` : undefined}
          value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); setAt(0); }} onKeyDown={onKey}
          onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 120)}
          placeholder="Find a station by name" autoComplete="off"
          className="min-w-0 flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-faint" />
      </div>
      {show && (
        <ul id="station-results" role="listbox" aria-label="Stations"
          className="absolute inset-x-0 top-11 z-30 max-h-72 overflow-y-auto rounded-xl border border-line-strong bg-[#0d1528] p-1 shadow-float">
          {hits.length === 0 ? (
            <li className="px-3 py-2.5 text-[13px] text-subtle">No station matches “{q}”. Try part of the name, such as “Vihar”.</li>
          ) : hits.map((s, k) => (
            <li key={s.id} id={`station-opt-${s.id}`} role="option" aria-selected={k === at}
              onMouseDown={(e) => { e.preventDefault(); pick(s); }} onMouseEnter={() => setAt(k)}
              className={cn("flex cursor-pointer items-baseline justify-between gap-3 rounded-lg px-3 py-2 text-[13px]", k === at && "bg-white/[0.07]")}>
              <span className="min-w-0 truncate">{shortName(s.name)}</span>
              <span className="shrink-0 text-[11.5px] text-faint">{s.city}{s.tier === "low_cost" ? " · low-cost" : ""}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
