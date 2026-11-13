import type { Trend } from "./pages-api";

/** Plain words for a Mann-Kendall / Sen's slope result. Direction only when the test says so (p < 0.05). */
export function trendText(t: Trend, unit = "µg/m³"): { short: string; detail: string } {
  const p = t.p_value == null ? "" : t.p_value.startsWith("<") ? `p ${t.p_value}` : `p = ${t.p_value}`;
  const slope = t.per_month == null ? "" : `${t.per_month > 0 ? "+" : t.per_month < 0 ? "−" : ""}${Math.abs(t.per_month).toFixed(1)} ${unit} per month`;
  switch (t.status) {
    case "increasing": return { short: "Rising", detail: `${slope} (${p}, ${t.n_days} days)` };
    case "decreasing": return { short: "Falling", detail: `${slope} (${p}, ${t.n_days} days)` };
    case "no clear trend": return { short: "No clear trend", detail: `${p}, ${t.n_days} days` };
    default: return { short: "Not enough data", detail: `${t.n_days} days with a value; a trend needs at least 20` };
  }
}
