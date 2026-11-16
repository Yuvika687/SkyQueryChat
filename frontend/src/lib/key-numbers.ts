// The compact "key numbers" strip under the answer: 2-3 values with short labels and subtle dates.
// Values come straight from the backend's code-built cards; only the label wording is shortened here.
import { aqiCategory, type Category } from "./categories";
import { fmtDate } from "./format";
import type { Card, DataType } from "./types";

export interface KeyNumber {
  key: string;
  label: string;
  value: string; // display value (AQI as a whole number)
  exact: number; // the card's exact value (data table / CSV keep this)
  unit: string;
  sub: string | null; // subtle date or qualifier
  category: Category | null;
  dataType: DataType;
  /** Only a level (a concentration or AQI) gets a category badge and scale bar. */
  role: NonNullable<Card["role"]>;
  /** "95% range 70.0–96.1" for a city mean in a comparison */
  range: string | null;
}

/** The card's role; older saved answers carry none, so it is inferred from the field name and unit. */
export function cardRole(c: Card): NonNullable<Card["role"]> {
  if (c.role) return c.role;
  const f = c.field;
  if (/^difference_|^trend_change|^trend_per/.test(f)) return "difference";
  if (/^ratio_/.test(f) || c.unit === "×") return "ratio";
  if (/(^|_)n_|_count$|_days$|^days/.test(f) || /^(days|stations|cities|station-days|hours)$/.test(c.unit)) return "count";
  if (c.unit === "%") return "share";
  if (/_rank$/.test(f)) return "rank";
  if (/rho|p_value|_range_(low|high)$/.test(f) || !/µg|ug|index/i.test(c.unit)) return "statistic";
  return "level";
}

const PN: Record<string, string> = { pm25: "PM2.5", pm10: "PM10" };
const DATE = /\d{4}-\d{2}-\d{2}/g;

export const isAqiCard = (c: Card) => c.data_type === "official_aqi" && /index/i.test(c.unit);

/** Bulletin AQI values are whole numbers and stay whole; a mean of bulletins (e.g. 321.5) keeps its one
 * decimal, so the figure matches the headline and its proof. */
