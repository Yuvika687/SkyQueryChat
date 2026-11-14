import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ccRange } from "@/components/shell/data-panel";
import { GLOSSARY, firstUse } from "@/lib/glossary";
import { OfficialAqiChip, officialAqiText } from "./official-aqi";
import { Term } from "./term";

const DELHI = { available: true, date: "2026-11-11", aqi: 313, category: "Very Poor",
  period_start: "2026-11-10T16:00:00+05:30", period_end: "2026-11-11T16:00:00+05:30", source: "CPCB daily AQI bulletin PDF (cpcb.gov.in)" };

describe("OfficialAqiChip", () => {
  it("shows the official AQI, category, bulletin time and readable date", () => {
    render(<OfficialAqiChip aqi={DELHI} />);
    const chip = screen.getByTestId("official-aqi");
    expect(chip).toHaveTextContent("Official AQI");
    expect(chip).toHaveTextContent("313");
    expect(chip).toHaveTextContent("Very poor");
    expect(chip).toHaveTextContent(/CPCB.*4 PM bulletin, 11 Nov 2026/);
  });

  it("says the bulletin is not available instead of estimating", () => {
    render(<OfficialAqiChip aqi={{ available: false, date: "2026-11-12" }} />);
    expect(screen.getByTestId("official-aqi")).toHaveTextContent("Official AQI (Air Quality Index): bulletin not available");
    expect(screen.getByTestId("official-aqi")).not.toHaveTextContent(/\d{2,}/);
    expect(officialAqiText({ available: false, date: "2026-11-12" })).toBe("Official AQI: bulletin not available");
  });

  it("uses plain abbreviations inside links (no nested buttons)", () => {
    render(<a href="/city/delhi"><OfficialAqiChip aqi={DELHI} plain /></a>);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByTitle("Air Quality Index")).toHaveTextContent("AQI");
  });

  it("writes an accessible sentence for card labels", () => {
    expect(officialAqiText(DELHI)).toBe("Official AQI (Air Quality Index) 313, Very poor (CPCB 4 PM bulletin, 11 Nov 2026)");
  });
});

describe("Term", () => {
  it("shows the full form on hover, keyboard focus and tap, and closes with Escape", async () => {
    const user = userEvent.setup();
    render(<p>Value in <Term k="pm25" /></p>);
    const btn = screen.getByRole("button", { name: /^PM2\.5\s*\(Particulate Matter, 2\.5 micrometres or smaller\)$/ });
    expect(screen.queryByRole("tooltip", { hidden: true })).toBeNull();

    await user.hover(btn);
    expect(screen.getByRole("tooltip", { hidden: true })).toHaveTextContent(GLOSSARY.pm25.full);
    await user.unhover(btn);
    expect(screen.queryByRole("tooltip", { hidden: true })).toBeNull();

    await user.tab();
    expect(btn).toHaveFocus();
    expect(screen.getByRole("tooltip", { hidden: true })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("tooltip", { hidden: true })).toBeNull();
    btn.blur();

    fireEvent.click(btn);                                              // tap
    expect(screen.getByRole("tooltip", { hidden: true })).toHaveTextContent(GLOSSARY.pm25.full);
    expect(btn).toHaveAttribute("aria-expanded", "true");
  });

  it("has full forms for every short term", () => {
    expect(GLOSSARY.aqi.full).toBe("Air Quality Index");
    expect(GLOSSARY.cpcb.full).toBe("Central Pollution Control Board");
    expect(GLOSSARY.ugm3.full).toBe("micrograms per cubic metre");
    expect(firstUse("pm25")).toBe("PM2.5 (fine particles)");
    expect(firstUse("pm10")).toBe("PM10 (coarse particles)");
  });
});

describe("ccRange", () => {
  it("gives the lowest and highest stored share", () => {
    expect(ccRange({ A: { within_20pct: 76.2 }, B: { within_20pct: 97.5 } })).toBe("76.2–97.5%");
  });
});
