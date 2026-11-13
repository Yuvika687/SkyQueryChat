"use client";

// Explore map: India with the six cities; choosing a city flies in and shows its monitoring stations.
// Stations are small dots coloured by the CPCB category for the selected pollutant (grey when the station-day has
// fewer than 16 valid hours or no readings). Value labels use MapLibre's collision handling, so labels never
// overlap; the hovered or selected station is drawn larger and always labelled. Low-cost sensors are diamonds.
// City markers are keyboard-reachable buttons; for stations, the list in the side panel is the keyboard path
// (focusing a list row highlights its dot). Only real station values are drawn: no surfaces between stations.
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import type { GeoJSONSource, Map as MLMap, Marker } from "maplibre-gl";
import { CATEGORY_STYLE, CITIES, pmCategory } from "@/lib/categories";
import { cityStations, dayStatus, statusColour, type Pollutant, POLLUTANT_LABEL } from "@/lib/explore";
import { INDIA_BOUNDS, WORKER_URL, addCityOutlines, addIndiaLayers, hasWebGL, loadBaseStyle, loadBoundary, showCityOutline, addCredits } from "@/lib/map-base";
import type { ExploreData } from "@/lib/types";
import { shortName } from "./panels";

type Pad = { top: number; bottom: number; left: number; right: number };

/** Padding that always leaves room on the canvas (MapLibre refuses to fit, and stays put, when padding exceeds it). */
function fitPad(p: Pad, w: number, h: number, room = 120): Pad {
  const sy = Math.min(1, Math.max(0, h - room) / Math.max(1, p.top + p.bottom));
  const sx = Math.min(1, Math.max(0, w - room) / Math.max(1, p.left + p.right));
  return { top: Math.floor(p.top * sy), bottom: Math.floor(p.bottom * sy), left: Math.floor(p.left * sx), right: Math.floor(p.right * sx) };
}
const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
const FONT = ["Noto Sans Regular"]; // the font the basemap's own labels use

