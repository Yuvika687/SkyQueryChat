"use client";

// Ask page frame inside the new layout: a one-line page purpose, the conversation's context, and the chat
// history (saved in this browser only) that used to live in the sidebar.
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { History, MapPin, Plus, Trash2 } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useApp } from "@/components/shell/app-context";
import { cn } from "@/lib/utils";
import { AskScreen } from "./ask-screen";

export function AskPage() {
  const params = useSearchParams();
  const router = useRouter();
  const [q] = useState(() => params.get("q"));
  const [historyOpen, setHistoryOpen] = useState(false);
  const { openChat } = useApp();
  return (
    <div className="flex h-dvh flex-col pt-[72px] pb-[88px] md:pt-[80px] md:pb-0">
      <header className="mx-auto flex w-full max-w-[1120px] flex-wrap items-end gap-x-6 gap-y-2 px-4 pt-2 pb-3 sm:px-6">
        <div className="min-w-0">
          <h1 className="font-display text-[34px] leading-none sm:text-[40px]">Ask</h1>
          <p className="mt-1.5 text-[14px] text-foreground">Ask any question about air quality in the six cities.</p>
          <p className="mt-0.5 text-[12.5px] text-faint">Click any highlighted number to see where it came from.</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <AskContextLabel />
          <button type="button" onClick={() => openChat(null)} className="inline-flex h-9 items-center gap-1.5 rounded-full border border-line-strong px-3 text-[13px] text-subtle hover:border-teal/60 hover:text-foreground">
            <Plus className="size-4" aria-hidden />
            New chat
          </button>
          <button type="button" onClick={() => setHistoryOpen(true)} className="inline-flex h-9 items-center gap-1.5 rounded-full border border-line-strong px-3 text-[13px] text-subtle hover:border-teal/60 hover:text-foreground">
            <History className="size-4" aria-hidden />
            <span className="sr-only sm:not-sr-only">Recent chats</span>
          </button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1 border-t border-line">
        <AskScreen initialQuestion={q} onInitialSent={() => router.replace("/ask", { scroll: false })} />
      </div>
      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent side="right" className="w-[min(320px,100vw)] border-line bg-surface p-0">
          <SheetHeader className="border-b border-line px-4 py-3">
            <SheetTitle className="text-[17px] font-semibold">Recent chats</SheetTitle>
          </SheetHeader>
          <div className="px-2 py-2">
            <RecentChats onPick={() => setHistoryOpen(false)} />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function AskContextLabel() {
  const { askContext } = useApp();
  if (!askContext || !askContext.cities.length) return null;
  const cities = askContext.cities.length === 6 ? "All six cities" : askContext.cities.join(", ");
  return (
    <p className="hidden min-w-0 items-center gap-1.5 truncate text-[13px] text-subtle lg:flex" aria-label="Current conversation">
      <MapPin className="size-3.5 shrink-0" aria-hidden />
      <span className="truncate text-foreground">{cities}</span>
      {askContext.pollutant && <span className="shrink-0">· {askContext.pollutant}</span>}
      {askContext.period && <span className="truncate">· {askContext.period}</span>}
    </p>
  );
}

export function RecentChats({ onPick }: { onPick?: () => void }) {
  const { chats, activeChatId, openChat, removeChat } = useApp();
  if (!chats.length) return <p className="px-2 py-1 text-xs leading-4 text-subtle">Your questions are saved in this browser only.</p>;
  return (
    <ul className="flex flex-col gap-0.5">
      {chats.map((c) => (
        <li key={c.id} className="group flex items-center">
          <button
            type="button"
            onClick={() => { openChat(c.id); onPick?.(); }}
            aria-current={c.id === activeChatId ? "true" : undefined}
            className={cn("min-h-10 flex-1 truncate rounded-lg px-2 py-1.5 text-left text-[13px]",
              c.id === activeChatId ? "bg-raised text-foreground" : "text-subtle hover:bg-raised hover:text-foreground")}
            title={c.title}
          >
            {c.title}
          </button>
          <button
            type="button"
            onClick={() => removeChat(c.id)}
            className="grid size-9 shrink-0 place-items-center rounded-md text-subtle opacity-0 group-hover:opacity-100 hover:text-danger focus-visible:opacity-100"
            aria-label={`Delete chat: ${c.title}`}
          >
            <Trash2 className="size-4" aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  );
}
