"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { getLatest, waitForBackend } from "@/lib/api";
import { CITIES } from "@/lib/categories";
import { deleteChat, getPref, loadChats, saveChat, setPref, type SavedChat } from "@/lib/recent";
import type { Health, Latest } from "@/lib/types";

export type BackendState = "checking" | "ready" | "waking" | "down";
export type Pollutant = "pm25" | "pm10";
export type LoadState = "idle" | "loading" | "ready" | "error";

/** What the current Ask conversation is about, from the latest answer's resolved_query (read-only). */
export interface AskContext {
  cities: string[];
  pollutant: string | null;
  period: string | null;
}

interface AppState {
  city: string;
  setCity: (c: string) => void;
  pollutant: Pollutant;
  setPollutant: (p: Pollutant) => void;
  backend: BackendState;
  health: Health | null;
  recheckBackend: () => Promise<Health | null>;
  chats: SavedChat[];
  activeChatId: string | null;
  openChat: (id: string | null) => void;
  storeChat: (c: SavedChat) => void;
  removeChat: (id: string) => void;
  newChatKey: number;
  askContext: AskContext | null;
  setAskContext: (c: AskContext | null) => void;
  /** Latest available city values (home page, nav chip). Loaded once the backend answers. */
  latest: Latest | null;
  latestState: LoadState;
  reloadLatest: () => Promise<void>;
}

const Ctx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp outside AppProvider");
  return v;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [city, setCityState] = useState("Delhi");
  const [pollutant, setPolState] = useState<Pollutant>("pm25");
  const [backend, setBackend] = useState<BackendState>("checking");
  const [health, setHealth] = useState<Health | null>(null);
  const [chats, setChats] = useState<SavedChat[]>([]);
  const [activeChatId, setActive] = useState<string | null>(null);
  const [newChatKey, setNewChatKey] = useState(0);
  const [askContext, setAskContext] = useState<AskContext | null>(null);
  const [latest, setLatest] = useState<Latest | null>(null);
  const [latestState, setLatestState] = useState<LoadState>("idle");

  useEffect(() => {
    // Browser-only state is read after mount so server and client render the same first frame.
    /* eslint-disable react-hooks/set-state-in-effect */
    setCityState(getPref("city", "Delhi", CITIES));
    setPolState(getPref<Pollutant>("pollutant", "pm25", ["pm25", "pm10"]));
    setChats(loadChats());
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  const recheckBackend = useCallback(async () => {
    await Promise.resolve(); // state updates happen after the first await, never synchronously in an effect
    setBackend((b) => (b === "ready" ? b : "checking"));
    try {
      const h = await waitForBackend({ onWaking: () => setBackend("waking") });
      setHealth(h);
      setBackend("ready");
      return h;
    } catch {
      setBackend("down");
      return null;
    }
  }, []);

  useEffect(() => {
    // Syncing with an external system (the backend's health endpoint); updates happen after network awaits.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void recheckBackend();
  }, [recheckBackend]);

  const reloadLatest = useCallback(async () => {
    await Promise.resolve();
    setLatestState("loading");
    try {
      setLatest(await getLatest());
      setLatestState("ready");
    } catch {
      setLatestState("error");
    }
  }, []);

  useEffect(() => {
    // Read-only data for the home page and the nav chip, fetched once the backend is awake.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (backend === "ready" && latestState === "idle") void reloadLatest();
  }, [backend, latestState, reloadLatest]);

  const value = useMemo<AppState>(
    () => ({
      city,
      setCity: (c) => {
        setCityState(c);
        setPref("city", c);
      },
      pollutant,
      setPollutant: (p) => {
        setPolState(p);
        setPref("pollutant", p);
      },
      backend,
      health,
      recheckBackend,
      chats,
      activeChatId,
      openChat: (id) => {
        setActive(id);
        if (id === null) setNewChatKey((k) => k + 1);
      },
      storeChat: (c) => setChats(saveChat(c)),
      removeChat: (id) => {
        setChats(deleteChat(id));
        if (id === activeChatId) {
          setActive(null);
          setNewChatKey((k) => k + 1);
        }
      },
      newChatKey,
      askContext,
      setAskContext,
      latest,
      latestState,
      reloadLatest,
    }),
    [city, pollutant, backend, health, recheckBackend, chats, activeChatId, newChatKey, askContext, latest, latestState, reloadLatest],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
