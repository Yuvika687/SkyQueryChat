"use client";

// Home hero map. Basemap: OpenFreeMap "dark" vector style (no API key; OpenMapTiles schema, OpenStreetMap data).
// Its border, label and road layers are removed, so only land and water remain; India is drawn from the
// official boundary of India as per the Survey of India (DataMeet india-composite.geojson, CC0) on top.
// If WebGL or the basemap is unavailable, the same official outline is drawn as SVG.
// City markers are React elements laid over the map at projected positions (the map itself is static, so page
// scrolling is never captured). No values are drawn between cities.
import "maplibre-gl/dist/maplibre-gl.css";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { CATEGORY_STYLE } from "@/lib/categories";
import { fmtDate } from "@/lib/format";
import type { LatestCity } from "@/lib/types";
import { cn } from "@/lib/utils";
import { CategoryBadge, categoryOf } from "@/components/ds/data-display";
import { CREDITS_HTML, INDIA_BOUNDS, THEME, WORKER_URL, addCredits, addIndiaLayers, hasWebGL, loadBaseStyle, loadBoundary, type IndiaGeo } from "@/lib/map-base";

const BOUNDS = INDIA_BOUNDS;

type Side = "left" | "right" | "top";
/** Label sides chosen so labels never overlap: Bengaluru and Chennai sit on opposite sides. */
const SIDE_DESKTOP: Record<string, Side> = { Mumbai: "left", Bengaluru: "left" };
const SIDE_PHONE: Record<string, Side> = { Mumbai: "top", Bengaluru: "left" };

type Geo = IndiaGeo;
type Project = (lon: number, lat: number) => [number, number];

export function IndiaMap({ cities, date, className }: { cities: LatestCity[]; date: string; className?: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const project = useRef<Project | null>(null);
  const [pos, setPos] = useState<Record<string, [number, number]>>({});
  const [mode, setMode] = useState<"loading" | "basemap" | "outline">("loading");
  const [phone, setPhone] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [cardAt, setCardAt] = useState<[number, number]>([16, 16]);

  /** Opens a city's card at the first spot (beside, above or below its marker) that stays inside the map and
   * covers no other city's label or marker. */
  const openCard = useCallback((name: string | null) => {
    setOpen(name);
    const w = wrap.current, at = name ? pos[name] : null;
    if (!w || !at) return;
    const box = w.getBoundingClientRect();
    const W = 240, H = phone ? 176 : 136, g = 16;
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

  const place = useCallback(() => {
    const p = project.current;
    if (!p) return;
    setPos(Object.fromEntries(cities.map((c) => [c.city, p(c.lon, c.lat)])));
  }, [cities]);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const on = () => setPhone(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    let cancelled = false;
    let map: import("maplibre-gl").Map | null = null;
    const pad = () => (el.clientWidth < 500 ? { top: 44, bottom: 30, left: 14, right: 14 } : { top: 56, bottom: 34, left: 40, right: 40 });

    async function start() {
      const geo: Geo = await loadBoundary();
      if (cancelled || !el) return;
      // The official outline is drawn at once (cheap SVG); the basemap (MapLibre, ~1 MB) loads when the browser
      // is idle and replaces it once rendered, so the first view never waits for it.
      outline(geo);
      await idle();
      if (cancelled || !el) return;
      try {
        if (!hasWebGL()) throw new Error("no webgl");
        const [maplibregl, style] = await Promise.all([import("maplibre-gl"), loadBaseStyle()]);
        if (cancelled) return;
        maplibregl.setWorkerUrl(WORKER_URL);
        const m = new maplibregl.Map({
          container: el, style, bounds: BOUNDS, fitBoundsOptions: { padding: pad() }, interactive: false,
          attributionControl: false, fadeDuration: 0,
        });
        map = m;
        addCredits(m, maplibregl.AttributionControl);
        m.on("load", () => {
          if (cancelled) return;
          addIndiaLayers(m, geo);
          project.current = (lon, lat) => { const p = m.project([lon, lat]); return [p.x, p.y]; };
          place();
          m.once("idle", () => { if (cancelled) return; el.querySelector(":scope > svg")?.remove(); setMode("basemap"); });
        });
        m.on("error", (ev) => {
          console.warn("Map error", ev?.error?.message ?? ev);
          if (map && !m.isStyleLoaded()) { m.remove(); map = null; outline(geo); }
        });
      } catch (e) {
        console.warn("Basemap unavailable; keeping the official outline.", e);
      }
    }

    // The basemap starts on the visitor's first interaction, or after a few quiet seconds, so the first view stays
    // light; the official outline is already on screen meanwhile.
    function idle() {
      return new Promise<void>((done) => {
        const evs = ["pointermove", "pointerdown", "scroll", "keydown", "touchstart", "wheel"] as const;
        let t = 0;
        const go = () => { clearTimeout(t); evs.forEach((e) => window.removeEventListener(e, go)); done(); };
        evs.forEach((e) => window.addEventListener(e, go, { once: true, passive: true }));
        t = window.setTimeout(go, 6500);
      });
    }

    function outline(geo: Geo) {
      if (cancelled || !el) return;
      const w = el.clientWidth, h = el.clientHeight, p = pad();
      const pl = typeof p === "number" ? { top: p, bottom: p, left: p, right: p } : p;
      const merc = (lon: number, lat: number): [number, number] => [(lon * Math.PI) / 180, Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))];
      const a = merc(...BOUNDS[0]), b = merc(...BOUNDS[1]);
      const s = Math.min((w - pl.left - pl.right) / (b[0] - a[0]), (h - pl.top - pl.bottom) / (b[1] - a[1]));
      const ox = pl.left + (w - pl.left - pl.right - s * (b[0] - a[0])) / 2, oy = pl.top + (h - pl.top - pl.bottom - s * (b[1] - a[1])) / 2;
      const P: Project = (lon, lat) => { const [x, y] = merc(lon, lat); return [ox + (x - a[0]) * s, h - (oy + (y - a[1]) * s)]; };
      const d = geo.features[0].geometry.coordinates
        .map((poly) => poly.map((r) => "M" + r.map(([x, y]) => P(x, y).map((v) => v.toFixed(1)).join(",")).join("L") + "Z").join(""))
        .join("");
      el.innerHTML = `<svg data-outline width="${w}" height="${h}" style="position:absolute;inset:0" aria-hidden="true"><path d="${d}" fill="${THEME.indiaFill}" stroke="${THEME.outline}" stroke-width="1" fill-rule="evenodd"/></svg>`;
      project.current = P;
      place();
      setMode("outline");
    }

    void start().catch(() => setMode("outline"));
    const ro = new ResizeObserver(() => {
      if (map) { map.resize(); map.fitBounds(BOUNDS, { padding: pad(), duration: 0 }); place(); }
    });
    ro.observe(el);
    return () => {
      cancelled = true;
      ro.disconnect();
      map?.remove();
    };
  }, [place]);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(null); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  return (
    <div ref={wrap} className={cn("relative overflow-hidden", className)} data-map={mode}>
      {/* MapLibre styles its container as position: relative, so the canvas sits in a sized wrapper. */}
      {/* not aria-hidden: the map credits ("ⓘ") live inside; the canvas itself is not focusable here */}
      <div className="absolute inset-0">
        <div ref={canvas} className="h-full w-full" />
      </div>
      {mode === "loading" && <p className="absolute inset-0 grid place-items-center text-xs text-faint">Loading map</p>}
      {/* without a basemap (no WebGL) the same credits sit in a small "ⓘ" of our own */}
      {mode === "outline" && (
        <details className="sq-credits absolute right-2 bottom-2 z-20">
          <summary aria-label="Map credits">ⓘ</summary>
          <p dangerouslySetInnerHTML={{ __html: CREDITS_HTML }} />
        </details>
      )}
      <ul aria-label={`Six cities on the map: PM2.5 on ${fmtDate(date)}`} className="pointer-events-none absolute inset-0 [&>li]:pointer-events-auto">
        {cities.map((c) => {
          const at = pos[c.city];
          if (!at) return null;
          const side = (phone ? SIDE_PHONE : SIDE_DESKTOP)[c.city] ?? "right";
          return (
            <CityMarker key={c.city} city={c} date={date} x={at[0]} y={at[1]} side={side} phone={phone}
              open={open === c.city} cardAt={cardAt} onOpen={(v) => openCard(v ? c.city : null)} />
          );
        })}
      </ul>
    </div>
  );
}

