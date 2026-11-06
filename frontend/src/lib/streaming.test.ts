import { describe, expect, it, vi } from "vitest";
import { streamChat } from "./api";
import { applyEvent, backupModel, newTurn, servedFrom } from "./chat-state";
import { SSEParser, readSSE } from "./sse";
import { fixture, fixtureEvents, sseResponse } from "@/test/fixtures";
import type { ChatEvent } from "./types";

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}

describe("SSE parser", () => {
  it("parses a real recorded live stream in backend order", () => {
    const evs = fixtureEvents("compare-live.sse");
    const names = evs.map((e) => e.event);
    expect(names[0]).toBe("meta");
    expect(names.slice(-6)).toEqual(["answer", "cards", "chart", "sources", "warnings", "done"]);
    expect(names.filter((n) => n === "step").length).toBeGreaterThan(3);
  });

  it("handles chunks split mid-line, CRLF and keep-alive pings", () => {
    const body = ': ping\r\n\r\nevent: meta\r\ndata: {"request_id":"r1","session_id":"' + "a".repeat(32) + '"}\r\n\r\n: ping\n\nevent: step\ndata: {"seq":1,"type":"run_started","title":"question received","detail":{}}\n\n';
    const p = new SSEParser();
    const out: ChatEvent[] = [];
    for (let i = 0; i < body.length; i += 5) out.push(...p.push(body.slice(i, i + 5)));
    out.push(...p.flush());
    expect(out.map((e) => e.event)).toEqual(["meta", "step"]);
  });

  it("ignores unknown events and bad JSON", () => {
    const p = new SSEParser();
    expect(p.push("event: other\ndata: {}\n\nevent: step\ndata: {not json\n\n")).toEqual([]);
  });

  it("reads a byte stream delivered in small chunks", async () => {
    const res = sseResponse(fixture("diwali-cached.sse"));
    const evs = await collect(readSSE(res.body!));
    expect(evs.at(-1)?.event).toBe("done");
  });
});

describe("streamChat", () => {
  it("streams events from the backend", async () => {
    const f = vi.fn().mockResolvedValue(sseResponse(fixture("compare-live.sse")));
    const evs = await collect(streamChat("Compare Delhi and Mumbai over the last 30 days", null, undefined, f));
    expect(evs.at(-1)?.event).toBe("done");
    const body = JSON.parse(f.mock.calls[0][1].body);
    expect(body).toEqual({ message: "Compare Delhi and Mumbai over the last 30 days" });
  });

  it("sends the session id on follow-ups", async () => {
    const f = vi.fn().mockResolvedValue(sseResponse(fixture("compare-live.sse")));
    await collect(streamChat("and PM10?", "b".repeat(32), undefined, f));
    expect(JSON.parse(f.mock.calls[0][1].body).session_id).toBe("b".repeat(32));
  });

  it("turns HTTP 429 into a rate_limited error with Retry-After", async () => {
    const f = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "rate_limited", message: "Too many questions. Please wait 41 seconds." } }), {
        status: 429,
        headers: { "Retry-After": "42", "Content-Type": "application/json" },
      }),
    );
    const [ev] = await collect(streamChat("q", null, undefined, f));
    expect(ev).toEqual({ event: "error", data: { code: "rate_limited", message: "Too many questions. Please wait 41 seconds.", retry_after_s: 42 } });
  });

  it("turns a network failure into a plain network error", async () => {
    const f = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const [ev] = await collect(streamChat("q", null, undefined, f));
    expect(ev.event).toBe("error");
    expect((ev.data as { code: string }).code).toBe("network");
    expect((ev.data as { message: string }).message).not.toMatch(/TypeError|fetch/);
  });

  it("maps 422 to invalid_input", async () => {
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: "message: too long" } }), { status: 422 }));
    const [ev] = await collect(streamChat("q", null, undefined, f));
    expect((ev.data as { code: string }).code).toBe("invalid_input");
  });
});

describe("turn state", () => {
  it("builds a complete answered turn from a live stream", () => {
    const t = fixtureEvents("compare-live.sse").reduce(applyEvent, newTurn("Compare Delhi and Mumbai over the last 30 days"));
    expect(t.phase).toBe("done");
    expect(t.answer?.status).toBe("answered");
    expect(t.answer?.resolved_query?.cities).toEqual(["Delhi", "Mumbai"]);
    expect(t.cards.length).toBeGreaterThan(0);
    expect(t.sessionId).toMatch(/^[a-f0-9]{32}$/);
    expect(servedFrom(t)).toBeNull();
    expect(backupModel(t)).toBeNull(); // answered by the primary model
  });

  it("marks cached / demo replays", () => {
    const t = fixtureEvents("diwali-cached.sse").reduce(applyEvent, newTurn("How bad was Delhi's air on Diwali 2025?"));
    expect(servedFrom(t)).toBe("demo");
    expect(t.answer?.required_warnings.map((w) => w.code)).toContain("aqi_not_concentration");
  });

  it("labels a backup model", () => {
    const evs = fixtureEvents("compare-live.sse").map((e) =>
      e.event === "answer" ? ({ ...e, data: { ...e.data, model: "groq:openai/gpt-oss-120b" } } as ChatEvent) : e,
    );
    const t = evs.reduce(applyEvent, newTurn("q"));
    expect(backupModel(t)).toBe("openai/gpt-oss-120b");
  });

  it("ends in error when the backend sends error + done", () => {
    const evs: ChatEvent[] = [
      { event: "meta", data: { request_id: "r", session_id: "s".repeat(32) } },
      { event: "error", data: { code: "ai_limit", message: "The live AI limit has been reached for now.", demo_questions: ["a"] } },
      { event: "done", data: { request_id: "r", session_id: "s".repeat(32), status: "error", cached: false, elapsed_ms: 5 } },
    ];
    const t = evs.reduce(applyEvent, newTurn("q"));
    expect(t.phase).toBe("error");
    expect(t.error?.code).toBe("ai_limit");
  });

  it("keeps notices once each", () => {
    const n: ChatEvent = { event: "notice", data: { code: "fallback", message: "backup" } };
    const t = [n, n].reduce(applyEvent, newTurn("q"));
    expect(t.notices).toHaveLength(1);
  });
});
