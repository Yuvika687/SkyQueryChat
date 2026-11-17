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
import { CITY_COLOURS } from "@/lib/categories";
import type { ExploreData, ExploreStation } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ExploreMap } from "./explore-map";
import { CpcbCityPanel, CpcbList, LayerSwitch } from "./cpcb-panels";
import { Term } from "@/components/ds/term";
import { getCpcbCities, type CpcbCity } from "@/lib/cpcb";
import { CityRanking, Legend, LowCostToggle, PollutantToggle, StationList, StationPanel, StationSearch, TimeControl } from "./panels";

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
  const [speed, setSpeed] = useState<1 | 2>(1);
  const [highlight, setHighlight] = useState<number | null>(null);
  const cache = useRef<Partial<Record<Pollutant, ExploreData>>>({});
  const [data, setData] = useState<ExploreData | null>(null);
  const [failed, setFailed] = useState(false);
  // the all-cities official AQI layer
  const [layer, setLayer] = useState<"stations" | "cpcb">(initial.layer ?? "stations");
  const [cpcbCity, setCpcbCity] = useState<string | null>(initial.cpcb ?? null);
  const [cpcb, setCpcb] = useState<CpcbCity[] | null>(null);
  const [cpcbFailed, setCpcbFailed] = useState(false);
  useEffect(() => {
    if (layer !== "cpcb" || cpcb || backend !== "ready") return;
    getCpcbCities().then((d) => setCpcb(d.cities)).catch(() => setCpcbFailed(true));
  }, [layer, cpcb, backend]);
  // a city opened from Home's search may be written another way ("bangalore"): use the bulletin's own name
  useEffect(() => {
    if (!cpcb || !cpcbCity || cpcb.some((c) => c.city === cpcbCity)) return;
    const hit = cpcb.find((c) => c.city.toLowerCase() === cpcbCity.toLowerCase());
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (hit) setCpcbCity(hit.city);
  }, [cpcb, cpcbCity]);
  const cpcbOn = layer === "cpcb";

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
    const q = viewQuery({ city, station: stationObj?.id ?? null, pollutant, date, layer, cpcb: cpcbCity });
    window.history.replaceState(null, "", `/explore?${q}`);
  }, [data, city, stationObj, pollutant, date, layer, cpcbCity]);

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
    }, STEP_MS / speed);
    return () => clearInterval(t);
  }, [playing, dates.length, speed]);
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
  /** From the search: open that station's city (and the low-cost layer if needed), then the station; the map flies. */
  const findStation = (s: ExploreStation) => {
    if (s.tier === "low_cost") setLowCost(true);
    setCity(s.city);
    setStation(s.id);
  };

  // ---------------------------------------------------------------- layout
  const [sheet, setSheet] = useState<"peek" | "half" | "full">("peek");
  useEffect(() => {
    // the sheet starts collapsed (date, play, slider); it opens when a station is chosen
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (phone && (station || cpcbCity)) setSheet((s) => (s === "peek" ? "half" : s));
  }, [phone, station, cpcbCity]);
  // Fit stations clear of the panels: left panel, station panel (kept free whenever a city is open, so opening a
  // station never hides another one) and the timeline at the bottom.
  // phones: keep stations above the sheet (collapsed, or half open once a station is chosen)
  const vh = typeof window === "undefined" ? 800 : window.innerHeight;
  const padding = phone
    ? { top: 120, bottom: station || cpcbCity ? Math.round(vh * 0.55) + 16 : 230, left: 28, right: 28 }
    : { top: 100, bottom: cpcbOn ? 40 : 120, left: 420, right: city || cpcbCity ? 420 : 60 };

  const loading = !data && !failed;
  const shownStations = data && city ? cityStations(data, city, lowCost) : [];

  const header = (
    <div>
      <span className="inline-flex h-6 items-center gap-1.5 rounded-full border border-teal/25 bg-teal/[0.08] px-2.5 text-[12px] font-medium text-teal">
        <span aria-hidden className="sq-live size-1.5 rounded-full bg-teal text-teal" />
        {cpcbOn ? `${cpcb?.length ?? 329} cities · official AQI` : `${data?.stations.length ?? "All"} stations · ${pollutant === "pm25" ? "PM2.5" : "PM10"}`}
      </span>
      <h1 className="page-title sq-title-grad mt-3">Explore</h1>
      <p className="mt-2 text-[15px] text-foreground">
        {cpcbOn ? "Official AQI for every city in CPCB’s daily bulletin." : "Every monitoring station in the six cities."}
      </p>
      <p className="mt-1 text-[13px] text-faint">
        {cpcbOn ? <>Click a dot for its last 30 days. <Term k="aqi" /> from <Term k="cpcb" />.</>
          : <>Values in <Term k="ugm3" />, <Term k="pm25" /> or <Term k="pm10" />. Click a city, then a station.</>}
      </p>
    </div>
  );
  const pickLayer = (v: "stations" | "cpcb") => { setLayer(v); setStation(null); setCity(null); if (v === "stations") setCpcbCity(null); };
  const controls = (
    <div className="flex flex-col gap-3">
      <LayerSwitch value={layer} onChange={pickLayer} />
      {!cpcbOn && data && (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <PollutantToggle value={pollutant} onChange={pickPollutant} />
            {hasLowCost(data) && <LowCostToggle on={lowCost} onChange={(v) => { setLowCost(v); if (!v && stationObj?.tier === "low_cost") setStation(null); }} />}
          </div>
          <StationSearch stations={data.stations} onPick={findStation} />
        </>
      )}
    </div>
  );
  const time = data && date && (
    <TimeControl dates={dates} day={i} onDay={pickDay} playing={playing} onPlay={togglePlay} canPlay={!reduce} compact={phone || !!stationObj}
      speed={speed} onSpeed={setSpeed}
      series={city ? [{ colour: "#2DD4BF", values: data.cities[city]?.values ?? [] }]
        : Object.entries(data.cities).map(([c, v]) => ({ colour: CITY_COLOURS[c] ?? "#94A0BC", values: v.values }))} />
  );
  const cpcbList = cpcbFailed ? (
    <ErrorState title="The bulletin cities could not load" message="The data server did not answer." onRetry={() => { setCpcbFailed(false); setCpcb(null); }} />
  ) : cpcb ? <CpcbList cities={cpcb} selected={cpcbCity} onPick={setCpcbCity} /> : <ListSkeleton />;
  const list = cpcbOn ? cpcbList : data && date ? (
    city ? (
      <StationList city={city} stations={shownStations} day={i} date={date} pollutant={pollutant} selected={stationObj?.id ?? null}
        onStation={pickStation} onHighlight={setHighlight} onBack={() => pickCity(null)} cityValue={data.cities[city]?.values[i] ?? null} />
    ) : (
      <CityRanking data={data} day={i} onCity={pickCity} />
    )
  ) : null;
  const state = failed ? (
    <ErrorState title="The station data could not load" message="The data server did not answer."
      onRetry={() => void (backend === "down" ? recheckBackend() : load(pollutant))} />
  ) : backend === "waking" ? <WakeUpState compact /> : null;

  return (
    <div className="fixed inset-0 overflow-hidden bg-background">
      <ExploreMap data={data} day={i} pollutant={pollutant} city={city} station={stationObj?.id ?? null} highlight={highlight} lowCost={lowCost}
        padding={padding} reduceMotion={reduce} onCity={pickCity} onStation={pickStation}
        cpcb={cpcbOn ? cpcb : null} cpcbSelected={cpcbCity} onCpcb={setCpcbCity} />

      {!phone ? (
        <>
          <aside aria-label="Cities and stations" className="sq-glass sq-accent-top sq-card-in absolute top-[76px] bottom-4 left-4 z-10 flex w-[370px] flex-col overflow-hidden rounded-3xl border border-line-strong backdrop-blur-xl">
            <div className="flex flex-col gap-4 px-5 pt-5 pb-3">
              {header}
              {controls}
            </div>
            {/* one scroll area for the list and the legend, so nothing is cut off */}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pt-2 pb-5">
              {state && <div className="px-2 pb-3">{state}</div>}
              {loading && !cpcbOn ? <ListSkeleton /> : list}
              <div className="mx-2 mt-8"><Legend pollutant={cpcbOn ? "aqi" : pollutant} /></div>
            </div>
          </aside>
          {!cpcbOn && (
            <div className={cn("sq-glass sq-card-in absolute bottom-4 left-[402px] z-10 rounded-2xl border border-line-strong px-4 py-2 backdrop-blur-xl", stationObj ? "right-[402px]" : "right-[60px]")}>
              {time ?? <Skeleton className="h-[52px]" />}
            </div>
          )}
          {cpcbOn && cpcbCity && (
            <aside key={cpcbCity} aria-label="City" className="sq-slide-in sq-glass absolute top-[76px] right-4 bottom-4 z-10 w-[370px] overflow-y-auto rounded-3xl border border-line-strong p-5 pt-0 backdrop-blur-xl">
              <CpcbCityPanel name={cpcbCity} onClose={() => setCpcbCity(null)} />
            </aside>
          )}
          {!cpcbOn && stationObj && data && (
            <aside key={stationObj.id} aria-label="Station" className="sq-slide-in sq-glass absolute top-[76px] right-4 bottom-4 z-10 w-[370px] overflow-y-auto rounded-3xl border border-line-strong p-5 backdrop-blur-xl">
              <StationPanel station={stationObj} data={data} day={i} onClose={() => setStation(null)} />
            </aside>
          )}
        </>
      ) : (
        <>
          <p className="absolute top-[66px] right-3 left-3 z-10 truncate rounded-full border border-line-strong bg-[#0b1324]/[0.94] px-4 py-2 text-[13px] font-medium backdrop-blur-xl">
            {cpcbOn ? "Official AQI for every CPCB bulletin city" : "Every monitoring station in the six cities"}
          </p>
          <BottomSheet size={sheet} onSize={setSheet}>
            <div className="flex flex-col gap-4">
              {!cpcbOn && (time ?? <Skeleton className="h-[72px]" />)}
              <p className="-mt-1 text-[12px] text-faint">{cpcbOn ? "Tap a dot or a city. Drag up for the list." : "Tap a city, then a station. Drag up for the list."}</p>
              {controls}
              {state}
              {cpcbOn && cpcbCity ? (
                <CpcbCityPanel name={cpcbCity} onClose={() => setCpcbCity(null)} />
              ) : !cpcbOn && stationObj && data ? (
                <StationPanel station={stationObj} data={data} day={i} onClose={() => setStation(null)} />
              ) : loading && !cpcbOn ? <ListSkeleton /> : list}
              <Legend pollutant={cpcbOn ? "aqi" : pollutant} />
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
const SIZES = { peek: 0.21, half: 0.55, full: 0.82 } as const; // peek: date, play and slider only

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