export function ExploreMap({ data, day, pollutant, city, station, highlight, lowCost, padding, reduceMotion, onCity, onStation }: {
  data: ExploreData | null;
  day: number;
  pollutant: Pollutant;
  city: string | null;
  station: number | null;
  /** a station highlighted from the list (hover or keyboard focus) */
  highlight: number | null;
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
  const handlers = useRef({ onCity, onStation });
  const [ready, setReady] = useState<"loading" | "ready" | "failed">("loading");
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => { handlers.current = { onCity, onStation }; }, [onCity, onStation]);

  // ---------------------------------------------------------------- create the map once
  useEffect(() => {
    const node = el.current;
    if (!node) return;
    let cancelled = false;
    (async () => {
      try {
        if (!hasWebGL()) throw new Error("no webgl");
        const [maplibregl, style, geo] = await Promise.all([import("maplibre-gl"), loadBaseStyle({ context: true }), loadBoundary()]);
        if (cancelled) return;
        maplibregl.setWorkerUrl(WORKER_URL);
        lib.current = maplibregl;
        const m = new maplibregl.Map({
          container: node, style, bounds: INDIA_BOUNDS, fitBoundsOptions: { padding: fitPad(padding, node.clientWidth, node.clientHeight) }, attributionControl: false,
          dragRotate: false, pitchWithRotate: false, touchPitch: false, fadeDuration: 0, minZoom: 3, maxZoom: 14,
        });
        m.touchZoomRotate.disableRotation();
        // no zoom buttons: scroll, pinch, double-click and keyboard zoom all work; only the credits sit bottom-right
        // phones: top right, under the header strip (the bottom sheet covers the bottom corner)
        addCredits(m, maplibregl.AttributionControl, window.matchMedia("(max-width: 767px)").matches ? "top-right" : "bottom-right");
        map.current = m;
        m.on("load", async () => {
          if (cancelled) return;
          addIndiaLayers(m, geo, { maskOpacity: 0.6 });
          await addCityOutlines(m);
          addStationLayers(m);
          for (const layer of ["st-dot", "st-diamond"]) {
            m.on("click", layer, (e) => { const id = e.features?.[0]?.properties?.id; if (id != null) handlers.current.onStation(Number(id)); });
            m.on("mousemove", layer, (e) => { m.getCanvas().style.cursor = "pointer"; setHover(Number(e.features?.[0]?.properties?.id)); });
            m.on("mouseleave", layer, () => { m.getCanvas().style.cursor = ""; setHover(null); });
          }
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
        // Same label sides as Home: Mumbai and Bengaluru left of the dot (so Mumbai never touches Hyderabad's marker
        // and Bengaluru never covers Chennai's); on phones Mumbai's label sits above its dot.
        const phone = window.matchMedia("(max-width: 767px)").matches;
        const side = c === "Bengaluru" || (c === "Mumbai" && !phone) ? "left" : c === "Mumbai" ? "top" : "right";
        b.className = side === "right" ? "sq-city-pin" : `sq-city-pin ${side}`;
        b.addEventListener("click", () => handlers.current.onCity(c));
        const mk = new L.Marker({ element: b, anchor: side === "left" ? "right" : side === "top" ? "bottom" : "left",
          offset: side === "left" ? [9, 0] : side === "top" ? [0, 9] : [-9, 0] }).setLngLat([lon, lat]).addTo(m);
        cityMarkers.current.set(c, { m: mk, b });
      }
    }
    for (const [c, { b }] of cityMarkers.current) paintCity(b, c, data.cities[c]?.values[day] ?? null, pollutant, city !== null);
  }, [ready, data, day, pollutant, city]);

  // ---------------------------------------------------------------- stations for the day; the active one is larger
  const active = station ?? highlight ?? hover;
  useEffect(() => {
    const m = map.current;
    if (ready !== "ready" || !m) return;
    const src = m.getSource("stations") as GeoJSONSource | undefined;
    if (!src) return;
    if (!data || !city) { src.setData(EMPTY); return; }
    const feats = cityStations(data, city, lowCost).map((s) => {
      const st = dayStatus(s, day, pollutant);
      const value = st.kind === "value" ? String(Math.round(st.value)) : "–";
      return {
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [s.lon, s.lat] },
        properties: {
          id: s.id, color: statusColour(st).bg, low: s.tier === "low_cost", value, hasValue: st.kind === "value", rank: st.kind === "value" ? st.value : -1,
          active: s.id === active || s.id === highlight, selected: s.id === station,
          name: `${shortName(s.name)}  ${st.kind === "value" ? value : "not enough data"}`,
        },
      };
    });
    src.setData({ type: "FeatureCollection", features: feats });
  }, [ready, data, city, lowCost, day, pollutant, active, highlight, station]);

  useEffect(() => {
    const m = map.current;
    if (ready === "ready" && m) showCityOutline(m, city);
  }, [ready, city]);

  // ---------------------------------------------------------------- fly in and out (padding keeps stations clear of panels)
  useEffect(() => {
    const m = map.current;
    if (ready !== "ready" || !m || !data) return;
    const duration = reduceMotion ? 0 : 1600;
    if (!city) {
      m.fitBounds(INDIA_BOUNDS, { padding: fitPad(padding, m.getContainer().clientWidth, m.getContainer().clientHeight), duration });
      return;
    }
    const st = cityStations(data, city, lowCost);
    if (!st.length) return;
    const lons = st.map((s) => s.lon), lats = st.map((s) => s.lat);
    m.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
      { padding: fitPad(padding, m.getContainer().clientWidth, m.getContainer().clientHeight), duration, maxZoom: 12.5, essential: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, city, lowCost, data?.pollutant]);

  return (
    // isolate: the map's own stacking stays inside it, under the side panels
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

// ------------------------------------------------------------------ station layers
function diamond(size = 48): ImageData {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  g.fillStyle = "#fff";
  g.beginPath();
  g.moveTo(size / 2, 3); g.lineTo(size - 3, size / 2); g.lineTo(size / 2, size - 3); g.lineTo(3, size / 2);
  g.closePath(); g.fill();
  return g.getImageData(0, 0, size, size);
}

function addStationLayers(m: MLMap) {
  m.addImage("diamond", diamond(), { sdf: true, pixelRatio: 2 });
  m.addSource("stations", { type: "geojson", data: EMPTY });
  // reference monitors: dots with a light ring (so dark maroon "Severe" still stands out); low-cost: diamonds
  m.addLayer({ id: "st-dot", type: "circle", source: "stations", filter: ["!", ["get", "low"]],
    paint: { "circle-color": ["get", "color"], "circle-radius": ["case", ["get", "active"], 9, 5.5],
      "circle-stroke-color": ["case", ["get", "selected"], "#2DD4BF", "rgba(234,240,251,0.85)"],
      "circle-stroke-width": ["case", ["get", "selected"], 3, ["get", "active"], 2, 1.2] } });
  m.addLayer({ id: "st-diamond", type: "symbol", source: "stations", filter: ["get", "low"],
    layout: { "icon-image": "diamond", "icon-size": ["case", ["get", "active"], 1.2, 0.75], "icon-allow-overlap": true, "icon-ignore-placement": true },
    paint: { "icon-color": ["get", "color"], "icon-halo-color": ["case", ["get", "selected"], "#2DD4BF", "rgba(234,240,251,0.9)"], "icon-halo-width": 1.5 } });
  // Value labels only where they fit (MapLibre collision), never on a dot: an invisible marker under every dot
  // (layer "st-block", placed first because it sits above the labels) reserves that space. A label tries the
  // spots around its own dot and is dropped if none is free. Grey stations (no 24-hour value) get no label;
  // their status is in the hover label and the station panel. Higher values are placed first.
  m.addLayer({ id: "st-label", type: "symbol", source: "stations", filter: ["all", ["!", ["get", "active"]], ["get", "hasValue"]],
    layout: { "text-field": ["get", "value"], "text-font": FONT, "text-size": 11.5,
      "text-variable-anchor": ["bottom", "top", "left", "right"], "text-radial-offset": 0.85, "text-justify": "auto",
      "text-allow-overlap": false, "text-padding": 2, "symbol-sort-key": ["-", 0, ["get", "rank"]] },
    paint: { "text-color": "#EAF0FB", "text-halo-color": "rgba(6,10,20,0.95)", "text-halo-width": 1.6 } });
  m.addImage("block", { width: 24, height: 24, data: new Uint8Array(24 * 24 * 4) }, { pixelRatio: 2 });
  m.addLayer({ id: "st-block", type: "symbol", source: "stations",
    layout: { "icon-image": "block", "icon-allow-overlap": true, "icon-ignore-placement": false, "icon-padding": 0 } });
  // the hovered or selected station is always labelled, with its name
  m.addLayer({ id: "st-active-label", type: "symbol", source: "stations", filter: ["get", "active"],
    layout: { "text-field": ["get", "name"], "text-font": FONT, "text-size": 13, "text-offset": [0, -1.3],
      "text-anchor": "bottom", "text-allow-overlap": true, "text-ignore-placement": true },
    paint: { "text-color": "#FFFFFF", "text-halo-color": "rgba(6,10,20,0.98)", "text-halo-width": 2 } });
}

// City marker painting lives outside the component: it only updates the DOM buttons MapLibre positions.
function paintCity(b: HTMLButtonElement, c: string, v: number | null, pollutant: Pollutant, hidden: boolean) {
  const cat = pmCategory(v, pollutant);
  const col = cat ? CATEGORY_STYLE[cat] : { bg: "#64748B", fg: "#fff", label: "No city value" };
  b.style.setProperty("--c", col.bg);
  b.hidden = hidden;
  b.innerHTML = `<span class="dot" aria-hidden="true"></span><span class="lbl" aria-hidden="true"><b>${c}</b> ${v == null ? "no city value" : v.toFixed(1)}</span>`;
  b.setAttribute("aria-label", `${c}: ${v == null ? "no city value this day" : `${v.toFixed(1)} µg/m³ ${POLLUTANT_LABEL[pollutant]}, ${col.label}`}. Show its stations`);
}
