import { describe, expect, it } from "vitest";
import { cpcbCategory, cpcbFeatures, cpcbLabel, searchCpcb, type CpcbCity } from "./cpcb";
import { parseView, viewQuery } from "./explore";

const city = (name: string, aqi: number, extra: Partial<CpcbCity> = {}): CpcbCity => ({
  city: name, date: "2026-11-16", aqi, category: null, main_pollutant: "PM2.5", stations_reporting: 3, is_metro: false,
  label: "", lat: 20, lon: 78, ...extra,
});
const CITIES = [city("Bengaluru", 115, { is_metro: true }), city("Lucknow", 169), city("Mumbai", 136, { is_metro: true }),
  city("Gurugram", 290), city("Navi Mumbai", 120), city("Satara", 80, { lat: null, lon: null })];

describe("all CPCB cities", () => {
  it("finds cities by their start, then by any part, and understands older names", () => {
    expect(searchCpcb(CITIES, "luck").map((c) => c.city)).toEqual(["Lucknow"]);
    expect(searchCpcb(CITIES, "mumbai").map((c) => c.city)).toEqual(["Mumbai", "Navi Mumbai"]);
    expect(searchCpcb(CITIES, "Bangalore")[0].city).toBe("Bengaluru");
    expect(searchCpcb(CITIES, "bombay")[0].city).toBe("Mumbai");
    expect(searchCpcb(CITIES, "gurgaon")[0].city).toBe("Gurugram");
    expect(searchCpcb(CITIES, "   ")).toEqual([]);
  });

  it("plots only cities with a confident location and highlights the metros", () => {
    const fc = cpcbFeatures(CITIES, "Lucknow", () => "#fff");
    expect(fc.features.map((f) => f.properties?.name)).not.toContain("Satara");
    expect(fc.features.find((f) => f.properties?.name === "Mumbai")?.properties?.metro).toBe(true);
    expect(fc.features.find((f) => f.properties?.name === "Lucknow")?.properties?.selected).toBe(true);
  });

  it("uses CPCB's category name, falling back to the AQI band", () => {
    expect(cpcbCategory({ category: "Very Poor", aqi: 320 })).toBe("Very poor");
    expect(cpcbCategory({ category: null, aqi: 169 })).toBe("Moderate");
  });

  it("labels values as official AQI from the 4 PM bulletin with its date", () => {
    expect(cpcbLabel("2026-11-16")).toBe("Official AQI (CPCB 4 PM bulletin, 16 Nov 2026)");
  });

  it("keeps the all-cities layer and its city in the Explore address", () => {
    const v = parseView(new URLSearchParams("layer=cpcb&cpcb=Lucknow&pollutant=pm25"));
    expect(v.layer).toBe("cpcb");
    expect(v.cpcb).toBe("Lucknow");
    expect(viewQuery({ city: null, station: null, pollutant: "pm25", date: null, layer: "cpcb", cpcb: "Navi Mumbai" }))
      .toBe("pollutant=pm25&layer=cpcb&cpcb=Navi+Mumbai");
    expect(parseView(new URLSearchParams("pollutant=pm10")).layer).toBe("stations");
  });
});
