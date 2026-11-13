import { describe, expect, it } from "vitest";
import { fixtureEvents } from "@/test/fixtures";
import { applyEvent, newTurn, type Turn } from "./chat-state";
import { proofFor, segments, targetsFor } from "./proof";

function turnFrom(name: string): Turn {
  return fixtureEvents(name).reduce((t, e) => applyEvent(t, e), newTurn("q"));
}

describe("clickable numbers and their proof", () => {
  it("highlights only numbers the backend returned, never dates, years or labels", () => {
    const t = turnFrom("diwali-cached.sse");
    const targets = targetsFor(t);
    const v = t.cards[0].value;
    const text = `PM2.5 on 21 Oct 2025 in 2025 was ${v} and 99999 was not.`;
    const segs = segments(text, targets);
    const clickable = segs.filter((s) => s.target).map((s) => s.text);
    expect(clickable).toEqual([String(v)]);
    expect(segs.map((s) => s.text).join("")).toBe(text);           // nothing lost or changed
  });

  it("a festival-level proof lists the bulletins and checks out", () => {
    const t = turnFrom("diwali-cached.sse");
    const card = t.cards.find((c) => /_festival_aqi$/.test(c.field))!;
    const p = proofFor({ id: "x", kind: "card", value: card.value, card }, t);
    expect(p.unit).toBe("AQI");
    expect(p.rows.length).toBeGreaterThanOrEqual(1);
    expect(p.rows.every((r) => r.title.startsWith("Bulletin dated "))).toBe(true);
    const mean = p.rows.reduce((a, r) => a + Number(r.value), 0) / p.rows.length;
    expect(Math.abs(mean - card.value)).toBeLessThan(0.51);       // AQI bulletins are whole numbers
    expect(p.check).toMatch(/^Copied exactly from the analysis result\./);
    expect(JSON.stringify(p)).not.toMatch(/gemini|groq|\d{4}-\d{2}-\d{2}|16:00/);   // no model name, readable dates
  });
});
