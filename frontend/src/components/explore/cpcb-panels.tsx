"use client";

// The "All CPCB cities (official AQI)" layer: a searchable list of every bulletin city (cities without a confident map
// location are listed, marked "not on the map") and one city's panel with its latest bulletin and 30-day chart.
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { MapPinOff, MessageSquare, Search, X } from "lucide-react";
import { CategoryBadge } from "@/components/ds/data-display";
import { askHref } from "@/components/ds/ask-box";
import { CATEGORY_STYLE } from "@/lib/categories";
import { cpcbCategory, cpcbLabel, getCpcbCity, searchCpcb, type CpcbCity, type CpcbCityDetail } from "@/lib/cpcb";
import { fmtDate } from "@/lib/format";
import { gapRuns } from "@/lib/explore";
import { cn } from "@/lib/utils";

/** Two-way switch between the six cities' stations and all CPCB bulletin cities. */
export function LayerSwitch({ value, onChange }: { value: "stations" | "cpcb"; onChange: (v: "stations" | "cpcb") => void }) {
  const opts = [["stations", "Six cities (stations)"], ["cpcb", "All CPCB cities"]] as const;
  return (
    <div role="radiogroup" aria-label="Map layer" className="grid h-9 grid-cols-2 rounded-full bg-white/[0.05] p-0.5">
      {opts.map(([k, label]) => (
        <button key={k} type="button" role="radio" aria-checked={value === k} onClick={() => onChange(k)}
          className={cn("rounded-full px-3 text-[13px] font-medium whitespace-nowrap",
            value === k ? "bg-teal text-teal-ink" : "text-subtle hover:text-foreground")}>
          {label}
        </button>
      ))}
    </div>
  );
}

