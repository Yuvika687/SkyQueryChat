import type { Trend } from "./pages-api";

export const SHORT_NOTE = "Short periods include seasonal change.";

const signed = (v: number, unit: string) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)} ${unit}`;

/** Plain words for a Mann-Kendall / Sen's slope result. Direction only when the test says so (p < 0.05). Periods
 * under 90 days give the total change over the period ("about +120.4 µg/m³ over these 30 days"), never a monthly rate. */
export function trendText(t: Trend, unit = "µg/m³"): { short: string; detail: string } {
  const p = t.p_value == null ? "" : t.p_value.startsWith("<") ? `p ${t.p_value}` : `p = ${t.p_value}`;
  const change = t.change_over_period != null && t.period_days
    ? `about ${signed(t.change_over_period, unit)} over these ${t.period_days} days`
    : t.per_month != null ? `${signed(t.per_month, unit)} per month` : "";
  switch (t.status) {
    case "increasing": return { short: "Rising", detail: `${change} (${p}, ${t.n_days} days with a value)` };
    case "decreasing": return { short: "Falling", detail: `${change} (${p}, ${t.n_days} days with a value)` };
    case "no clear trend": return { short: "No clear trend", detail: `${p}, ${t.n_days} days with a value` };
    default: return { short: "Not enough data", detail: `${t.n_days} days with a value; a trend needs at least 20` };
  }
}
