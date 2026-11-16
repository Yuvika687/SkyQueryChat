"use client";

// Home: "Find your city" across every city in CPCB's daily bulletin. Choosing one opens that city's panel on Explore
// (the all-cities official AQI layer). Older names are understood (Bangalore, Bombay, Gurgaon).
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { MapPin, Search } from "lucide-react";
import { useApp } from "@/components/shell/app-context";
import { CATEGORY_STYLE } from "@/lib/categories";
import { cpcbCategory, getCpcbCities, searchCpcb, type CpcbCity } from "@/lib/cpcb";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";

export function cityHref(city: string): string {
  return `/explore?layer=cpcb&cpcb=${encodeURIComponent(city)}`;
}

export function CityFinder({ className }: { className?: string }) {
  const router = useRouter();
  const { backend } = useApp();
  const [cities, setCities] = useState<CpcbCity[] | null>(null);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(0);
  useEffect(() => {
    if (backend !== "ready" || cities) return;
    getCpcbCities().then((d) => setCities(d.cities)).catch(() => setCities([]));
  }, [backend, cities]);
  const hits = cities ? searchCpcb(cities, q, 6) : [];
  const show = open && q.trim().length > 0;
  const date = cities?.reduce((a, c) => (c.date > a ? c.date : a), "");
  const go = (c: CpcbCity) => { setOpen(false); router.push(cityHref(c.city)); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setAt((a) => Math.min(a + 1, hits.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setAt((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter" && hits[at]) { e.preventDefault(); go(hits[at]); }
    else if (e.key === "Escape") setOpen(false);
  };
  return (
    <div className={cn("relative", className)}>
      <label htmlFor="city-finder" className="mb-2 block text-[13px] font-medium text-subtle">
        Find your city <span className="font-normal text-faint">· official AQI for {cities?.length || "300+"} cities</span>
      </label>
      <div className="flex h-11 items-center gap-2.5 rounded-xl bg-white/[0.05] px-3.5 focus-within:ring-1 focus-within:ring-teal">
        <Search className="size-4 shrink-0 text-faint" aria-hidden />
        <input id="city-finder" role="combobox" aria-expanded={show} aria-controls="city-finder-list" aria-autocomplete="list"
          aria-activedescendant={show && hits[at] ? `city-opt-${at}` : undefined}
          value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); setAt(0); }} onKeyDown={onKey}
          onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 120)}
          placeholder="e.g. Lucknow, Pune, Bangalore" autoComplete="off"
          className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-faint" />
      </div>
      {show && (
        <ul id="city-finder-list" role="listbox" aria-label="Cities"
          className="absolute inset-x-0 top-[calc(100%+6px)] z-30 rounded-xl border border-line-strong bg-[#0d1528] p-1 shadow-float">
          {!cities ? (
            <li className="px-3 py-2.5 text-[14px] text-subtle">Loading the bulletin cities…</li>
          ) : hits.length === 0 ? (
            <li className="px-3 py-2.5 text-[14px] text-subtle">“{q}” isn’t in CPCB’s daily bulletin. Try a nearby larger city.</li>
          ) : hits.map((c, k) => {
            const cat = cpcbCategory(c);
            return (
              <li key={c.city} id={`city-opt-${k}`} role="option" aria-selected={k === at}
                onMouseDown={(e) => { e.preventDefault(); go(c); }} onMouseEnter={() => setAt(k)}
                className={cn("flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-[14px]", k === at && "bg-white/[0.07]")}>
                <MapPin className="size-4 shrink-0 text-faint" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{c.city}</span>
                <span className="num font-semibold">{c.aqi}</span>
                <span className="inline-flex h-6 items-center rounded-md px-2 text-[12px] font-medium"
                  style={{ background: cat ? CATEGORY_STYLE[cat].bg : "#64748B", color: cat ? CATEGORY_STYLE[cat].fg : "#fff" }}>
                  {cat ? CATEGORY_STYLE[cat].label : c.category}
                </span>
              </li>
            );
          })}
          {date && hits.length > 0 && <li className="px-3 pt-1.5 pb-1 text-[12px] text-faint">Official AQI (CPCB 4 PM bulletin, {fmtDate(date)})</li>}
        </ul>
      )}
    </div>
  );
}