export function CpcbList({ cities, selected, onPick }: { cities: CpcbCity[]; selected: string | null; onPick: (c: string) => void }) {
  const [q, setQ] = useState("");
  const sorted = useMemo(() => [...cities].sort((a, b) => b.aqi - a.aqi), [cities]);
  const shown = q.trim() ? searchCpcb(cities, q, 40) : sorted;
  const date = cities.reduce((a, c) => (c.date > a ? c.date : a), "");
  const off = cities.filter((c) => c.lat == null).length;
  return (
    <div>
      <div className="mb-3 flex h-10 items-center gap-2 rounded-xl bg-white/[0.05] px-3 focus-within:ring-1 focus-within:ring-teal">
        <Search className="size-4 shrink-0 text-faint" aria-hidden />
        <label htmlFor="cpcb-search" className="sr-only">Find a city</label>
        <input id="cpcb-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Find one of ${cities.length} cities`}
          autoComplete="off" className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-faint" />
      </div>
      <p className="mb-2 px-1 text-[12.5px] text-faint">
        {cpcbLabel(date)}. Highest first.{off ? ` ${off} cities have no confident map location and are listed only.` : ""}
      </p>
      {shown.length === 0 && <p className="px-1 py-3 text-[14px] text-subtle">No bulletin city matches “{q}”.</p>}
      <ol className="flex flex-col" aria-label="CPCB bulletin cities">
        {shown.map((c) => {
          const cat = cpcbCategory(c);
          return (
            <li key={c.city}>
              <button type="button" onClick={() => onPick(c.city)} aria-pressed={selected === c.city}
                className={cn("flex min-h-11 w-full items-center gap-3 rounded-xl px-2.5 py-1.5 text-left hover:bg-white/[0.04]",
                  selected === c.city && "bg-teal/10")}>
                <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: cat ? CATEGORY_STYLE[cat].bg : "#64748B" }} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium">
                    {c.city}{c.is_metro && <span className="ml-1.5 text-[11.5px] font-normal text-teal">station data</span>}
                  </span>
                  {c.lat == null && (
                    <span className="flex items-center gap-1 text-[11.5px] text-faint"><MapPinOff className="size-3" aria-hidden />not on the map</span>
                  )}
                </span>
                <span className="num text-[15px] font-semibold">{c.aqi}</span>
                <span className="w-[88px] text-right text-[12px] text-subtle">{cat ? CATEGORY_STYLE[cat].label : c.category}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function CpcbCityPanel({ name, onClose }: { name: string; onClose: () => void }) {
  const [d, setD] = useState<CpcbCityDetail | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let live = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setD(null); setErr(false);
    getCpcbCity(name).then((x) => live && setD(x)).catch(() => live && setErr(true));
    return () => { live = false; };
  }, [name]);
  const head = (
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <h2 className="text-[22px] leading-7 font-semibold">{d?.city ?? name}</h2>
        <p className="mt-0.5 text-[13px] text-faint">{d ? cpcbLabel(d.latest.date) : "Official AQI (CPCB 4 PM bulletin)"}</p>
      </div>
      <button type="button" onClick={onClose} aria-label="Close city" className="grid size-9 shrink-0 place-items-center rounded-full bg-white/[0.05] text-subtle hover:text-foreground">
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
  if (err) return <div className="flex flex-col gap-4">{head}<p className="text-[14px] text-subtle">This city’s bulletin data could not load. Try again in a moment.</p></div>;
  if (!d) return <div className="flex flex-col gap-4">{head}<div className="h-40 animate-pulse rounded-2xl bg-white/[0.04]" /></div>;
  const cat = cpcbCategory(d.latest);
  const ch = d.change_from_previous;
  const q = d.is_metro ? `How has ${d.city}'s air been over the last 30 days?` : `AQI in ${d.city}`;
  return (
    <div className="flex flex-col gap-5">
      {head}
      <div className="rounded-2xl bg-white/[0.04] p-4">
        <p className="flex items-baseline gap-2">
          <span className="num text-[40px] leading-none font-medium">{d.latest.aqi}</span>
          <span className="text-[14px] text-subtle">AQI</span>
          <CategoryBadge category={cat} className="ml-auto" label="CPCB AQI category" />
        </p>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[14px]">
          <dt className="text-faint">Main pollutant</dt><dd>{d.latest.main_pollutant ?? "Not stated"}</dd>
          <dt className="text-faint">Change</dt>
          <dd>{ch == null ? "No previous bulletin" : <><span className="num font-semibold">{ch > 0 ? `+${ch}` : ch}</span> from {fmtDate(d.previous_date)}</>}</dd>
          <dt className="text-faint">Stations</dt><dd className="num">{d.latest.stations_reporting ?? "Not stated"} reporting</dd>
        </dl>
      </div>
      <div>
        <p className="mb-1.5 text-[13px] text-faint">Last 30 days · {d.n_days_with_value} days with a bulletin value</p>
        <AqiChart series={d.series} />
      </div>
      {d.metro_note && <p className="text-[13px] leading-5 text-subtle">{d.metro_note}</p>}
      <div className="flex flex-col gap-2">
        <Link href={askHref(q)} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-teal px-4 text-[14px] font-semibold text-teal-ink hover:bg-teal-hover">
          <MessageSquare className="size-4" aria-hidden />Ask about this city
        </Link>
        {d.is_metro && (
          <Link href={`/city/${d.city.toLowerCase()}`} className="text-center text-[13px] font-medium text-teal hover:underline">Open the full {d.city} page</Link>
        )}
      </div>
    </div>
  );
}

/** 30 days of official AQI: dots coloured by category, straight lines between consecutive days, gaps shaded. */
function AqiChart({ series }: { series: CpcbCityDetail["series"] }) {
  const W = 320, H = 132, L = 32, R = 8, T = 10, B = 22;
  const n = series.length;
  const vals = series.map((s) => s.aqi);
  const have = vals.filter((v): v is number => v != null);
  if (!have.length) return <p className="text-[13px] text-faint">No bulletin values in these 30 days.</p>;
  const top = Math.max(100, Math.ceil(Math.max(...have) / 100) * 100);
  const X = (i: number) => L + (i * (W - L - R)) / Math.max(1, n - 1);
  const Y = (v: number) => T + (1 - v / top) * (H - T - B);
  const step = (W - L - R) / Math.max(1, n - 1);
  const segs: string[] = [];
  let p = "";
  vals.forEach((v, i) => { if (v == null) { if (p) segs.push(p); p = ""; return; } p += `${p ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`; });
  if (p) segs.push(p);
  const label = `Official AQI, ${fmtDate(series[0].date)} to ${fmtDate(series[n - 1].date)}: ` +
    series.map((s) => `${fmtDate(s.date)} ${s.aqi ?? "no bulletin"}`).join("; ");
  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={label}>
        {gapRuns(vals).map(([a, b]) => (
          <rect key={a} x={X(a) - step / 2} y={T} width={(b - a + 1) * step} height={H - T - B} fill="rgb(148 170 214 / 0.10)" />
        ))}
        {[0, top / 2, top].map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} stroke="rgb(148 170 214 / 0.12)" />
            <text x={L - 5} y={Y(v) + 3} textAnchor="end" fontSize="9.5" fill="#8391AE">{v}</text>
          </g>
        ))}
        {segs.map((d, i) => <path key={i} d={d} fill="none" stroke="#9FB3D9" strokeWidth="1.4" strokeLinejoin="round" />)}
        {vals.map((v, i) => {
          if (v == null) return null;
          const c = cpcbCategory({ category: series[i].category, aqi: v });
          return <circle key={i} cx={X(i)} cy={Y(v)} r={2.6} fill={c ? CATEGORY_STYLE[c].bg : "#64748B"} stroke="rgb(6 10 20 / 0.9)" />;
        })}
        {[0, Math.round((n - 1) / 2), n - 1].map((i) => (
          <text key={i} x={X(i)} y={H - 6} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"} fontSize="10" fill="#8391AE">
            {fmtDate(series[i].date).replace(/ \d{4}$/, "")}
          </text>
        ))}
      </svg>
      <figcaption className="mt-1 text-[11.5px] text-faint">Shaded: no bulletin value that day (never filled in).</figcaption>
    </figure>
  );
}
