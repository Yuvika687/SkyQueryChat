// Category and colour rules from docs/ui-design-spec.md. Pollution colours are used only for data meaning.
// Hues follow CPCB's official National AQI colours (checked 2026-11-06 against CPCB "About National Air
// Quality Index": Good #00B050, Satisfactory #92D050, Moderate #FFFF00, Poor #FF6500, Very Poor #FF0000,
// Severe #C00000); the spec tunes them for the dark interface.

export type Category = "Good" | "Satisfactory" | "Moderate" | "Poor" | "Very poor" | "Severe";

export const CATEGORY_STYLE: Record<Category | "None", { bg: string; fg: string; label: string }> = {
  Good: { bg: "#22C55E", fg: "#0B1020", label: "Good" },
  Satisfactory: { bg: "#A3E635", fg: "#0B1020", label: "Satisfactory" },
  Moderate: { bg: "#FACC15", fg: "#0B1020", label: "Moderate" },
  Poor: { bg: "#FB923C", fg: "#0B1020", label: "Poor" },
  "Very poor": { bg: "#EF4444", fg: "#FFFFFF", label: "Very poor" },
  Severe: { bg: "#B91C1C", fg: "#FFFFFF", label: "Severe" },
  None: { bg: "#64748B", fg: "#FFFFFF", label: "No valid average" },
};

export const CPCB_OFFICIAL_HEX: Record<Category, string> = {
  Good: "#00B050", Satisfactory: "#92D050", Moderate: "#FFFF00", Poor: "#FF6500", "Very poor": "#FF0000", Severe: "#C00000",
};

const PM_BREAKS: Record<"pm25" | "pm10", number[]> = {
  // upper bounds of Good..Very poor (24-hour averages, µg/m³)
  pm25: [30, 60, 90, 120, 250],
  pm10: [50, 100, 250, 350, 430],
};
const AQI_BREAKS = [50, 100, 200, 300, 400];
const ORDER: Category[] = ["Good", "Satisfactory", "Moderate", "Poor", "Very poor", "Severe"];

/** PM category for a 24-hour mean. Rounds first, then assigns (spec rule). */
export function pmCategory(value: number | null | undefined, pollutant: "pm25" | "pm10"): Category | null {
  if (value == null || !Number.isFinite(value)) return null;
  const v = Math.round(value);
  const i = PM_BREAKS[pollutant].findIndex((b) => v <= b);
  return ORDER[i === -1 ? 5 : i];
}

export function aqiCategory(value: number | null | undefined): Category | null {
  if (value == null || !Number.isFinite(value)) return null;
  const v = Math.round(value);
  const i = AQI_BREAKS.findIndex((b) => v <= b);
  return ORDER[i === -1 ? 5 : i];
}

/** Normalise backend category names ("Very Poor", "Moderately Polluted"). */
export function normaliseCategory(name: unknown): Category | null {
  if (typeof name !== "string") return null;
  const n = name.toLowerCase();
  if (n.startsWith("very")) return "Very poor";
  if (n.startsWith("moderate")) return "Moderate";
  if (n.startsWith("satis")) return "Satisfactory";
  if (n.startsWith("good")) return "Good";
  if (n.startsWith("poor")) return "Poor";
  if (n.startsWith("severe")) return "Severe";
  return null;
}

export const CITY_COLOURS: Record<string, string> = {
  Delhi: "#2DD4BF", Mumbai: "#60A5FA", Kolkata: "#F59E0B", Chennai: "#F472B6", Bengaluru: "#A78BFA", Hyderabad: "#E2E8F0",
};
export const CITIES = Object.keys(CITY_COLOURS);

/** Reference lines (24-hour). India PM10 24-h standard is 100 µg/m³ (NAAQS 2009; CPCB AQI breakpoint table). */
export const REFERENCE_LINES = {
  pm25: [
    { label: "WHO 24-h guideline", value: 15 },
    { label: "India 24-h standard", value: 60 },
  ],
  pm10: [
    { label: "WHO 24-h guideline", value: 45 },
    { label: "India 24-h standard", value: 100 },
  ],
};

export const DATA_TYPE_LABEL: Record<string, string> = {
  measured: "Measured",
  modelled: "Modelled",
  official_aqi: "Official AQI",
  mixed: "Measured + modelled",
};
