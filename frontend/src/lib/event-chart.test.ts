import { describe, expect, it } from "vitest";
import { eventKey, eventName } from "./chart-options";
import type { ChartSpec } from "./types";

const spec = (title: string): ChartSpec => ({
  type: "line", title, x: { field: "x" }, y: { field: "aqi", label: "AQI" }, units: "index (0-500)",
  series: [{ name: "a", data: [{ x: 0, aqi: 100 }] as unknown as [string, number][] }], bands: [{ label: "b", start: 0, end: 1 }],
} as unknown as ChartSpec);

describe("event charts name their own occasion", () => {
  it("reads the occasion from the title", () => {
    expect(eventName(spec("Delhi: official CPCB AQI around Holi 2026"))).toBe("Holi");
    expect(eventName(spec("Patna: official CPCB AQI around Chhath Puja (evening arghya) 2025, Chhath Puja (evening arghya) 2026"))).toBe("Chhath Puja");
    expect(eventName(spec("Delhi: official CPCB AQI by bulletin date around Diwali"))).toBe("Diwali");
    expect(eventName(spec("Something else"))).toBe("Diwali");
  });
  it("keeps the Diwali key and words other occasions plainly", () => {
    expect(eventKey(spec("Delhi: official CPCB AQI by bulletin date around Diwali"))).toMatch(/Diwali night/);
    const k = eventKey(spec("Rohtak: official CPCB AQI around 9 Nov 2026"));
    expect(k).toMatch(/9 Nov/);
    expect(k).not.toMatch(/Diwali/);
  });
});