function CityMarker({ city, date, x, y, side, phone, open, cardAt, onOpen }: {
  city: LatestCity; date: string; x: number; y: number; side: Side; phone: boolean; open: boolean;
  cardAt: [number, number]; onOpen: (v: boolean) => void;
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
  const card = "absolute z-20 w-60 rounded-2xl border border-line-strong bg-[#0d1528]/[0.97] p-4 text-left shadow-float backdrop-blur-xl";
  const label = `${city.city}: ${city.value} µg/m³ PM2.5, ${cat ?? "no category"}`;
  return (
    <li className={cn("absolute", open ? "z-30" : "z-10")} style={{ left: x, top: y }}>
      <div
        className="group relative"
        onMouseEnter={() => !phone && onOpen(true)}
        onMouseLeave={() => !phone && onOpen(false)}
      >
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
          <span className="size-3 rounded-full" style={{ background: colour, boxShadow: `0 0 0 2px rgb(6 10 20 / 0.9), 0 0 16px ${colour}` }} />
        </button>
        <span aria-hidden data-tag={city.city} className={cn(
          open && "invisible", // the open card replaces the small label
          "pointer-events-none absolute grid grid-cols-[auto_auto] items-baseline gap-x-2 rounded-[10px] border border-line-strong bg-[#080d1a]/90 whitespace-nowrap",
          phone ? "px-2 py-1" : "px-2.5 pt-1 pb-1.5",
          tag,
        )}>
          <b className={cn("font-semibold text-subtle", phone ? "text-[11px]" : "col-span-2 text-xs")}>{city.city}</b>
          <span className={cn("num font-semibold", phone ? "text-[13px]" : "text-lg leading-tight")}>{city.value.toFixed(1)}</span>
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
              <span className="text-xs text-subtle">µg/m³ PM2.5</span>
            </p>
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
