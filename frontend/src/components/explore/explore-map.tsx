"use client";

// Explore map: India with the six cities; choosing a city flies in and shows its monitoring stations.
// Station markers are coloured by the CPCB category for the selected pollutant, grey when the station-day has
// fewer than 16 valid hours (no 24-hour value) or no readings. Each marker is a labelled button, so the map is
// keyboard reachable; the station list in the side panel is the full accessible alternative.
// Only real station values are drawn: no heat surfaces, nothing between stations.
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import type { Map as MLMap, Marker } from "maplibre-gl";
import { CATEGORY_STYLE, CITIES, pmCategory } from "@/lib/categories";
import { cityStations, dayStatus, statusColour, statusText, type Pollutant, POLLUTANT_LABEL } from "@/lib/explore";
import { INDIA_BOUNDS, WORKER_URL, addIndiaLayers, hasWebGL, loadBaseStyle, loadBoundary } from "@/lib/map-base";
import type { ExploreData, ExploreStation } from "@/lib/types";

type Pad = { top: number; bottom: number; left: number; right: number };

export function ExploreMap({ data, day, pollutant, city, station, lowCost, padding, reduceMotion, onCity, onStation }: {
  data: ExploreData | null;
  day: number;
  pollutant: Pollutant;
  city: string | null;
  station: number | null;
  lowCost: boolean;
  padding: Pad;
  reduceMotion: boolean;
  onCity: (c: string) => void;
  onStation: (id: number) => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const lib = useRef<typeof import("maplibre-gl") | null>(null);
  const cityMarkers = useRef<Map<string, { m: Marker; b: HTMLButtonElement }>>(new Map());
  const stationMarkers = useRef<Map<number, { m: Marker; b: HTMLButtonElement }>>(new Map());
  const handlers = useRef({ onCity, onStation });
  const [ready, setReady] = useState<"loading" | "ready" | "failed">("loading");
  useEffect(() => { handlers.current = { onCity, onStation }; }, [onCity, onStation]);

  // ---------------------------------------------------------------- create the map once
  useEffect(() => {
    const node = el.current;
    if (!node) return;
    let cancelled = false;
    (async () => {
      try {
        if (!hasWebGL()) throw new Error("no webgl");
        const [maplibregl, style, geo] = await Promise.all([import("maplibre-gl"), loadBaseStyle(), loadBoundary()]);
        if (cancelled) return;
        maplibregl.setWorkerUrl(WORKER_URL);
        lib.current = maplibregl;
        const m = new maplibregl.Map({
          container: node, style, bounds: INDIA_BOUNDS, fitBoundsOptions: { padding }, attributionControl: false,
          dragRotate: false, pitchWithRotate: false, touchPitch: false, fadeDuration: 0, minZoom: 3, maxZoom: 14,
        });
        m.touchZoomRotate.disableRotation();
        m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
        map.current = m;
        m.on("load", () => {
          if (cancelled) return;
          addIndiaLayers(m, geo, { maskOpacity: 0.6 });
          m.once("idle", () => !cancelled && setReady("ready"));
        });
        m.on("error", () => { if (!m.isStyleLoaded()) setReady("failed"); });
      } catch {
        if (!cancelled) setReady("failed");
      }
    })();
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
    // padding only matters for the first view; later views pass it explicitly
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------- city markers (India view)
  useEffect(() => {
    const m = map.current, L = lib.current;
    if (ready !== "ready" || !m || !L || !data) return;
    if (!cityMarkers.current.size) {
      for (const c of CITIES) {
        const st = data.stations.filter((s) => s.city === c && s.tier === "primary");
        if (!st.length) continue;
        const lon = st.reduce((a, s) => a + s.lon, 0) / st.length, lat = st.reduce((a, s) => a + s.lat, 0) / st.length;
        const b = document.createElement("button");
        b.type = "button";
        const left = c === "Bengaluru"; // its label sits left of the dot so it never covers Chennai's
        b.className = left ? "sq-city-pin left" : "sq-city-pin";
        b.addEventListener("click", () => handlers.current.onCity(c));
        const mk = new L.Marker({ element: b, anchor: left ? "right" : "left", offset: [left ? 9 : -9, 0] }).setLngLat([lon, lat]).addTo(m);
        cityMarkers.current.set(c, { m: mk, b });
      }
    }
    for (const [c, { b }] of cityMarkers.current) paintCity(b, c, data.cities[c]?.values[day] ?? null, pollutant, city !== null);
  }, [ready, data, day, pollutant, city]);

  // ---------------------------------------------------------------- station markers (one city)
  const listKey = data && city ? `${city}|${lowCost}|${data.pollutant}` : "";
  useEffect(() => {
    const m = map.current, L = lib.current;
    for (const { m: mk } of stationMarkers.current.values()) mk.remove();
    stationMarkers.current.clear();
    if (ready !== "ready" || !m || !L || !data || !city) return;
    for (const s of cityStations(data, city, lowCost)) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `sq-station-pin${s.tier === "low_cost" ? " low" : ""}`;
      b.dataset.station = String(s.id);
      b.addEventListener("click", () => handlers.current.onStation(s.id));
      const mk = new L.Marker({ element: b }).setLngLat([s.lon, s.lat]).addTo(m);
      stationMarkers.current.set(s.id, { m: mk, b });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, listKey]);

  useEffect(() => {
    if (!data || !city) return;
    for (const [id, { b }] of stationMarkers.current) {
      const s = data.stations.find((x) => x.id === id);
      if (s) paintStation(b, s, day, pollutant, id === station);
    }
  }, [data, day, pollutant, city, station, listKey, ready]);

  // ---------------------------------------------------------------- fly in and out
  useEffect(() => {
    const m = map.current;
    if (ready !== "ready" || !m || !data) return;
    const duration = reduceMotion ? 0 : 1600;
    if (!city) {
      m.fitBounds(INDIA_BOUNDS, { padding, duration });
      return;
    }
    const st = cityStations(data, city, lowCost);
    if (!st.length) return;
    const lons = st.map((s) => s.lon), lats = st.map((s) => s.lat);
    m.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
      { padding, duration, maxZoom: 12.5, essential: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, city, lowCost, data?.pollutant]);

  return (
    // isolate: marker z-indexes stay inside the map, under the side panels
    <div className="absolute inset-0 isolate z-0" data-map={ready}>
      <div className="absolute inset-0"><div ref={el} className="h-full w-full" /></div>
      {ready === "failed" && (
        <p className="absolute inset-x-6 top-1/2 text-center text-sm text-subtle">
          The map could not load in this browser. The station list shows the same values.
        </p>
      )}
    </div>
  );
}

// Marker painting lives outside the component: it only updates the DOM buttons MapLibre positions.
function paintCity(b: HTMLButtonElement, c: string, v: number | null, pollutant: Pollutant, hidden: boolean) {
  const cat = pmCategory(v, pollutant);
  const col = cat ? CATEGORY_STYLE[cat] : { bg: "#64748B", fg: "#fff", label: "No city value" };
  b.style.setProperty("--c", col.bg);
  b.hidden = hidden;
  b.innerHTML = `<span class="dot" aria-hidden="true"></span><span class="lbl" aria-hidden="true"><b>${c}</b> ${v == null ? "no city value" : v.toFixed(1)}</span>`;
  b.setAttribute("aria-label", `${c}: ${v == null ? "no city value this day" : `${v.toFixed(1)} µg/m³ ${POLLUTANT_LABEL[pollutant]}, ${col.label}`}. Show its stations`);
}

function paintStation(b: HTMLButtonElement, s: ExploreStation, day: number, pollutant: Pollutant, selected: boolean) {
  const st = dayStatus(s, day, pollutant);
  const col = statusColour(st);
  b.style.background = col.bg;
  b.style.color = col.fg;
  b.textContent = st.kind === "value" ? String(Math.round(st.value)) : "–";
  b.classList.toggle("grey", st.kind !== "value");
  b.classList.toggle("selected", selected);
  b.setAttribute("aria-pressed", String(selected));
  b.setAttribute("aria-label", `${s.name} (${s.type}): ${statusText(st)}`);
  b.title = `${s.name}: ${statusText(st)}`;
}
