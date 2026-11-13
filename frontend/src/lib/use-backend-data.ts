"use client";

// Fetch read-only data once the backend is awake. While the free server wakes, the page shows the wake-up state;
// a failed load shows an error with Try again.
import { useCallback, useEffect, useState } from "react";
import { useApp } from "@/components/shell/app-context";

export type DataState<T> =
  | { kind: "loading" } | { kind: "waking" } | { kind: "error"; retry: () => void } | { kind: "ready"; data: T };

export function useBackendData<T>(load: (signal: AbortSignal) => Promise<T>, key: string): DataState<T> {
  const { backend, recheckBackend } = useApp();
  const [result, setResult] = useState<{ key: string; data?: T; failed?: boolean } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    setResult(null);
    if (backend === "down") void recheckBackend();
    setAttempt((a) => a + 1);
  }, [backend, recheckBackend]);

  useEffect(() => {
    if (backend !== "ready") return;
    const ctl = new AbortController();
    load(ctl.signal).then(
      (data) => setResult({ key, data }),
      () => { if (!ctl.signal.aborted) setResult({ key, failed: true }); },
    );
    return () => ctl.abort();
    // `load` is recreated each render; the key says when the request really changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backend, key, attempt]);

  if (result?.key === key && result.data !== undefined) return { kind: "ready", data: result.data };
  if (backend === "down" || (result?.key === key && result.failed)) return { kind: "error", retry };
  if (backend === "waking") return { kind: "waking" };
  return { kind: "loading" };
}