export function fmtAqi(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

export function fmtNumber(c: Card): string {
  if (cardRole(c) === "ratio") return `${c.value.toFixed(1)}×`;
  if (isAqiCard(c)) return fmtAqi(c.value);
  if (/µg|ug/.test(c.unit)) return c.value.toFixed(1); // concentrations always to one decimal, as calculated
  if (Number.isInteger(c.value)) return c.value.toLocaleString("en-IN");
  if (c.unit === "%") return c.value.toFixed(1);
  if (Math.abs(c.value) < 1) return c.value.toFixed(3).replace("-", "−");
  return c.value.toFixed(1);
}

function datesIn(label: string): string | null {
  const ds = label.match(DATE);
  if (!ds) return null;
  return ds.length >= 2 ? `${fmtDate(ds[0])} – ${fmtDate(ds[ds.length - 1])}` : fmtDate(ds[0]);
}

function shortLabel(c: Card, sameCity: string | null): { label: string; sub: string | null } {
  const f = c.field;
  let m: RegExpMatchArray | null;
  if ((m = f.match(/^(\w+)_mean$/)) && /^[A-Z]/.test(m[1])) return { label: m[1], sub: /common days/.test(c.label) ? "on common days" : null };
  // the period is already in the headline and evidence row: no need to repeat it under each figure
  if (f === "mean") return { label: "Average", sub: null };
  if (f === "median") return { label: "Median day", sub: null };
  if (f === "highest_value") return { label: "Highest day", sub: datesIn(c.label) };
  if (f === "lowest_value") return { label: "Lowest day", sub: datesIn(c.label) };
  if ((m = f.match(/^(\d{4})_festival_aqi$/))) return { label: `Diwali ${m[1]}`, sub: "festival bulletins" };
  if ((m = f.match(/^(\d{4})_bulletin_(\d{4}-\d{2}-\d{2})$/))) return { label: "Bulletin", sub: fmtDate(m[2]) };
  if ((m = f.match(/^(\d{4})_pre_week_aqi$/))) return { label: "Week before", sub: `Diwali ${m[1]}` };
  if ((m = f.match(/^(\d{4})_pct_(change|low|high)$/))) return { label: m[2] === "change" ? "Change" : m[2] === "low" ? "Change (low)" : "Change (high)", sub: `Diwali ${m[1]}` };
  if (f === "rain_mean") return { label: "Rain days", sub: "mean" };
  if (f === "dry_mean") return { label: "Dry days", sub: "mean" };
  if (f === "rho") return { label: "Spearman ρ", sub: null };
  if ((m = f.match(/^q(\d)_mean$/))) return { label: c.label.split(", ").slice(1).join(", ") || `Group ${m[1]}`, sub: "mean" };
  if (/^day\d+_value$/.test(f)) return { label: /low/.test(c.label) ? "Unusually low" : "Unusually high", sub: datesIn(c.label) };
  if ((m = f.match(/^difference_([A-Za-z]+)_minus_([A-Za-z]+)$/))) return { label: "Difference", sub: `${m[1]} minus ${m[2]}` };
  if ((m = f.match(/^ratio_([A-Za-z]+)_to_([A-Za-z]+)$/))) return { label: "Ratio", sub: `${m[1]} ÷ ${m[2]}` };
  if (f === "unusual_count" || f === "n_unusual_days") return { label: "Unusual days", sub: null };
  if (f === "high_count" || f === "n_unusually_high_days") return { label: "Unusually high", sub: "days" };
  if (f === "low_count" || f === "n_unusually_low_days") return { label: "Unusually low", sub: "days" };
  if ((m = f.match(/^(pm25|pm10)_share_pct$/))) return { label: `${PN[m[1]]} coverage`, sub: "share of days" };
  if ((m = f.match(/^(pm25|pm10)_(?:n_)?days_with_value$/))) return { label: `${PN[m[1]]} days`, sub: "with a city value" };
  if (f === "days_in_period" || f === "n_days_in_period") return { label: "Days in period", sub: null };
  if ((m = f.match(/^(pm25|pm10)_festival_lower_bound$/))) return { label: `${PN[m[1]]} festival`, sub: "lower bound" };
  if ((m = f.match(/^(pm25|pm10)_baseline_lower_bound$/))) return { label: `${PN[m[1]]} baseline`, sub: "lower bound" };
  // fallback: drop the city prefix (already in the answer) and move dates to the subtle line
  let label = c.label.replace(DATE, "").replace(/\s*\(\s*\)|,\s*to\s*$|\s+to\s*$/g, "").replace(/[,\s]+$/, "");
  if (sameCity && label.startsWith(sameCity + " ")) label = label.slice(sameCity.length + 1);
  label = label.charAt(0).toUpperCase() + label.slice(1);
  return { label, sub: datesIn(c.label) };
}

/** Up to three key numbers; rank cards are dropped (the answer already says which is higher). */
export function keyNumbers(cards: Card[], max = 3): KeyNumber[] {
  // rank cards are dropped, and the same figure is shown once (older saved answers may repeat a card)
  const seen = new Set<string>();
  const usable = cards.filter((c) => {
    const k = `${c.label}|${c.value}`;
    if (/(^|_)rank$/.test(c.field) || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const cities = new Set(usable.map((c) => c.label.split(" ")[0]));
  const sameCity = cities.size === 1 ? [...cities][0] : null;
  return usable.slice(0, max).map((c) => {
    const { label, sub } = shortLabel(c, sameCity);
    const aqi = isAqiCard(c);
    const role = cardRole(c);
    const r = c.range95 && c.range95.length === 2 ? c.range95 : null;
    return {
      key: `${c.dataset_id}.${c.field}`,
      label,
      value: fmtNumber(c),
      exact: c.value,
      unit: aqi ? "AQI" : c.unit,
      sub,
      category: aqi && role === "level" ? aqiCategory(c.value) : null,
      dataType: c.data_type,
      role,
      range: r ? `95% range ${r[0].toFixed(1)}–${r[1].toFixed(1)}` : null,
    };
  });
}
