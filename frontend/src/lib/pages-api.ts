// Types and fetchers for the city pages and the Compare page (read-only endpoints, no AI).
import { getJSON } from "./api";
import type { ChartSpec } from "./types";

export const CITY_SLUGS = ["delhi", "mumbai", "kolkata", "chennai", "bengaluru", "hyderabad"] as const;
export type CitySlug = (typeof CITY_SLUGS)[number];
export const cityName = (slug: string) => slug.charAt(0).toUpperCase() + slug.slice(1);
export const citySlug = (city: string) => city.toLowerCase();

export interface DayValue { date: string; value: number | null; stations: number }
export interface Trend {
  status: "increasing" | "decreasing" | "no clear trend" | "not enough data"; n_days: number; per_month: number | null; p_value: string | null;
  /** Periods under 90 days: total change along the fitted line over the period (the figure to show). */
  change_over_period?: number | null; period_days?: number | null; note?: string | null;
}

export interface CityPage {
  city: string; date: string; units: string; source: string;
  hero: { pm25: number; pm10: number; stations_reporting: number; stations_total: number; rank_of_six: number; date: string };
  trend30: { start: string; end: string; pm25: DayValue[]; pm10: DayValue[]; trend: Trend };
  calendar: { start: string; end: string; days: DayValue[] };
  diwali: {
    source: string; note: string;
    years: { year: number; status: string; diwali_date: string | null; level: number | null; category: string | null; week_before: number | null;
      change_range_pct?: [number, number]; bulletins: { date: string; evening_of: string; period: string; aqi: number; category: string; source: string }[] }[];
    pm_context: { year: number; source: string; warnings: string[]; festival_pm25: number | null; lower_bound: boolean; stations: number | null;
      blank_share_diwali_night: number | null; comparable_with_earlier_years: boolean }[] | null;
  };
  unusual: { days: { date: string; value: number; median: number; direction: string; reason: string }[]; tested: number; method: string };
  weather: Record<"rainfall" | "wind speed", { rho: number | null; range: [number | null, number | null]; strength: string | null; days: number;
    statement: string | null; groups: { label: string; days: number; mean: number }[]; chart: ChartSpec; source: string }>;
  stations: { id: number; name: string; provider: string; tier: string; type: string; coverage_pct: number; latest: number | null }[];
}

export type Metric = "pm25" | "pm10" | "aqi";
export interface CompareRow { city: string; mean: number | null; range95: [number, number] | null; valid_days: number; coverage_pct: number; trend: Trend; low_coverage: boolean }
export interface CompareData {
  metric: Metric; start: string; end: string; days: number; units: string; data_type: string; source: string; method: string;
  common_days: number; too_close_to_call: [string, string][]; cities: CompareRow[]; dates: string[]; lines: Record<string, (number | null)[]>;
}
export interface Periods { data_start: string; data_end: string; presets: { id: string; label: string; start: string; end: string }[] }

export const getCityPage = (slug: string, signal?: AbortSignal) => getJSON<CityPage>(`/api/city/${slug}`, 60_000, signal);
export const getPeriods = (signal?: AbortSignal) => getJSON<Periods>("/api/compare/periods", 15_000, signal);
export const getCompare = (cities: string[], metric: Metric, start: string, end: string, signal?: AbortSignal) =>
  getJSON<CompareData>(`/api/compare?cities=${encodeURIComponent(cities.join(","))}&metric=${metric}&start=${start}&end=${end}`, 60_000, signal);
