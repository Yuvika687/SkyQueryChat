"use client";

// Ask page frame inside the new layout: a one-line page purpose, the conversation's context, and the chat
// history (saved in this browser only) that used to live in the sidebar.
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { History, Plus, Trash2 } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { fmtDate } from "@/lib/format";
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
      {/* no title row: the page name is for screen readers; New chat and Recent chats sit on the content's line */}
      <h1 className="sr-only">Ask</h1>
      <div className="flex min-h-0 flex-1">
        <AskScreen initialQuestion={q} onInitialSent={() => router.replace("/ask", { scroll: false })}
          tools={(
            <>
              <LatestDate />
              <IconButton label="New chat" onClick={() => openChat(null)}><Plus className="size-4" aria-hidden /></IconButton>
              <IconButton label="Recent chats" onClick={() => setHistoryOpen(true)}><History className="size-4" aria-hidden /></IconButton>
            </>
          )} />
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

function LatestDate() {
  const { health } = useApp();
  const end = health?.data_windows?.measured_end;
  if (!end) return null;
  return (
    // wide screens show the same date in the navigation bar, so the chip is for narrower screens only
    <span className="mr-1 inline-flex h-7 items-center gap-1.5 rounded-full bg-white/[0.04] px-2.5 text-[12.5px] text-subtle lg:hidden">
      <span className="size-1.5 rounded-full bg-teal" aria-hidden />Data to {fmtDate(end)}
    </span>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<button type="button" onClick={onClick} aria-label={label}
        className="grid size-8 place-items-center rounded-full text-subtle hover:bg-white/[0.06] hover:text-foreground" />}>
        {children}
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
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
