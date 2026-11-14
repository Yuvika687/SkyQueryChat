// Full forms for the short terms the app uses. One list, used by the Term tooltip, the first-use full forms and
// the glossary in the Data & accuracy panel.

export type TermKey = "pm25" | "pm10" | "aqi" | "cpcb" | "ugm3";

export const GLOSSARY: Record<TermKey, { short: string; full: string; plain: string; meaning: string }> = {
  pm25: {
    short: "PM2.5",
    full: "Particulate Matter, 2.5 micrometres or smaller",
    plain: "fine particles",
    meaning: "Tiny particles that reach deep into the lungs. Measured as a concentration in µg/m³.",
  },
  pm10: {
    short: "PM10",
    full: "Particulate Matter, 10 micrometres or smaller",
    plain: "coarse particles",
    meaning: "Larger particles such as dust. Measured as a concentration in µg/m³.",
  },
  aqi: {
    short: "AQI",
    full: "Air Quality Index",
    plain: "a 0–500 index",
    meaning: "An index from 0 to 500 that turns several pollutants into one category. Not a concentration.",
  },
  cpcb: {
    short: "CPCB",
    full: "Central Pollution Control Board",
    plain: "India's national pollution regulator",
    meaning: "India's national pollution regulator. It runs the reference monitors and publishes the daily AQI bulletin.",
  },
  ugm3: {
    short: "µg/m³",
    full: "micrograms per cubic metre",
    plain: "micrograms per cubic metre",
    meaning: "How much particle mass is in one cubic metre of air.",
  },
};

export const GLOSSARY_ORDER: TermKey[] = ["pm25", "pm10", "aqi", "cpcb", "ugm3"];

/** "PM2.5 (fine particles)": the form written the first time a term appears on a page. */
export function firstUse(key: TermKey): string {
  const g = GLOSSARY[key];
  return key === "ugm3" ? `${g.short} (${g.full})` : `${g.short} (${g.plain})`;
}
