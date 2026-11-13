"use client";

// Explore: every monitoring station in the six cities over the latest 30 available days.
// Desktop: full-height map, left panel (cities, then a city's stations), right station panel.
// Phone: full-screen map with a draggable bottom sheet holding the same content.
// The view lives in the address (?city=&station=&pollutant=&date=) so it can be shared.
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { ChevronUp } from "lucide-react";
import { useApp } from "@/components/shell/app-context";
import { ErrorState, Skeleton, WakeUpState } from "@/components/ds/states";
import { getExplore } from "@/lib/api";
import { cityStations, hasLowCost, parseView, viewQuery, type Pollutant } from "@/lib/explore";
import { MAP_CREDITS } from "@/lib/map-base";
import type { ExploreData } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ExploreMap } from "./explore-map";
import { CityRanking, Legend, LowCostToggle, PollutantToggle, StationList, StationPanel, TimeControl } from "./panels";

const STEP_MS = 800;

function useIsPhone() {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const on = () => setPhone(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return phone;
}

export function ExploreScreen() {
  const params = useSearchParams();
  const initial = useMemo(() => parseView(new URLSearchParams(params.toString())), [params]);
  const { backend, recheckBackend } = useApp();
  const reduce = !!useReducedMotion();
  const phone = useIsPhone();

  const [pollutant, setPollutant] = useState<Pollutant>(initial.pollutant);
  const [city, setCity] = useState<string | null>(initial.city);
  const [station, setStation] = useState<number | null>(initial.station);
  const [dateWanted, setDateWanted] = useState<string | null>(initial.date);
  const [day, setDay] = useState<number | null>(null);
  const [lowCost, setLowCost] = useState(false);
  const [playing, setPlaying] = useState(false);
  const cache = useRef<Partial<Record<Pollutant, ExploreData>>>({});
  const [data, setData] = useState<ExploreData | null>(null);
  const [failed, setFailed] = useState(false);

  // ---------------------------------------------------------------- data (one request per pollutant, kept)
  const load = useCallback(async (p: Pollutant) => {
    await Promise.resolve();
    setFailed(false);
    try {
      const d = cache.current[p] ?? (await getExplore(p));
      cache.current[p] = d;
      setData(d);
    } catch {
      setFailed(true);
    }
  }, []);
  useEffect(() => {
    // Read-only data, fetched once the backend answers (it may be waking up).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (backend === "ready") void load(pollutant);
  }, [backend, pollutant, load]);

  // the selected day follows the data's dates (keep the same date when switching pollutant)
  const dates = data?.dates ?? [];
  const i = day ?? (dateWanted && dates.includes(dateWanted) ? dates.indexOf(dateWanted) : dates.length - 1);
  const date = dates[i] ?? null;

  // a station from the address must belong to the city (and its sensor type must be shown)
  const stationObj = data && station ? data.stations.find((s) => s.id === station && s.city === city) ?? null : null;
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (stationObj?.tier === "low_cost" && !lowCost) setLowCost(true);
  }, [stationObj, lowCost]);

  // ---------------------------------------------------------------- address
  useEffect(() => {
    if (!data) return;
    const q = viewQuery({ city, station: stationObj?.id ?? null, pollutant, date });
    window.history.replaceState(null, "", `/explore?${q}`);
  }, [data, city, stationObj, pollutant, date]);

  // ---------------------------------------------------------------- play
  useEffect(() => {
    if (!playing || !dates.length) return;
    const t = setInterval(() => {
      setDay((d) => {
        const cur = d ?? dates.length - 1;
        if (cur >= dates.length - 1) {
          setPlaying(false);
          return cur;
        }
        return cur + 1;
      });
    }, STEP_MS);
    return () => clearInterval(t);
  }, [playing, dates.length]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (reduce) setPlaying(false);
  }, [reduce]);
  const togglePlay = () => {
    if (playing) return setPlaying(false);
    if (i >= dates.length - 1) setDay(0);
    setPlaying(true);
  };
  const pickDay = (n: number) => {
    setPlaying(false);
    setDay(n);
  };
  const pickPollutant = (p: Pollutant) => {
    setDateWanted(date);
    setDay(null);
    setPollutant(p);
  };
  const pickCity = useCallback((c: string | null) => {
    setCity(c);
    setStation(null);
  }, []);
  const pickStation = useCallback((id: number) => setStation(id), []);

  // ---------------------------------------------------------------- layout
  const [sheet, setSheet] = useState<"peek" | "half" | "full">("peek");
  useEffect(() => {
    // the sheet opens up when there is more to read
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (phone && (city || station)) setSheet((s) => (s === "peek" ? "half" : s));
  }, [phone, city, station]);
  const padding = phone
    ? { top: 150, bottom: 260, left: 24, right: 24 }
    : { top: 96, bottom: 200, left: 410, right: stationObj ? 420 : 60 };

  const loading = !data && !failed;
  const shownStations = data && city ? cityStations(data, city, lowCost) : [];

  const header = (
    <div>
      <h1 className="font-display text-[34px] leading-none md:text-[40px]">Explore</h1>
      <p className="mt-1.5 text-[14px] text-foreground">See every monitoring station in the six cities.</p>
      <p className="mt-0.5 text-[12.5px] text-faint">Click a city, then a station. Press play to watch the last 30 days.</p>
    </div>
  );
  const controls = data && (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <PollutantToggle value={pollutant} onChange={pickPollutant} />
      {hasLowCost(data) && <LowCostToggle on={lowCost} onChange={(v) => { setLowCost(v); if (!v && stationObj?.tier === "low_cost") setStation(null); }} />}
    </div>
  );
  const time = data && date && (
    <TimeControl dates={dates} day={i} onDay={pickDay} playing={playing} onPlay={togglePlay} canPlay={!reduce} compact={phone} />
  );
  const list = data && date ? (
    city ? (
      <StationList city={city} stations={shownStations} day={i} date={date} pollutant={pollutant} selected={stationObj?.id ?? null}
        onStation={pickStation} onBack={() => pickCity(null)} cityValue={data.cities[city]?.values[i] ?? null} />
    ) : (
      <CityRanking data={data} day={i} onCity={pickCity} />
    )
  ) : null;
  const state = failed ? (
    <ErrorState title="The station data could not load" message="The data server did not answer."
      onRetry={() => void (backend === "down" ? recheckBackend() : load(pollutant))} />
  ) : backend === "waking" ? <WakeUpState compact /> : null;
  const credits = (
    <p className="text-[10.5px] leading-4 text-faint">
      {MAP_CREDITS.slice(0, 3).map((c, k) => (
        <span key={c.text}>{k === 1 ? " © " : k === 2 ? " Data from " : ""}<a className="underline underline-offset-2" href={c.href} target="_blank" rel="noreferrer">{c.text}</a></span>
      ))}
      {" · India boundary as per the Survey of India ("}<a className="underline underline-offset-2" href={MAP_CREDITS[3].href} target="_blank" rel="noreferrer">DataMeet</a>, CC0)
      {" · Station data: CPCB and others via OpenAQ"}
    </p>
  );

  return (
    <div className="fixed inset-0 overflow-hidden bg-background">
      <ExploreMap data={data} day={i} pollutant={pollutant} city={city} station={stationObj?.id ?? null} lowCost={lowCost}
        padding={padding} reduceMotion={reduce} onCity={pickCity} onStation={pickStation} />

      {!phone ? (
        <>
          <aside aria-label="Cities and stations" className="absolute top-[76px] bottom-4 left-4 z-10 border border-line-strong bg-[#0b1324]/[0.96] backdrop-blur-xl flex w-[370px] flex-col overflow-hidden rounded-3xl shadow-float">
            <div className="flex flex-col gap-4 border-b border-line px-5 pt-5 pb-4">
              {header}
              {controls}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
              {state && <div className="px-2 pb-3">{state}</div>}
              {loading ? <ListSkeleton /> : list}
            </div>
            <div className="flex flex-col gap-3 border-t border-line px-5 py-3">
              <Legend pollutant={pollutant} />
              {credits}
            </div>
          </aside>
          <div className={cn("absolute bottom-4 left-[402px] z-10 border border-line-strong bg-[#0b1324]/[0.96] backdrop-blur-xl rounded-2xl px-5 py-4 shadow-float", stationObj ? "right-[402px]" : "right-4 xl:right-auto xl:w-[560px]")}>
            {time ?? <Skeleton className="h-[86px]" />}
          </div>
          {stationObj && data && (
            <aside aria-label="Station" className="absolute top-[76px] right-4 bottom-4 z-10 border border-line-strong bg-[#0b1324]/[0.97] backdrop-blur-xl w-[370px] overflow-y-auto rounded-3xl p-5 shadow-float">
              <StationPanel station={stationObj} data={data} day={i} onClose={() => setStation(null)} />
            </aside>
          )}
        </>
      ) : (
        <>
          <div className="absolute top-[68px] right-3 left-3 z-10 border border-line-strong bg-[#0b1324]/[0.94] backdrop-blur-xl rounded-2xl px-4 py-3">
            <p className="text-[14px] font-medium">See every monitoring station in the six cities.</p>
            <p className="text-[12px] text-faint">Tap a city, then a station. Press play to watch the last 30 days.</p>
          </div>
          <BottomSheet size={sheet} onSize={setSheet}>
            <div className="flex flex-col gap-4">
              {time ?? <Skeleton className="h-[80px]" />}
              {controls}
              {state}
              {stationObj && data ? (
                <StationPanel station={stationObj} data={data} day={i} onClose={() => setStation(null)} />
              ) : loading ? <ListSkeleton /> : list}
              <Legend pollutant={pollutant} />
              {credits}
            </div>
          </BottomSheet>
        </>
      )}
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-2 px-2" aria-label="Loading">
      {Array.from({ length: 6 }, (_, k) => <Skeleton key={k} className="h-11" />)}
    </div>
  );
}

