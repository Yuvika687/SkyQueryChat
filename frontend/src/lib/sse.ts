// Incremental Server-Sent Events parser for fetch() streams.
// EventSource can't POST, so the chat stream is read with fetch + this parser.
import type { ChatEvent } from "./types";

const KNOWN = new Set(["meta", "notice", "step", "answer", "cards", "chart", "sources", "warnings", "error", "done"]);

export class SSEParser {
  private buf = "";

  /** Feed a decoded text chunk; returns the complete events it finished. */
  push(chunk: string): ChatEvent[] {
    this.buf += chunk.replace(/\r\n/g, "\n");
    const out: ChatEvent[] = [];
    let i: number;
    while ((i = this.buf.indexOf("\n\n")) !== -1) {
      const block = this.buf.slice(0, i);
      this.buf = this.buf.slice(i + 2);
      const ev = parseBlock(block);
      if (ev) out.push(ev);
    }
    return out;
  }

  /** Anything left when the stream closes (a final block without a blank line). */
  flush(): ChatEvent[] {
    const rest = this.buf.trim();
    this.buf = "";
    const ev = rest ? parseBlock(rest) : null;
    return ev ? [ev] : [];
  }
}

function parseBlock(block: string): ChatEvent | null {
  let name: string | null = null;
  const data: string[] = [];
  for (const line of block.split("\n")) {
    if (!line || line.startsWith(":")) continue; // comments = keep-alive pings
    const c = line.indexOf(":");
    const field = c === -1 ? line : line.slice(0, c);
    const value = c === -1 ? "" : line.slice(c + 1).replace(/^ /, "");
    if (field === "event") name = value;
    else if (field === "data") data.push(value);
  }
  if (!name || !KNOWN.has(name) || data.length === 0) return null;
  try {
    return { event: name, data: JSON.parse(data.join("\n")) } as ChatEvent;
  } catch {
    return null;
  }
}

/** Read a fetch Response body as SSE events. */
export async function* readSSE(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<ChatEvent> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  const parser = new SSEParser();
  try {
    while (true) {
      if (signal?.aborted) return;
      const { value, done } = await reader.read();
      if (done) break;
      for (const ev of parser.push(dec.decode(value, { stream: true }))) yield ev;
    }
    for (const ev of parser.push(dec.decode())) yield ev;
    for (const ev of parser.flush()) yield ev;
  } finally {
    reader.releaseLock();
  }
}
