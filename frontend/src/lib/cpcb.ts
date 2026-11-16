// Official AQI for every city in CPCB's daily 4 PM bulletin (about 330 cities). The six analysed cities keep their full
// station-level analysis; for every other city the app shows CPCB's official AQI only. Read-only, no AI.
import { getJSON } from "./api";
import { aqiCategory, normaliseCategory, type Category } from "./categories";
import { fmtDate } from "./format";

export interface CpcbCity {
  city: string; date: string; aqi: number; category: string | null; main_pollutant: string | null;
  stations_reporting: number | null; is_metro: boolean; label: string; lat: number | null; lon: number | null;
  state?: string | null;
}
export interface CpcbCities { cities: CpcbCity[]; n_cities: number; n_plotted: number; coordinates_source: string; source: string }
export interface CpcbCityDetail {
  city: string; is_metro: boolean; label: string; metro_note: string | null; source: string;
  latest: { date: string; aqi: number; category: string | null; main_pollutant: string | null; stations_reporting: number | null };
  change_from_previous: number | null; previous_date: string | null; n_days_with_value: number;
  series: { date: string; aqi: number | null; category: string | null }[];
  lat: number | null; lon: number | null;
}

export const getCpcbCities = () => getJSON<CpcbCities>("/api/aqi/cities", 20_000);
export const getCpcbCity = (name: string) => getJSON<CpcbCityDetail>(`/api/aqi/city/${encodeURIComponent(name)}`, 20_000);

/** "Official AQI (CPCB 4 PM bulletin, 16 Nov 2026)": how these values are labelled everywhere. */
export const cpcbLabel = (date: string) => `Official AQI (CPCB 4 PM bulletin, ${fmtDate(date)})`;

export function cpcbCategory(c: { category: string | null; aqi: number | null }): Category | null {
  return normaliseCategory(c.category) ?? aqiCategory(c.aqi);
}

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[^a-z]/g, "");
/** Older or local names people type, mapped to the bulletin's name (used only when that name is in the list). */
export const OTHER_NAMES: Record<string, string> = {
  bangalore: "Bengaluru", bombay: "Mumbai", calcutta: "Kolkata", madras: "Chennai", gurgaon: "Gurugram", poona: "Pune",
  newdelhi: "Delhi", baroda: "Vadodara", banaras: "Varanasi", benares: "Varanasi", allahabad: "Prayagraj",
  vizag: "Visakhapatnam", trivandrum: "Thiruvananthapuram", cochin: "Kochi", mysore: "Mysuru", pondicherry: "Puducherry",
  calicut: "Kozhikode", mangalore: "Mangaluru", belgaum: "Belagavi", hubli: "Hubballi", gulbarga: "Kalaburagi",
  secunderabad: "Hyderabad", trichy: "Tiruchirappalli",
};

/** Cities whose name starts with (then contains) what was typed; older names are understood. */
export function searchCpcb(cities: CpcbCity[], query: string, max = 8): CpcbCity[] {
  const q = norm(query);
  if (!q) return [];
  const byName = new Map(cities.map((c) => [c.city, c]));
  const other = Object.entries(OTHER_NAMES).filter(([k]) => k.startsWith(q)).map(([, v]) => byName.get(v))
    .filter((c): c is CpcbCity => !!c);
  const starts = cities.filter((c) => norm(c.city).startsWith(q));
  const contains = cities.filter((c) => !norm(c.city).startsWith(q) && norm(c.city).includes(q));
  return [...new Set([...other, ...starts, ...contains])].slice(0, max);
}

/** Map points for the all-cities layer: only cities with a confident location; the six metros are highlighted. */
export function cpcbFeatures(cities: CpcbCity[], selected: string | null, colour: (c: CpcbCity) => string): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: cities.filter((c) => c.lat != null && c.lon != null).map((c) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [c.lon as number, c.lat as number] },
      properties: { name: c.city, aqi: c.aqi, color: colour(c), metro: c.is_metro, selected: c.city === selected },
    })),
  };
}
