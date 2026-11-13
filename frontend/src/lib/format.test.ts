import { describe, expect, it } from "vitest";
import { fmtSpan, fmtTime, readable } from "./format";

describe("readable dates and times", () => {
  it("writes clock times for people", () => {
    expect(fmtTime("16:00")).toBe("4 PM");
    expect(fmtTime("00:00")).toBe("12 AM");
    expect(fmtTime("09:30")).toBe("9:30 AM");
    expect(fmtTime("12:00")).toBe("12 PM");
  });

  it("rewrites ISO dates and 24-hour times in backend text, leaving numbers alone", () => {
    expect(readable("Each bulletin covers 16:00 IST on the previous day to 16:00 IST on its date."))
      .toBe("Each bulletin covers 4 PM IST on the previous day to 4 PM IST on its date.");
    expect(readable("Delhi's daily bulletins were 344 on 2026-11-09 and 299 on 2026-11-10."))
      .toBe("Delhi's daily bulletins were 344 on 9 Nov 2026 and 299 on 10 Nov 2026.");
    expect(readable("2026-11-08 16:00 to 2026-11-09 16:00 IST")).toBe("4 PM, 8 Nov 2026 to 4 PM, 9 Nov 2026 IST");
    expect(readable("PM2.5 averaged 164.7 µg/m³ (35 of 37 stations)")).toBe("PM2.5 averaged 164.7 µg/m³ (35 of 37 stations)");
  });

  it("shortens ranges inside one month or year", () => {
    expect(fmtSpan("2026-11-05", "2026-11-11")).toBe("5–11 Nov 2026");
    expect(fmtSpan("2026-10-26", "2026-11-11")).toBe("26 Oct – 11 Nov 2026");
    expect(fmtSpan("2025-12-30", "2026-01-02")).toBe("30 Dec 2025 – 2 Jan 2026");
  });
});
