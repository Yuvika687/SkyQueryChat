import { describe, expect, it } from "vitest";
import { cityColour, CITY_COLOURS, EXTRA_COLOURS } from "./categories";
import { keyNumbers } from "./key-numbers";
import type { Card } from "./types";

const card = (dataset_id: string, field: string, label: string, value: number): Card =>
  ({ dataset_id, field, label, value, unit: "AQI (index)", data_type: "official_aqi", source: "CPCB", warnings: [] }) as unknown as Card;

describe("keyNumbers", () => {
  it("shows the same figure once even when two datasets carry it", () => {
    const k = keyNumbers([
      card("ds1", "2025_festival_aqi", "Delhi official AQI, Diwali 2025", 352),
      card("ds1", "2026_festival_aqi", "Delhi official AQI, Diwali 2026", 321.5),
      card("ds2", "2025_festival_aqi", "Delhi official AQI, Diwali 2025", 352),
    ]);
    expect(k.map((x) => x.label)).toEqual(["Diwali 2025", "Diwali 2026"]);
  });
});

describe("cityColour", () => {
  it("keeps the six metros' colours and gives other cities distinct ones", () => {
    const sel = ["Delhi", "Rohtak", "Lucknow"];
    expect(cityColour("Delhi", sel)).toBe(CITY_COLOURS.Delhi);
    expect(cityColour("Rohtak", sel)).toBe(EXTRA_COLOURS[0]);
    expect(cityColour("Lucknow", sel)).toBe(EXTRA_COLOURS[1]);
    expect(Object.values(CITY_COLOURS)).not.toContain(cityColour("Lucknow", sel));
  });
});
