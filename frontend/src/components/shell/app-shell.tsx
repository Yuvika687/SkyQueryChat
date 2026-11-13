"use client";

// App frame: a slim floating top bar on desktop, a bottom tab bar on phones, and the "Data & accuracy" panel.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";
import { BarChart3, Compass, GitCompareArrows, Home, MessageSquare, Search } from "lucide-react";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useApp } from "./app-context";
import { DataPanel } from "./data-panel";
import { isMac, useQuickAsk } from "./quick-ask";

export const NAV = [
  { href: "/", label: "Home", icon: Home },
  { href: "/explore", label: "Explore", icon: Compass },
  { href: "/ask", label: "Ask", icon: MessageSquare },
  { href: "/compare", label: "Compare", icon: GitCompareArrows },
];

function isActive(path: string | null, href: string) {
  if (!path) return false;
  if (href === "/") return path === "/";
  return path === href || path.startsWith(href + "/");
}

const DataPanelCtx = createContext<() => void>(() => {});
/** Opens the "Data & accuracy" panel (used by the nav button and page footers). */
export const useOpenDataPanel = () => useContext(DataPanelCtx);

export function AppShell({ children }: { children: React.ReactNode }) {
  const [dataOpen, setDataOpen] = useState(false);
  return (
    <DataPanelCtx.Provider value={() => setDataOpen(true)}>
    <div className="min-h-dvh bg-background text-foreground">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[60] focus:rounded-lg focus:bg-teal focus:px-3 focus:py-2 focus:text-teal-ink">
        Skip to content
      </a>
      <TopBar onData={() => setDataOpen(true)} />
      <main id="main">{children}</main>
      <TabBar />
      <DataPanel open={dataOpen} onOpenChange={setDataOpen} />
    </div>
    </DataPanelCtx.Provider>
  );
}

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5 rounded-full text-[15px] font-semibold tracking-tight">
      <span aria-hidden className="size-[18px] rounded-full shadow-glow"
        style={{ background: "radial-gradient(circle at 35% 35%, #8FF5E6, #2DD4BF 45%, #0E5E55 100%)" }} />
      SkyQueryChat
    </Link>
  );
}

/** "Latest available: 11 Nov 2026" from the data itself; never called live. */
export function LatestChip({ className }: { className?: string }) {
  const { latest, health } = useApp();
  const date = latest?.date ?? health?.data_windows?.measured_end;
  if (!date) return null;
  return (
    <span className={cn("inline-flex h-8 items-center gap-2 rounded-full border border-line-strong bg-background/50 px-3 text-xs text-subtle", className)}>
      <span aria-hidden className="size-1.5 rounded-full bg-teal" />
      Latest available: <strong className="font-semibold text-foreground">{fmtDate(date)}</strong>
    </span>
  );
}

function TopBar({ onData }: { onData: () => void }) {
  const path = usePathname();
  return (
    <header className="fixed inset-x-0 top-3 z-40 flex justify-center px-3 sm:top-4">
      {/* a band behind the pill fades to the page colour, so scrolled content never shows around or through it */}
      <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 -z-10 h-[76px] bg-gradient-to-b from-background via-background/85 to-transparent" />
      <nav
        aria-label="Main"
        className="flex h-12 w-full max-w-[1120px] items-center gap-3 rounded-full border border-line bg-[#0a1120]/[0.93] pr-2 pl-4 shadow-[0_8px_24px_-12px_rgb(0_0_0/0.6)] backdrop-blur-xl backdrop-saturate-150"
      >
        <Logo />
        <ul className="mx-auto hidden items-center gap-1 md:flex">
          {NAV.map((n) => {
            const active = isActive(path, n.href);
            return (
              <li key={n.href}>
                <Link
                  href={n.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "inline-flex h-8 items-center rounded-full px-3.5 text-sm transition-colors",
                    active ? "bg-white/[0.08] text-foreground" : "text-subtle hover:text-foreground",
                  )}
                >
                  {n.label}
                </Link>
              </li>
            );
          })}
        </ul>
        <QuickAskHint />
        <LatestChip className="ml-auto hidden lg:inline-flex md:ml-0" />
        <button
          type="button"
          onClick={onData}
          className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-full border border-line-strong px-3 text-[13px] text-subtle transition-colors hover:border-teal/60 hover:text-foreground md:ml-0"
        >
          <BarChart3 className="size-3.5" aria-hidden />
          Data &amp; accuracy
        </button>
      </nav>
    </header>
  );
}

function TabBar() {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="fixed inset-x-3 bottom-3 z-40 md:hidden">
      <ul className="grid h-16 grid-cols-4 rounded-2xl border border-line bg-[#0a1120]/[0.95] p-1.5 backdrop-blur-xl">
        {NAV.map((n) => {
          const active = isActive(path, n.href);
          return (
            <li key={n.href}>
              <Link
                href={n.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-full flex-col items-center justify-center gap-0.5 rounded-xl text-[11px] font-medium",
                  active ? "bg-teal/10 text-teal" : "text-subtle",
                )}
              >
                <n.icon className="size-5" aria-hidden />
                {n.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Desktop only: a subtle hint for the quick-ask shortcut (also clickable). */
function QuickAskHint() {
  const open = useQuickAsk();
  const [mac, setMac] = useState(true);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMac(isMac()), []);
  return (
    <button type="button" onClick={open} aria-label={`Quick ask (${mac ? "Command" : "Control"} K)`}
      className="hidden h-8 items-center gap-1.5 rounded-full px-2.5 text-[12px] text-faint transition-colors hover:text-foreground xl:inline-flex">
      <Search className="size-3.5" aria-hidden />
      <kbd className="rounded-md border border-line-strong bg-white/[0.03] px-1.5 py-px font-sans text-[11px] text-subtle">{mac ? "⌘" : "Ctrl"} K</kbd>
    </button>
  );
}
