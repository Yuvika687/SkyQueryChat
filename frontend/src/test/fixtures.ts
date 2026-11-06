// Real SSE bodies recorded from the local backend (see fixtures/*.sse).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SSEParser } from "@/lib/sse";
import type { ChatEvent } from "@/lib/types";

export const fixture = (name: string) => readFileSync(join(__dirname, "fixtures", name), "utf8");

export function fixtureEvents(name: string): ChatEvent[] {
  const p = new SSEParser();
  return [...p.push(fixture(name)), ...p.flush()];
}

export function sseResponse(body: string, init: ResponseInit = {}): Response {
  const enc = new TextEncoder();
  // deliver in small, uneven chunks to exercise chunk-boundary handling
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < body.length; i += 37) chunks.push(enc.encode(body.slice(i, i + 37)));
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      for (const ch of chunks) c.enqueue(ch);
      c.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" }, ...init });
}
