"use client";

// Home hero map: an animated SVG drawing of the official boundary of India (Survey of India via DataMeet, CC0).
// The outline draws itself, a faint grid and a slow light sweep sit inside India, and every city in CPCB's daily
// bulletin lights up as a small dot in its official AQI category colour (GeoNames positions, CC BY 4.0; only
// confident matches). The six analysed cities are React buttons over the drawing, with their PM2.5 labels.
// No values are drawn between cities and nothing is interpolated: each dot is one city's own bulletin value.
// The drawing is plain SVG (no WebGL, no tiles), so it is light and identical on every device.
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CATEGORY_STYLE } from "@/lib/categories";
import { cpcbCategory, type CpcbCity } from "@/lib/cpcb";
import { fmtDate } from "@/lib/format";
import type { LatestCity } from "@/lib/types";
import { cn } from "@/lib/utils";
import { CategoryBadge, categoryOf } from "@/components/ds/data-display";
import { OfficialAqiChip, officialAqiText } from "@/components/ds/official-aqi";
import { Term } from "@/components/ds/term";
import { INDIA_BOUNDS, loadBoundary, type IndiaGeo } from "@/lib/map-base";

const BOUNDS = INDIA_BOUNDS;

type Side = "left" | "right" | "top";
/** Label sides chosen so labels never overlap: Bengaluru and Chennai sit on opposite sides. */
const SIDE_DESKTOP: Record<string, Side> = { Mumbai: "left", Bengaluru: "left" };
const SIDE_PHONE: Record<string, Side> = { Mumbai: "top", Bengaluru: "left" };

type Project = (lon: number, lat: number) => [number, number];

/** Web Mercator fitted into a w x h box with padding (same projection as the map tiles use). */
function fit(w: number, h: number): Project {
  const pl = w < 500 ? { top: 44, bottom: 30, left: 14, right: 14 } : { top: 56, bottom: 34, left: 40, right: 40 };
  const merc = (lon: number, lat: number): [number, number] => [(lon * Math.PI) / 180, Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))];
  const a = merc(...BOUNDS[0]), b = merc(...BOUNDS[1]);
  const s = Math.min((w - pl.left - pl.right) / (b[0] - a[0]), (h - pl.top - pl.bottom) / (b[1] - a[1]));
  const ox = pl.left + (w - pl.left - pl.right - s * (b[0] - a[0])) / 2, oy = pl.top + (h - pl.top - pl.bottom - s * (b[1] - a[1])) / 2;
  return (lon, lat) => { const [x, y] = merc(lon, lat); return [ox + (x - a[0]) * s, h - (oy + (y - a[1]) * s)]; };
}

