// Shared map setup for Home and Explore.
// Basemap: OpenFreeMap "dark" vector style (no API key; OpenMapTiles schema, OpenStreetMap data). Its border,
// label and road layers are removed, so only land and water remain. India is drawn on top from the official
// boundary of India as per the Survey of India (DataMeet india-composite.geojson, CC0). Never any heat surface.
import type { Map as MLMap, StyleSpecification } from "maplibre-gl";

export const STYLE_URL = "https://tiles.openfreemap.org/styles/dark";
export const BOUNDARY_URL = "/geo/india-official.geojson";
export const WORKER_URL = "/maplibre/maplibre-gl-worker.mjs"; // copied from the package at build time
export const INDIA_BOUNDS: [[number, number], [number, number]] = [[67.6, 6.4], [97.8, 37.3]];
export const THEME = { land: "#0C1426", water: "#050912", waterLine: "#0A1222", mask: "#050912", indiaFill: "#101B33", outline: "#5E7AB0" };

export type IndiaGeo = { type: "FeatureCollection"; features: { geometry: { type: "MultiPolygon"; coordinates: number[][][][] } }[] };

export function hasWebGL(): boolean {
  const c = document.createElement("canvas");
  return !!(c.getContext("webgl2") || c.getContext("webgl"));
}

export async function loadBoundary(): Promise<IndiaGeo> {
  const r = await fetch(BOUNDARY_URL);
  if (!r.ok) throw new Error("boundary");
  return r.json();
}

/** The dark style with only land and water kept, recoloured to the app's palette. */
export async function loadBaseStyle(): Promise<StyleSpecification> {
  const r = await fetch(STYLE_URL);
  if (!r.ok) throw new Error("style");
  const style = await r.json();
  type Layer = { id: string; type: string; paint?: Record<string, unknown> };
  style.layers = (style.layers as Layer[])
    .filter((l) => l.type === "background" || l.id === "water" || l.id === "waterway" || l.id.startsWith("landcover") || l.id.startsWith("landuse"))
    .map((l) => {
      if (l.type === "background") l.paint = { "background-color": THEME.land };
      else if (l.id === "water") l.paint = { "fill-color": THEME.water };
      else if (l.id === "waterway") l.paint = { "line-color": THEME.waterLine, "line-width": 0.6 };
      else l.paint = { ...(l.paint ?? {}), "fill-opacity": 0.12 };
      return l;
    });
  return style;
}

/** Dim everything outside India and draw the official boundary. */
export function addIndiaLayers(map: MLMap, geo: IndiaGeo, opts: { maskOpacity?: number } = {}) {
  const holes = geo.features[0].geometry.coordinates.map((poly) => poly[0]);
  map.addSource("india", { type: "geojson", data: geo as unknown as GeoJSON.FeatureCollection });
  map.addSource("mask", { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "Polygon",
    coordinates: [[[-179, -80], [179, -80], [179, 80], [-179, 80], [-179, -80]], ...holes] } } });
  map.addLayer({ id: "mask", type: "fill", source: "mask", paint: { "fill-color": THEME.mask, "fill-opacity": opts.maskOpacity ?? 0.72 } });
  map.addLayer({ id: "india-fill", type: "fill", source: "india", paint: { "fill-color": THEME.indiaFill, "fill-opacity": 0.9 } });
  map.addLayer({ id: "india-line", type: "line", source: "india", paint: { "line-color": THEME.outline, "line-width": 1 } });
}

export const MAP_CREDITS = [
  { text: "OpenFreeMap", href: "https://openfreemap.org" },
  { text: "OpenMapTiles", href: "https://openmaptiles.org" },
  { text: "OpenStreetMap", href: "https://www.openstreetmap.org/copyright" },
  { text: "DataMeet", href: "https://github.com/datameet/maps" },
];