// ------------------------------------------------------------------ phone bottom sheet
const SIZES = { peek: 0.3, half: 0.55, full: 0.82 } as const;

function BottomSheet({ size, onSize, children }: { size: keyof typeof SIZES; onSize: (s: keyof typeof SIZES) => void; children: React.ReactNode }) {
  const [drag, setDrag] = useState<number | null>(null);
  const start = useRef<{ y: number; h: number } | null>(null);
  const vh = typeof window === "undefined" ? 800 : window.innerHeight;
  const height = drag ?? SIZES[size] * vh;
  const next = size === "peek" ? "half" : size === "half" ? "full" : "peek";
  return (
    <section
      aria-label="Explore panel"
      className="fixed inset-x-0 bottom-[84px] z-30 flex flex-col rounded-t-3xl border border-b-0 border-line-strong bg-[#0b1324]/[0.97] shadow-float backdrop-blur-xl"
      style={{ height, transition: drag == null ? "height 200ms ease-out" : "none" }}
    >
      <button
        type="button"
        aria-label={size === "full" ? "Show less" : "Show more"}
        onClick={() => onSize(next)}
        onPointerDown={(e) => {
          start.current = { y: e.clientY, h: height };
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!start.current) return;
          const h = Math.min(0.88 * vh, Math.max(0.18 * vh, start.current.h + (start.current.y - e.clientY)));
          if (Math.abs(h - start.current.h) > 6) setDrag(h);
        }}
        onPointerUp={() => {
          if (drag != null) {
            const f = drag / vh;
            onSize((Object.entries(SIZES) as [keyof typeof SIZES, number][]).reduce((a, b) => (Math.abs(b[1] - f) < Math.abs(a[1] - f) ? b : a))[0]);
          }
          start.current = null;
          setDrag(null);
        }}
        className="flex h-8 w-full shrink-0 touch-none items-center justify-center"
      >
        <span aria-hidden className="h-1.5 w-10 rounded-full bg-line-strong" />
        <ChevronUp className={cn("sr-only")} aria-hidden />
      </button>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">{children}</div>
    </section>
  );
}