export function IndiaMap({ cities, date, others = [], className }: {
  cities: LatestCity[]; date: string; className?: string;
  /** every bulletin city with a confident position (official AQI), drawn as small dots */
  others?: CpcbCity[];
}) {
  const router = useRouter();
  const wrap = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<[number, number] | null>(null);
  const [geo, setGeo] = useState<IndiaGeo | null>(null);
  const [failed, setFailed] = useState(false);
  const [phone, setPhone] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [cardAt, setCardAt] = useState<[number, number]>([16, 16]);
  const [hot, setHot] = useState<CpcbCity | null>(null);

  useEffect(() => {
    let live = true;
    loadBoundary().then((g) => { if (live) setGeo(g); }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize([el.clientWidth, el.clientHeight]));
    ro.observe(el);
    setSize([el.clientWidth, el.clientHeight]);
    const mq = window.matchMedia("(max-width: 767px)");
    const on = () => setPhone(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => { ro.disconnect(); mq.removeEventListener("change", on); };
  }, []);

  const project = useMemo(() => (size && size[0] > 0 ? fit(size[0], size[1]) : null), [size]);
  const pos = useMemo(() => (project ? Object.fromEntries(cities.map((c) => [c.city, project(c.lon, c.lat)])) : {}) as Record<string, [number, number]>,
    [project, cities]);

  const outline = useMemo(() => {
    if (!geo || !project) return "";
    return geo.features[0].geometry.coordinates
      .map((poly) => poly.map((r) => "M" + r.map(([x, y]) => project(x, y).map((v) => v.toFixed(1)).join(",")).join("L") + "Z").join(""))
      .join("");
  }, [geo, project]);

  // a faint graticule every 4 degrees, clipped to India
  const grid = useMemo(() => {
    if (!project) return "";
    const out: string[] = [];
    for (let lon = 68; lon <= 98; lon += 4) out.push(`M${project(lon, 6).join(",")}L${project(lon, 37.5).join(",")}`);
    for (let lat = 8; lat <= 36; lat += 4) out.push(`M${project(67, lat).join(",")}L${project(98, lat).join(",")}`);
    return out.join("");
  }, [project]);

  // bulletin cities as dots (the six metros have their own markers); appear north to south
  const dots = useMemo(() => {
    if (!project) return [];
    const metros = new Set(cities.map((c) => c.city));
    return others.filter((c) => c.lat != null && c.lon != null && !metros.has(c.city)).map((c) => {
      const [x, y] = project(c.lon!, c.lat!);
      const cat = cpcbCategory(c);
      return { c, x, y, colour: cat ? CATEGORY_STYLE[cat].bg : CATEGORY_STYLE.None.bg, delay: 0.9 + ((37 - c.lat!) / 31) * 1.4 };
    });
  }, [project, others, cities]);

  /** Opens a city's card at the first spot (beside, above or below its marker) that stays inside the map and
   * covers no other city's label or marker. */
  const openCard = useCallback((name: string | null) => {
    setOpen(name);
    const w = wrap.current, at = name ? pos[name] : null;
    if (!w || !at) return;
    const box = w.getBoundingClientRect();
    const W = 256, H = phone ? 232 : 192, g = 16;
    const obstacles = cities.filter((c) => c.city !== name && pos[c.city]).flatMap((c) => {
      const [x, y] = pos[c.city];
      const tag = w.querySelector<HTMLElement>(`[data-tag="${c.city}"]`)?.getBoundingClientRect();
      const r = [{ x: x - 16, y: y - 16, w: 32, h: 32 }];
      if (tag) r.push({ x: tag.left - box.left, y: tag.top - box.top, w: tag.width, h: tag.height });
      return r;
    });
    const overlap = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
      Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    const tries: [number, number][] = [[g, g], [g, -g - H], [-g - W, g], [-g - W, -g - H], [-W / 2, g + 6], [-W / 2, -g - 6 - H], [g, -H / 2], [-g - W, -H / 2]];
    let best = tries[0], score = Infinity;
    for (const [dx, dy] of tries) {
      const r = { x: at[0] + dx, y: at[1] + dy, w: W, h: H };
      const outside = r.x < 4 || r.y < 4 || r.x + W > box.width - 4 || r.y + H > box.height - 24;
      const sc = obstacles.reduce((a, o) => a + overlap(r, o), 0) + (outside ? 1e6 : 0);
      if (sc < score) { score = sc; best = [dx, dy]; }
      if (sc === 0) break;
    }
    setCardAt(best);
  }, [cities, pos, phone]);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(null); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  const mode = outline ? "ready" : failed ? "failed" : "loading";
  const [w, h] = size ?? [0, 0];
  const dotDate = others[0]?.date;

  return (
    <div ref={wrap} className={cn("relative overflow-hidden", className)} data-map={mode}>
      {outline && (
        <svg aria-hidden width={w} height={h} className="absolute inset-0 overflow-visible">
          <defs>
            <linearGradient id="sq-india-fill" x1="0" y1="0" x2="0.6" y2="1">
              <stop offset="0%" stopColor="#13223F" />
              <stop offset="55%" stopColor="#0F1B35" />
              <stop offset="100%" stopColor="#0B2A33" />
            </linearGradient>
            <linearGradient id="sq-india-stroke" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#5EEAD4" />
              <stop offset="50%" stopColor="#6E8BC9" />
              <stop offset="100%" stopColor="#2DD4BF" />
            </linearGradient>
            <linearGradient id="sq-sweep" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2DD4BF" stopOpacity="0" />
              <stop offset="50%" stopColor="#2DD4BF" stopOpacity="0.16" />
              <stop offset="100%" stopColor="#2DD4BF" stopOpacity="0" />
            </linearGradient>
            <filter id="sq-glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="6" />
            </filter>
            <clipPath id="sq-india-clip"><path d={outline} fillRule="evenodd" /></clipPath>
          </defs>
          {/* soft glow under the outline */}
          <path d={outline} fill="none" stroke="#2DD4BF" strokeOpacity="0.35" strokeWidth="6" filter="url(#sq-glow)" className="sq-fade-in" style={{ animationDelay: "1.1s" }} />
          <path d={outline} fill="url(#sq-india-fill)" fillRule="evenodd" className="sq-fade-in" style={{ animationDelay: "0.7s" }} />
          <g clipPath="url(#sq-india-clip)">
            <path d={grid} stroke="#7FA2E0" strokeOpacity="0.07" strokeWidth="1" fill="none" className="sq-fade-in" style={{ animationDelay: "1.2s" }} />
            <rect x="0" y="0" width={w} height={Math.max(80, h * 0.22)} fill="url(#sq-sweep)" className="sq-sweep" style={{ ["--sweep" as string]: `${h}px` }} />
          </g>
          <path d={outline} fill="none" stroke="url(#sq-india-stroke)" strokeWidth="1.3" strokeLinejoin="round" pathLength={1} className="sq-draw" />
          {/* bulletin cities: one dot each, in its own official AQI category colour */}
          <g>
            {dots.map(({ c, x, y, colour, delay }) => (
              <circle key={c.city} cx={x} cy={y} r={phone ? 1.9 : 2.6} fill={colour} className="sq-dot"
                style={{ animationDelay: `${delay.toFixed(2)}s`, ["--glow" as string]: colour }} />
            ))}
          </g>
        </svg>
      )}
      {/* hover targets for the small dots (desktop): a larger invisible circle per city */}
      {!phone && dots.length > 0 && (
        <svg width={w} height={h} className="absolute inset-0" role="group" aria-label={`Official AQI for ${dots.length} more cities`}>
          {dots.map(({ c, x, y }) => (
            <circle key={c.city} cx={x} cy={y} r={7} fill="transparent" className="cursor-pointer"
              onMouseEnter={() => setHot(c)} onMouseLeave={() => setHot((v) => (v === c ? null : v))}
              onClick={() => router.push(`/explore?layer=cpcb&cpcb=${encodeURIComponent(c.city)}`)}>
              <title>{`${c.city}: official AQI ${c.aqi}`}</title>
            </circle>
          ))}
        </svg>
      )}
      {hot && project && hot.lat != null && hot.lon != null && (() => {
        const [x, y] = project(hot.lon, hot.lat);
        const cat = cpcbCategory(hot);
        return (
          <div className="sq-pop pointer-events-none absolute z-40 -translate-x-1/2 rounded-xl border border-line-strong bg-[#0b1324]/95 px-3 py-2 text-[12.5px] shadow-float backdrop-blur"
            style={{ left: x, top: y - 62 }}>
            <p className="font-semibold text-foreground">{hot.city}</p>
            <p className="flex items-center gap-1.5 text-subtle">
              <span aria-hidden className="size-2 rounded-full" style={{ background: cat ? CATEGORY_STYLE[cat].bg : "#64748B" }} />
              AQI <b className="num text-foreground">{hot.aqi}</b> · {cat ? CATEGORY_STYLE[cat].label : hot.category}
            </p>
          </div>
        );
      })()}
      {mode === "loading" && <p className="absolute inset-0 grid place-items-center text-xs text-faint">Loading map</p>}
      <details className="sq-credits absolute right-2 bottom-2 z-20">
        <summary aria-label="Map credits">ⓘ</summary>
        <p>India boundary as per the Survey of India (<a href="https://github.com/datameet/maps" target="_blank" rel="noreferrer">DataMeet</a>, CC0). City positions: <a href="https://www.geonames.org" target="_blank" rel="noreferrer">GeoNames</a> (CC BY 4.0).</p>
      </details>
      {dots.length > 0 && dotDate && (
        <p className="sq-fade-in pointer-events-none absolute bottom-2 left-2 z-10 flex items-center gap-2 rounded-full bg-[#080d1a]/80 px-2.5 py-1 text-[11.5px] text-subtle backdrop-blur sm:left-4"
          style={{ animationDelay: "2.4s" }}>
          <span aria-hidden className="flex gap-0.5">
            {(["Good", "Satisfactory", "Moderate", "Poor", "Very poor", "Severe"] as const).map((k) => (
              <span key={k} className="size-1.5 rounded-full" style={{ background: CATEGORY_STYLE[k].bg }} />
            ))}
          </span>
          Small dots: official AQI, {dots.length} cities ({fmtDate(dotDate)})
        </p>
      )}
      <ul aria-label={`Six cities on the map: PM2.5 on ${fmtDate(date)}`} className="pointer-events-none absolute inset-0 [&>li]:pointer-events-auto">
        {cities.map((c, i) => {
          const at = pos[c.city];
          if (!at || !outline) return null;
          const side = (phone ? SIDE_PHONE : SIDE_DESKTOP)[c.city] ?? "right";
          return (
            <CityMarker key={c.city} city={c} date={date} x={at[0]} y={at[1]} side={side} phone={phone} index={i}
              open={open === c.city} cardAt={cardAt} onOpen={(v) => openCard(v ? c.city : null)} />
          );
        })}
      </ul>
    </div>
  );
}

function CityMarker({ city, date, x, y, side, phone, open, cardAt, onOpen, index }: {
  city: LatestCity; date: string; x: number; y: number; side: Side; phone: boolean; open: boolean;
  cardAt: [number, number]; onOpen: (v: boolean) => void; index: number;
}) {
  const router = useRouter();
  const cat = categoryOf(city.value, "pm25");
  const colour = cat ? CATEGORY_STYLE[cat].bg : CATEGORY_STYLE.None.bg;
  const href = `/explore?city=${encodeURIComponent(city.city)}`;
  const tag = {
    right: "left-4 top-1/2 -translate-y-1/2",
    left: "right-4 top-1/2 -translate-y-1/2",
    top: "bottom-4 left-1/2 -translate-x-1/2",
  }[side];
  const card = "sq-pop absolute z-20 w-64 rounded-2xl border border-line-strong bg-[#0d1528]/[0.97] p-4 text-left shadow-float backdrop-blur-xl";
  const label = `${city.city}: ${city.value} µg/m³ PM2.5, ${cat ?? "no category"}${city.official_aqi ? `. ${officialAqiText(city.official_aqi)}` : ""}`;
  const delay = 1.6 + index * 0.12;
  return (
    <li className={cn("absolute", open ? "z-30" : "z-10")} style={{ left: x, top: y }}>
      <div
        className="sq-marker-in group relative"
        style={{ animationDelay: `${delay}s` }}
        onMouseEnter={() => !phone && onOpen(true)}
        onMouseLeave={() => !phone && onOpen(false)}
      >
        {/* two rings ripple out in the city's category colour */}
        <span aria-hidden className="sq-ripple pointer-events-none absolute -top-[22px] -left-[22px] size-11 rounded-full border-2" style={{ borderColor: colour }} />
        <span aria-hidden className="sq-ripple pointer-events-none absolute -top-[22px] -left-[22px] size-11 rounded-full border-2" style={{ borderColor: colour, animationDelay: "1.3s" }} />
        <span aria-hidden className="sq-pulse pointer-events-none absolute -top-[34px] -left-[34px] size-[68px] rounded-full"
          style={{ background: `radial-gradient(circle, ${colour}b3 0%, ${colour}38 38%, transparent 70%)` }} />
        <button
          type="button"
          aria-label={phone ? `${label}. Tap for details` : `${label}. Open ${city.city} in Explore`}
          aria-expanded={open}
          onFocus={() => onOpen(true)}
          onBlur={(e) => { if (!e.currentTarget.parentElement?.contains(e.relatedTarget as Node)) onOpen(false); }}
          onClick={() => (phone ? onOpen(!open) : router.push(href))}
          className="absolute -top-[22px] -left-[22px] grid size-11 place-items-center rounded-full"
        >
          <span className="size-3.5 rounded-full transition-transform duration-200 group-hover:scale-125" style={{ background: colour, boxShadow: `0 0 0 2px rgb(6 10 20 / 0.9), 0 0 18px ${colour}` }} />
        </button>
        <span aria-hidden data-tag={city.city} className={cn(
          open && "invisible", // the open card replaces the small label
          "pointer-events-none absolute grid grid-cols-[auto_auto] items-baseline gap-x-2 rounded-[10px] border border-line-strong bg-[#080d1a]/90 whitespace-nowrap shadow-[0_8px_24px_-10px_rgb(0_0_0/0.8)] backdrop-blur",
          phone ? "px-2 py-1" : "px-2.5 pt-1 pb-1.5",
          tag,
        )}>
          <b className={cn("font-semibold text-subtle", phone ? "text-[11px]" : "col-span-2 text-xs")}>{city.city}</b>
          <span className={cn("num font-semibold", phone ? "text-[13px]" : "text-lg leading-tight")} style={{ color: phone ? undefined : "#F4F8FF" }}>{city.value.toFixed(1)}</span>
          {!phone && <span className="text-[11.5px] text-subtle">µg/m³ · {cat}</span>}
        </span>
        {open && (
          <div className={card} style={{ left: cardAt[0], top: cardAt[1] }} role="dialog" aria-label={`${city.city} details`}>
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold">{city.city}</p>
              <CategoryBadge category={cat} size="sm" label="PM2.5 category" />
            </div>
            <p className="mt-1.5 flex items-baseline gap-1.5">
              <span className="num text-2xl font-medium">{city.value.toFixed(1)}</span>
              <span className="text-xs text-subtle">µg/m³</span>
            </p>
            <p className="text-[11px] text-faint"><Term k="pm25" /> concentration, not <Term k="aqi" /></p>
            <OfficialAqiChip aqi={city.official_aqi} size="sm" className="mt-2" />
            <p className="mt-1 text-xs text-subtle">{city.stations_reporting} of {city.stations_total} stations reporting</p>
            <p className="text-xs text-faint">24-hour average, {fmtDate(date)}</p>
            {phone && (
              <a href={href} className="mt-3 inline-flex min-h-11 items-center text-sm font-medium text-teal" onClick={(e) => { e.preventDefault(); router.push(href); }}>
                See its stations in Explore →
              </a>
            )}
          </div>
        )}
      </div>
    </li>
  );
}
