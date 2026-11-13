import { describe, expect, it } from "vitest";
import { dayStatus, fmtLastReading, parseView, rankStations, statusText, viewQuery } from "./explore";
import type { ExploreStation } from "./types";

const st = (id: number, values: (number | null)[], hours: (number | null)[]): ExploreStation => ({
  id, city: "Delhi", name: `S${id}`, provider: "CPCB", tier: "primary", type: "Reference monitor", lat: 28.6, lon: 77.2,
  km_from_centre: 1, last_reading_utc: null, values, valid_hours: hours,
});

describe("Explore station days", () => {
  it("separates a value, not enough data (under 16 hours) and no readings", () => {
    const s = st(1, [130.4, null, null], [22, 12, null]);
    expect(dayStatus(s, 0, "pm25")).toEqual({ kind: "value", value: 130.4, hours: 22, category: "Very poor" });
    expect(dayStatus(s, 1, "pm25")).toEqual({ kind: "not_enough", hours: 12 });
    expect(dayStatus(s, 2, "pm25")).toEqual({ kind: "no_data" });
    expect(statusText(dayStatus(s, 1, "pm25"))).toBe("Not enough data (12 of 24 hours; a day needs 16)");
    // the same value is a different category for PM10
    expect(dayStatus(s, 0, "pm10")).toMatchObject({ category: "Moderate" });
  });

  it("ranks stations highest first, days without a value last", () => {
    const r = rankStations([st(1, [50], [20]), st(2, [null], [10]), st(3, [90], [24])], 0);
    expect(r.map((s) => s.id)).toEqual([3, 1, 2]);
  });

  it("keeps the view in the address and reads it back", () => {
    const v = parseView(new URLSearchParams("city=delhi&station=5626&pollutant=PM10&date=2026-11-09"));
    expect(v).toEqual({ city: "Delhi", station: 5626, pollutant: "pm10", date: "2026-11-09" });
    expect(viewQuery(v)).toBe("city=delhi&station=5626&pollutant=pm10&date=2026-11-09");
    expect(parseView(new URLSearchParams("city=paris&station=1"))).toEqual({ city: null, station: null, pollutant: "pm25", date: null });
  });

  it("writes the last reading in Indian time", () => {
    expect(fmtLastReading("2026-11-11T18:00:00Z")).toBe("11:30 PM, 11 Nov 2026 IST");
    expect(fmtLastReading("2026-11-11T04:45:00Z")).toBe("10:15 AM, 11 Nov 2026 IST");
    expect(fmtLastReading(null)).toBe("Not known");
  });
});
