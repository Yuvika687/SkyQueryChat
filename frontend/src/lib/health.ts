// CPCB's official health statements for the six AQI categories, verbatim from the "Health Statements for AQI
// Categories" table printed in CPCB's daily AQI bulletin (cpcb.gov.in, e.g. the bulletin dated 11 Nov 2026).
// The PM2.5 and PM10 categories use the same names (they are the AQI health breakpoints for those pollutants).
import type { Category } from "./categories";

export const HEALTH_SOURCE = "CPCB daily AQI bulletin, “Health Statements for AQI Categories”";
export const HEALTH_SOURCE_URL = "https://cpcb.nic.in/AQI_Bulletin.php";

export const HEALTH_NOTE: Record<Category, string> = {
  "Good": "Minimal Impact",
  "Satisfactory": "Minor breathing discomfort to sensitive people",
  "Moderate": "Breathing discomfort to the people with lungs, asthma and heart diseases",
  "Poor": "Breathing discomfort to most people on prolonged exposure",
  "Very poor": "Respiratory illness on prolonged exposure",
  "Severe": "Affects healthy people and seriously impacts those with existing diseases",
};

export const healthNote = (c: Category | null | undefined) => (c ? HEALTH_NOTE[c] : null);
