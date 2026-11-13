"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CloudOff, Loader2 } from "lucide-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useApp } from "@/components/shell/app-context";
import { useChat } from "@/hooks/use-chat";
import type { Turn } from "@/lib/chat-state";
import { periodLabel } from "@/lib/evidence";
import { pollutantLabel } from "@/lib/format";
import { AgentTimeline, announcement } from "./agent-timeline";
import { Callout } from "./answer-parts";
import { Composer, type ComposerHandle } from "./composer";
import { EmptyState } from "./empty-state";
import { TurnView } from "./turn-view";

function newId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now());
}

/** initialQuestion: a question passed in the address (/ask?q=...), e.g. from the Home page. It starts a new chat
 * and is sent once; onInitialSent lets the page remove it from the address. */
export function AskScreen({ initialQuestion, onInitialSent }: { initialQuestion?: string | null; onInitialSent?: () => void } = {}) {
  const app = useApp();
  const chatId = useRef<string | null>(null);
  const composer = useRef<ComposerHandle>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(false);
  const { storeChat, openChat } = app;

  const onTurnFinished = useCallback(
    (turns: Turn[], sid: string | null) => {
      const done = turns.filter((t) => t.phase !== "streaming" && t.phase !== "waking");
      if (!done.length) return;
      if (!chatId.current) chatId.current = newId();
      storeChat({ id: chatId.current, title: done[0].question, updatedAt: Date.now(), sessionId: sid ?? undefined, turns: done });
      openChat(chatId.current);
    },
    [storeChat, openChat],
  );

  const chat = useChat({ ensureBackend: app.recheckBackend, backendReady: app.backend === "ready", onTurnFinished });
  const { load } = chat;

  // A question from the address starts a new chat and is sent once. sentFor remembers the chat state it was
  // sent in, so a repeated effect run (React development mode) does not reset that chat.
  const pendingQ = useRef<string | null>(initialQuestion?.trim() || null);
  const sentFor = useRef<string | null>(null);

  // Open a saved chat, or start a new one.
  useEffect(() => {
    const key = `${app.activeChatId}|${app.newChatKey}`;
    if (sentFor.current === key) return;
    if (pendingQ.current) {
      const q = pendingQ.current;
      pendingQ.current = null;
      sentFor.current = key;
      chatId.current = null;
      load([], null);
      setSelected(null);
      void chat.send(q);
      onInitialSent?.();
      return;
    }
    if (app.activeChatId && app.activeChatId === chatId.current) return;
    const saved = app.activeChatId ? app.chats.find((c) => c.id === app.activeChatId) : null;
    chatId.current = saved?.id ?? null;
    load(saved?.turns ?? [], saved?.sessionId ?? null);
    setSelected(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.activeChatId, app.newChatKey]);

  const latest = chat.turns[chat.turns.length - 1] ?? null;
  const timelineTurn = chat.turns.find((t) => t.id === selected) ?? latest;
  const running = !!latest && (latest.phase === "streaming" || latest.phase === "waking");

  // The top bar follows what the conversation is about (from the latest answer's resolved_query).
  const { setAskContext } = app;
  const rq = [...chat.turns].reverse().find((t) => t.answer?.resolved_query)?.answer?.resolved_query ?? null;
  const ctxKey = rq ? `${rq.cities.join(",")}|${rq.pollutant}|${rq.start_date}|${rq.end_date}` : "";
  useEffect(() => {
    setAskContext(rq ? { cities: rq.cities.length ? rq.cities : rq.city ? [rq.city] : [], pollutant: rq.pollutant ? pollutantLabel(rq.pollutant) : null,
      period: rq.start_date ? periodLabel(rq.start_date, rq.end_date, rq.assumptions) : null } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctxKey, setAskContext]);
  useEffect(() => () => setAskContext(null), [setAskContext]);

  // While the agent works, keep the newest step in view. When the answer arrives, bring the start of that
  // turn (question and main insight) to the top instead of jumping to the bottom of the chart.
  const lastKey = latest ? `${latest.id}:${latest.steps.length}:${latest.answer ? 1 : 0}:${latest.phase}` : "";
  useEffect(() => {
    const el = scroller.current;
    if (!el || !latest) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const behavior = reduce ? "auto" : "smooth";
    const art = el.querySelector<HTMLElement>(`[data-turn="${latest.id}"]`);
    if (latest.answer && art) el.scrollTo({ top: Math.max(0, art.offsetTop - 16), behavior });
    else el.scrollTo({ top: el.scrollHeight, behavior });
  }, [lastKey, latest]);

  const ask = (q: string) => {
    setSelected(null);
    void chat.send(q);
  };
  const retry = (t: Turn) => {
    setSelected(null);
    void chat.send(t.question, { replaceId: t.id });
  };
  const showSteps = (t: Turn) => {
    setSelected(t.id);
    setDrawer(true);
  };
  const placeholder = "Ask about air quality in the six cities";

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <div ref={scroller} className="relative min-h-0 flex-1 overflow-y-auto">
          <BackendBanner />
          {chat.turns.length === 0 ? (
            <EmptyState onAsk={ask} disabled={chat.busy} />
          ) : (
            <div className="mx-auto flex w-full max-w-[760px] flex-col gap-10 px-4 py-6">
              {chat.turns.map((t, i) => (
                <TurnView
                  key={t.id}
                  turn={t}
                  health={app.health}
                  isLatest={i === chat.turns.length - 1}
                  busy={chat.busy}
                  onAsk={ask}
                  onRetry={retry}
                  onShowSteps={showSteps}
                  showStepsButton
                />
              ))}
            </div>
          )}
          <Attribution />
        </div>
        {/* Screen readers hear each new step as it starts or ends, and when the answer is ready. */}
        <p className="sr-only" aria-live="polite">{announcement(latest)}</p>
        <Composer ref={composer} busy={chat.busy} onSend={ask} onStop={chat.stop} placeholder={placeholder} />
      </div>
      {/* The steps panel is there while the agent works; once the answer is ready it gives the space back
          and each answer carries a compact, expandable summary instead. */}
      {running && (
        <aside aria-label="Agent steps" className="hidden w-80 shrink-0 overflow-y-auto border-l border-line bg-surface xl:block">
          <AgentTimeline turn={latest} />
        </aside>
      )}
      <Sheet open={drawer} onOpenChange={setDrawer}>
        <SheetContent side="right" className="w-[min(360px,100vw)] overflow-y-auto border-line bg-surface p-0 xl:hidden">
          <SheetTitle className="sr-only">Agent steps</SheetTitle>
          <AgentTimeline turn={timelineTurn} inDrawer />
        </SheetContent>
      </Sheet>
    </div>
  );
}

function BackendBanner() {
  const { backend, recheckBackend } = useApp();
  if (backend === "waking") {
    return (
      <div className="mx-auto w-full max-w-[760px] px-4 pt-4" role="status">
        <Callout tone="info" icon={Loader2} title="Starting the analysis service. This can take a minute or two.">
          You can type your question now; it will be sent when the service is ready.
        </Callout>
      </div>
    );
  }
  if (backend === "down") {
    return (
      <div className="mx-auto w-full max-w-[760px] px-4 pt-4">
        <Callout tone="error" icon={CloudOff} title="The analysis service isn't responding">
          <span className="flex flex-wrap items-center gap-3">
            Answers can&apos;t load right now.
            <button type="button" onClick={() => void recheckBackend()} className="h-8 rounded-lg border border-line px-2.5 text-xs font-medium text-foreground hover:border-teal hover:text-teal">
              Try again
            </button>
          </span>
        </Callout>
      </div>
    );
  }
  return null;
}

function Attribution() {
  return (
    <footer className="mx-auto w-full max-w-[760px] px-4 pt-2 pb-6 text-[11px] leading-4 text-subtle">
      Station data: CPCB via <a className="underline hover:text-teal" href="https://openaq.org" target="_blank" rel="noreferrer">OpenAQ</a>. Official AQI: CPCB daily bulletins, parsed by UrbanEmissions.info. Weather data by{" "}
      <a className="underline hover:text-teal" href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo.com</a> (CC BY 4.0), reanalysis from the Copernicus Climate Change Service.
    </footer>
  );
}
