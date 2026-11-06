"use client";

import { useCallback, useRef, useState } from "react";
import { streamChat } from "@/lib/api";
import { applyEvent, newTurn, type Turn } from "@/lib/chat-state";
import type { Health } from "@/lib/types";

interface Options {
  /** Make sure the backend is awake; resolves null if it can't be reached. */
  ensureBackend: () => Promise<Health | null>;
  backendReady: boolean;
  onTurnFinished?: (turns: Turn[], sessionId: string | null) => void;
}

export function useChat({ ensureBackend, backendReady, onTurnFinished }: Options) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ctl = useRef<AbortController | null>(null);
  const turnsRef = useRef<Turn[]>([]);
  const sessionRef = useRef<string | null>(null);

  // turnsRef is the source of truth (updated synchronously) so the finished-turn callback always sees the
  // latest state; React state mirrors it for rendering.
  const commit = useCallback((next: Turn[]) => {
    turnsRef.current = next;
    setTurns(next);
  }, []);

  const update = useCallback(
    (id: string, fn: (t: Turn) => Turn) => commit(turnsRef.current.map((t) => (t.id === id ? fn(t) : t))),
    [commit],
  );

  const load = useCallback((saved: Turn[], sid: string | null) => {
    ctl.current?.abort();
    sessionRef.current = sid;
    commit(saved);
    setSessionId(sid);
    setBusy(false);
  }, [commit]);

  const send = useCallback(
    async (question: string, opts: { replaceId?: string } = {}) => {
      const q = question.trim();
      if (!q || ctl.current) return;
      const turn = newTurn(q);
      const base = opts.replaceId ? turnsRef.current.filter((t) => t.id !== opts.replaceId) : turnsRef.current;
      commit([...base, { ...turn, phase: backendReady ? "streaming" : "waking" } as Turn]);
      setBusy(true);
      const controller = new AbortController();
      ctl.current = controller;
      try {
        if (!backendReady) {
          const h = await ensureBackend();
          if (controller.signal.aborted) return;
          if (!h) {
            update(turn.id, (t) => ({
              ...t,
              phase: "error",
              error: { code: "backend_waking", message: "The analysis service didn't start in time. Please try again." },
            }));
            return;
          }
          update(turn.id, (t) => ({ ...t, phase: "streaming" }));
        }
        for await (const ev of streamChat(q, sessionRef.current, controller.signal)) {
          if (ev.event === "meta" && ev.data.session_id) {
            sessionRef.current = ev.data.session_id;
            setSessionId(ev.data.session_id);
          }
          update(turn.id, (t) => applyEvent(t, ev));
        }
        if (controller.signal.aborted) return;
        update(turn.id, (t) =>
          t.phase === "streaming"
            ? { ...t, phase: "error", error: { code: "network", message: "The connection dropped before the answer finished. Please try again." } }
            : t,
        );
      } finally {
        if (controller.signal.aborted) update(turn.id, (t) => (t.phase === "streaming" || t.phase === "waking" ? { ...t, phase: "stopped" } : t));
        ctl.current = null;
        setBusy(false);
        onTurnFinished?.(turnsRef.current, sessionRef.current);
      }
    },
    [backendReady, commit, ensureBackend, onTurnFinished, update],
  );

  const stop = useCallback(() => ctl.current?.abort(), []);

  return { turns, sessionId, busy, send, stop, load };
}
