// Up to three follow-up suggestions. The model writes them in its final answer (the backend drops any with
// unsupported numbers or causal wording). Only when it gives none do we fall back to templates filled with the
// city, pollutant and year the backend reported in resolved_query.
import type { Turn } from "./chat-state";
import { fmtDate } from "./format";

const norm = (q: string) => q.toLowerCase().replace(/[^a-z0-9]/g, "");

export function followUps(t: Turn): string[] {
  const own = (t.answer?.follow_ups ?? []).filter((q) => q.trim() && norm(q) !== norm(t.question));
  if (own.length && t.answer?.status !== "error") return own.slice(0, 3);
  return templateFollowUps(t);
}

export function templateFollowUps(t: Turn): string[] {
  const rq = t.answer?.resolved_query;
  if (!rq || t.answer?.status !== "answered") return [];
  const cities = rq.cities?.length ? rq.cities : rq.city ? [rq.city] : [];
  const city = cities[0];
  if (!city) return [];
  const pol = rq.pollutant && /pm10/i.test(rq.pollutant) ? "PM10" : "PM2.5";
  const aqi = /aqi/i.test(rq.pollutant ?? "");
  const year = (rq.end_date ?? "").slice(0, 4) || "2025";
  const other = city === "Mumbai" ? "Delhi" : "Mumbai";
  const out = aqi
    ? [
        `Compare ${city}'s Diwali AQI in 2024 and 2025.`,
        `Were there any unusual PM2.5 days in ${city} in ${year}?`,
        `How complete is the data for ${city} in ${year}?`,
      ]
    : cities.length > 1
      ? [
          `Were there any unusual ${pol} days in ${city} in ${year}?`,
          `How did wind speed relate to ${pol} in ${city}?`,
          `How complete is the data for ${city} in ${year}?`,
        ]
      : [
          rq.start_date && rq.end_date
            ? `Compare ${pol} in ${city} and ${other} from ${fmtDate(rq.start_date)} to ${fmtDate(rq.end_date)}.`
            : `Compare ${pol} in ${city} and ${other} over the last 30 days.`,
          `Were there any unusual ${pol} days in ${city} in ${year}?`,
          `Is rain associated with lower ${pol} in ${city}?`,
        ];
  const asked = norm(t.question);
  return out.filter((q) => norm(q) !== asked).slice(0, 3);
}
