// Up to three follow-up suggestions. These are question templates, not data: they are filled only with the
// city, pollutant and year the backend reported in resolved_query.
import type { Turn } from "./chat-state";
import { fmtDate } from "./format";

export function followUps(t: Turn): string[] {
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
  const asked = t.question.toLowerCase().replace(/[^a-z0-9]/g, "");
  return out.filter((q) => q.toLowerCase().replace(/[^a-z0-9]/g, "") !== asked).slice(0, 3);
}
