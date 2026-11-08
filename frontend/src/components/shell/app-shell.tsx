"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  AlertTriangle, BarChart3, CircleCheck, Clock, History, Loader2, Map as MapIcon, MapPin, MessageSquare, Plus, Trash2, Wind,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CITIES } from "@/lib/categories";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useApp, type Pollutant } from "./app-context";

const NAV = [
  { href: "/explore", label: "Explore", icon: MapIcon, ready: false },
  { href: "/ask", label: "Ask", icon: MessageSquare, ready: true },
  { href: "/accuracy", label: "Accuracy", icon: BarChart3, ready: false },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const path = usePathname();
  const title = path?.startsWith("/demo") ? "Demo access" : "Ask";
  return (
    <div className="flex h-dvh overflow-hidden bg-background text-foreground">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-teal focus:px-3 focus:py-2 focus:text-background">
        Skip to content
      </a>
      <Sidebar onOpenHistory={() => setHistoryOpen(true)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar title={title} />
        <main id="main" className="flex min-h-0 flex-1 flex-col">
          {children}
        </main>
        <BottomNav onOpenHistory={() => setHistoryOpen(true)} />
      </div>
      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent side="left" className="w-[300px] border-line bg-surface p-0">
          <SheetHeader className="border-b border-line px-4 py-3">
            <SheetTitle className="text-[18px] leading-[26px] font-semibold">Recent chats</SheetTitle>
          </SheetHeader>
          <div className="px-2 pb-4">
            <RecentChats onPick={() => setHistoryOpen(false)} />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Logo({ compact }: { compact?: boolean }) {
  return (
    <div className="flex h-14 items-center gap-2 px-4">
      <span className="grid size-8 place-items-center rounded-lg bg-teal/15 text-teal" aria-hidden>
        <Wind className="size-5" />
      </span>
      {!compact && <span className="text-[15px] font-semibold tracking-tight">SkyQueryChat</span>}
      <span className="sr-only">SkyQueryChat</span>
    </div>
  );
}

function Sidebar({ onOpenHistory }: { onOpenHistory: () => void }) {
  const path = usePathname();
  const { openChat } = useApp();
  return (
    <aside
      aria-label="Main navigation"
      className="hidden shrink-0 flex-col border-r border-line bg-surface md:flex md:w-16 xl:w-60"
    >
      <div className="hidden xl:block"><Logo /></div>
      <div className="xl:hidden"><Logo compact /></div>
      <nav className="flex flex-col gap-1 px-2 pt-2">
        {NAV.map((n) => {
          const active = path?.startsWith(n.href);
          const inner = (
            <>
              <n.icon className="size-5 shrink-0" aria-hidden />
              <span className="hidden xl:inline">{n.label}</span>
              {!n.ready && <span className="ml-auto hidden rounded-md border border-line px-1.5 text-[11px] text-subtle xl:inline">Soon</span>}
            </>
          );
          const cls = cn(
            "flex h-10 items-center justify-center gap-3 rounded-lg px-3 text-sm font-medium xl:justify-start",
            active ? "bg-raised text-teal" : "text-subtle",
            n.ready ? "hover:bg-raised hover:text-foreground" : "cursor-not-allowed opacity-60",
          );
          return (
            <Tooltip key={n.href}>
              <TooltipTrigger
                render={
                  n.ready ? (
                    <Link href={n.href} aria-current={active ? "page" : undefined} className={cls} />
                  ) : (
                    <span role="link" aria-disabled="true" className={cls} />
                  )
                }
              >
                {inner}
                <span className="sr-only xl:hidden">{n.label}{n.ready ? "" : " (coming soon)"}</span>
              </TooltipTrigger>
              <TooltipContent side="right" className="xl:hidden">{n.label}{n.ready ? "" : " (coming soon)"}</TooltipContent>
            </Tooltip>
          );
        })}
      </nav>
      <div className="mt-4 px-2">
        <button
          type="button"
          onClick={() => openChat(null)}
          className="flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-line text-sm font-medium text-foreground hover:border-teal hover:text-teal xl:justify-start xl:px-3"
        >
          <Plus className="size-4" aria-hidden />
          <span className="hidden xl:inline">New chat</span>
          <span className="sr-only xl:hidden">New chat</span>
        </button>
      </div>
      <div className="mt-4 hidden min-h-0 flex-1 flex-col xl:flex">
        <h2 className="px-4 pb-2 text-xs font-medium tracking-wide text-subtle uppercase">Recent chats</h2>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
          <RecentChats />
        </div>
      </div>
      <div className="mt-2 flex justify-center xl:hidden">
        <button
          type="button"
          onClick={onOpenHistory}
          className="grid size-10 place-items-center rounded-lg text-subtle hover:bg-raised hover:text-foreground"
          aria-label="Recent chats"
        >
          <History className="size-5" aria-hidden />
        </button>
      </div>
    </aside>
  );
}

function RecentChats({ onPick }: { onPick?: () => void }) {
  const { chats, activeChatId, openChat, removeChat } = useApp();
  if (!chats.length) {
    return <p className="px-2 text-xs leading-4 text-subtle">Your questions are saved in this browser only.</p>;
  }
  return (
    <ul className="flex flex-col gap-0.5">
      {chats.map((c) => (
        <li key={c.id} className="group flex items-center">
          <button
            type="button"
            onClick={() => {
              openChat(c.id);
              onPick?.();
            }}
            aria-current={c.id === activeChatId ? "true" : undefined}
            className={cn(
              "min-h-9 flex-1 truncate rounded-lg px-2 py-1.5 text-left text-[13px]",
              c.id === activeChatId ? "bg-raised text-foreground" : "text-subtle hover:bg-raised hover:text-foreground",
            )}
            title={c.title}
          >
            {c.title}
          </button>
          <button
            type="button"
            onClick={() => removeChat(c.id)}
            className="grid size-8 shrink-0 place-items-center rounded-md text-subtle opacity-0 group-hover:opacity-100 hover:text-danger focus-visible:opacity-100"
            aria-label={`Delete chat: ${c.title}`}
          >
            <Trash2 className="size-4" aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  );
}

function TopBar({ title }: { title: string }) {
  const path = usePathname();
  // On Ask the question sets the city and pollutant, so selectors there would not change the answer.
  // Ask shows the conversation's context from the latest answer instead (read-only).
  const onAsk = !path || path.startsWith("/ask") || path.startsWith("/demo");
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-background px-4 sm:gap-3">
      <div className="md:hidden" aria-hidden>
        <span className="grid size-8 place-items-center rounded-lg bg-teal/15 text-teal"><Wind className="size-5" /></span>
      </div>
      <h1 className="text-[18px] leading-[26px] font-semibold sm:text-[24px] sm:leading-8">{title}</h1>
      <div className="ml-auto flex min-w-0 items-center gap-2">
        {onAsk ? <AskContextLabel /> : <Selectors />}
        <FreshnessPill />
      </div>
    </header>
  );
}

function AskContextLabel() {
  const { askContext } = useApp();
  if (!askContext || !askContext.cities.length) return null;
  const cities = askContext.cities.length === 6 ? "All six cities" : askContext.cities.join(", ");
  return (
    <p className="hidden min-w-0 items-center gap-1.5 truncate text-sm text-subtle sm:flex" aria-label="Current conversation">
      <MapPin className="size-3.5 shrink-0" aria-hidden />
      <span className="truncate text-foreground">{cities}</span>
      {askContext.pollutant && <span className="shrink-0">· {askContext.pollutant}</span>}
      {askContext.period && <span className="hidden truncate lg:inline">· {askContext.period}</span>}
    </p>
  );
}

function Selectors() {
  const { city, setCity, pollutant, setPollutant } = useApp();
  return (
    <>
        <label className="sr-only" htmlFor="city-select">City</label>
        <select
          id="city-select"
          value={city}
          onChange={(e) => setCity(e.target.value)}
          className="h-9 max-w-[124px] rounded-lg border border-line bg-surface px-2 text-sm text-foreground hover:border-subtle sm:max-w-none"
        >
          {CITIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <div role="group" aria-label="Pollutant" className="flex h-9 rounded-lg border border-line bg-surface p-0.5">
          {(["pm25", "pm10"] as Pollutant[]).map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={pollutant === p}
              onClick={() => setPollutant(p)}
              className={cn(
                "rounded-md px-2 text-xs font-medium sm:px-2.5",
                pollutant === p ? "bg-raised text-teal" : "text-subtle hover:text-foreground",
              )}
            >
              {p === "pm25" ? "PM2.5" : "PM10"}
            </button>
          ))}
        </div>
    </>
  );
}

export function FreshnessPill() {
  const { backend, health } = useApp();
  const end = health?.data_windows?.measured_end;
  let icon = <Loader2 className="size-3.5 animate-spin" aria-hidden />;
  let text = "Checking data";
  let tone = "text-subtle border-line";
  let tip = "Checking the analysis service.";
  if (backend === "waking") {
    icon = <Clock className="size-3.5" aria-hidden />;
    text = "Service starting";
    tone = "text-warn border-warn/40";
    tip = "Starting the analysis service. This can take up to a minute.";
  } else if (backend === "down") {
    icon = <AlertTriangle className="size-3.5" aria-hidden />;
    text = "Service unavailable";
    tone = "text-warn border-warn/40";
    tip = "The analysis service isn't responding. Answers can't load right now.";
  } else if (backend === "ready" && end) {
    icon = <CircleCheck className="size-3.5 text-teal" aria-hidden />;
    text = `Station data to ${fmtDate(end)}`;
    tip = `Station data updated to ${fmtDate(end)} (latest day in the published OpenAQ archive). Official CPCB AQI bulletins to ${fmtDate(health?.data_windows?.aqi_end)}.`;
  }
  return (
    <Tooltip>
      <TooltipTrigger
        render={<span tabIndex={0} className={cn("inline-flex h-9 w-9 shrink-0 items-center justify-center gap-1.5 rounded-full border text-xs font-medium sm:w-auto sm:px-3", tone)} />}
      >
        {icon}
        <span className="sr-only sm:not-sr-only">{text}</span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs">{tip}</TooltipContent>
    </Tooltip>
  );
}

function BottomNav({ onOpenHistory }: { onOpenHistory: () => void }) {
  const path = usePathname();
  return (
    <nav aria-label="Main navigation" className="flex h-16 shrink-0 items-stretch border-t border-line bg-surface md:hidden">
      {NAV.map((n) => {
        const active = path?.startsWith(n.href);
        const cls = cn(
          "flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium",
          active ? "text-teal" : "text-subtle",
          !n.ready && "opacity-50",
        );
        return n.ready ? (
          <Link key={n.href} href={n.href} aria-current={active ? "page" : undefined} className={cls}>
            <n.icon className="size-5" aria-hidden />
            {n.label}
          </Link>
        ) : (
          <span key={n.href} role="link" aria-disabled="true" className={cls}>
            <n.icon className="size-5" aria-hidden />
            {n.label}
            <span className="sr-only"> (coming soon)</span>
          </span>
        );
      })}
      <button type="button" onClick={onOpenHistory} className="flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-subtle">
        <History className="size-5" aria-hidden />
        History
      </button>
    </nav>
  );
}
