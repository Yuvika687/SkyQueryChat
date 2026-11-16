"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, Compass, GitCompareArrows, MessageSquare } from "lucide-react";
import { useApp } from "@/components/shell/app-context";
import { useOpenDataPanel } from "@/components/shell/app-shell";
import { AskBox } from "@/components/ds/ask-box";
import { StatNumber } from "@/components/ds/data-display";
import { Term } from "@/components/ds/term";
import { CityCard } from "@/components/ds/city-card";
import { ErrorState, FadeIn, Skeleton, WakeUpState } from "@/components/ds/states";
import { CATEGORY_STYLE, type Category } from "@/lib/categories";
import { cpcbCategory, getCpcbCities, type CpcbCity } from "@/lib/cpcb";
import { fmtDate, fmtSpan } from "@/lib/format";
import { IndiaMap } from "./india-map";
import { CityFinder, cityHref } from "./city-finder";

// Questions the app answers well today (each opens Ask with that question).
export const HOME_QUESTIONS = [
  "How did Delhi's air change around Diwali 2026?",
  "Which of the six cities had the highest PM2.5 in winter 2025?",
  "Is rain associated with lower PM10 in Mumbai?",
  "Were there any unusual PM2.5 days in Delhi in 2025?",
];

const WAYS = [
  { href: "/ask", name: "Ask", icon: MessageSquare, line: "Type a question in plain words; every number links to its proof." },
  { href: "/explore", name: "Explore", icon: Compass, line: "See every monitoring station, or the official AQI for 329 cities on the map." },
  { href: "/compare", name: "Compare", icon: GitCompareArrows, line: "Put two to six cities side by side over any period, 2025 or 2026." },
];

const ORDER: Category[] = ["Good", "Satisfactory", "Moderate", "Poor", "Very poor", "Severe"];

export function HomeScreen() {
  const { latest, latestState, backend, reloadLatest, recheckBackend } = useApp();
  const openData = useOpenDataPanel();
  const loading = !latest && (backend === "checking" || backend === "waking" || latestState === "loading" || latestState === "idle");
  const failed = !latest && (backend === "down" || latestState === "error");
  const retry = () => void (backend === "down" ? recheckBackend() : reloadLatest());

  // every city in CPCB's daily bulletin (official AQI): dots on the map and the "Across India" section
  const [cpcb, setCpcb] = useState<CpcbCity[] | null>(null);
  useEffect(() => {
    if (backend !== "ready" || cpcb) return;
    getCpcbCities().then((d) => setCpcb(d.cities)).catch(() => setCpcb([]));
  }, [backend, cpcb]);

  const stations = latest?.cities.reduce((a, c) => a + (c.stations_reporting ?? 0), 0) ?? 0;

  return (
    <div className="mx-auto w-full max-w-[1360px] px-4 pt-[84px] pb-[calc(104px+env(safe-area-inset-bottom))] sm:px-8 md:pt-[96px] md:pb-10">
      {/* ------------------------------------------------------------ hero */}
      <section aria-labelledby="home-title" className="grid grid-cols-[minmax(0,1fr)] items-center gap-6 lg:min-h-[calc(100dvh-140px)] lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-10">
        <div className="relative z-10 min-w-0">
          <FadeIn>
            <p className="inline-flex h-8 items-center gap-2 rounded-full border border-teal/25 bg-teal/[0.06] px-3 text-[13px] text-subtle shadow-[0_0_24px_-8px_rgb(45_212_191/0.5)]">
              <span aria-hidden className="sq-live size-1.5 rounded-full bg-teal text-teal" />
              Latest available:{" "}
              {latest ? <strong className="font-semibold text-foreground">{fmtDate(latest.date)}</strong> : <span aria-hidden className="inline-block h-3.5 w-20 animate-pulse rounded bg-raised/70" />}
              <span aria-hidden className="hidden text-faint sm:inline">·</span>
              <span className="hidden sm:inline">{cpcb?.length || 329} cities</span>
            </p>
          </FadeIn>
          <Headline />
          <FadeIn delay={0.25}>
            <p className="max-w-[480px] text-[16px] leading-7 text-subtle sm:text-[17px]">
              The latest <Term k="pm25" /> for six Indian cities, beside the official <Term k="aqi" /> from <Term k="cpcb" /> for
              329 cities. Ask about any of it in plain words.
            </p>
          </FadeIn>
          <FadeIn delay={0.32}>
            <AskBox
              className="mt-7"
              placeholder="e.g. How did Delhi's air change around Diwali 2026?"
              hint="Type a question, or pick one below. Every number in the answer links to its proof."
              suggestions={HOME_QUESTIONS}
            />
          </FadeIn>
          <FadeIn delay={0.4}>
            <dl className="mt-7 grid max-w-[520px] grid-cols-3 gap-2">
              <Stat label="cities with official AQI" value={cpcb?.length ?? null} />
              <Stat label="metros with station data" value={latest ? latest.cities.length : null} />
              <Stat label="stations reporting" value={latest ? stations : null} />
            </dl>
            <CityFinder className="mt-6 max-w-[520px]" />
          </FadeIn>
        </div>

        <FadeIn delay={0.08}>
          <p className="mb-2 text-xs text-subtle sm:text-center lg:text-left">
            <strong className="font-semibold text-foreground"><Term k="pm25" />{latest ? `, ${fmtDate(latest.date)}` : ""}</strong> · 24-hour city average, µg/m³ (micrograms per cubic metre)
          </p>
          <div className="relative aspect-[10/11] sm:aspect-auto sm:h-[600px] lg:h-[min(640px,calc(100dvh-170px))]">
            <div aria-hidden className="pointer-events-none absolute inset-y-[-6%] inset-x-0 lg:inset-x-[-6%] bg-[radial-gradient(ellipse_52%_50%_at_50%_50%,rgba(45,212,191,0.16),rgba(30,64,120,0.12)_45%,transparent_72%)]" />
            {latest ? (
              <IndiaMap cities={latest.cities} date={latest.date} others={cpcb ?? []} className="sq-home-map absolute inset-0" />
            ) : (
              <Skeleton className="sq-fade absolute inset-[8%] rounded-[40%] bg-[#0b1324]" />
            )}
            {(loading || failed) && (
              <div className="absolute inset-x-3 bottom-12 sm:inset-x-6">
                {failed ? (
                  <ErrorState title="The city values could not load" message="The data server did not answer. Your question box still works." onRetry={retry} />
                ) : backend === "waking" ? (
                  <WakeUpState />
                ) : null}
              </div>
            )}
          </div>
        </FadeIn>
      </section>

      {/* ------------------------------------------------------------ cities */}
      <section aria-labelledby="cities-title" className="mt-10 lg:mt-6">
        <div className="mb-5 flex flex-col gap-1.5 sm:flex-row sm:items-baseline sm:justify-between">
          <h2 id="cities-title" className="font-display text-[32px] leading-tight sm:text-[36px]">Six cities, highest first</h2>
          {latest && (
            <p className="max-w-[640px] text-[13px] text-faint">
              <Term k="pm25" /> 24-hour city average for {fmtDate(latest.date)}, in <Term k="ugm3" />. Small line: daily values, {fmtSpan(latest.start, latest.date)}.
              Official <Term k="aqi" />: <Term k="cpcb" /> 4 PM bulletin for the same date.
            </p>
          )}
        </div>
        {failed ? (
          <ErrorState title="The city values could not load" message="Please try again in a moment." onRetry={retry} />
        ) : (
          <ol className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {latest
              ? latest.cities.map((c, i) => (
                  <FadeIn as="li" key={c.city} delay={i * 0.05}>
                    <CityCard city={c} rank={i + 1} date={latest.date} />
                  </FadeIn>
                ))
              : Array.from({ length: 6 }, (_, i) => (
                  <li key={i}><Skeleton className="h-[76px] rounded-2xl md:h-[204px]" /></li>
                ))}
          </ol>
        )}
      </section>

      {/* ------------------------------------------------------------ all bulletin cities */}
      {cpcb && cpcb.length > 0 && <AcrossIndia cities={cpcb} />}

      {/* ------------------------------------------------------------ three ways */}
      <section aria-labelledby="ways-title" className="mt-20">
        <h2 id="ways-title" className="font-display text-[32px] leading-tight sm:text-[36px]">Three ways to use SkyQueryChat</h2>
        <ul className="mt-5 grid gap-4 md:grid-cols-3">
          {WAYS.map((w, i) => (
            <FadeIn as="li" key={w.href} delay={i * 0.06}>
              <Link href={w.href} className="card sq-glow group sq-lift flex h-full items-start gap-4 p-6 text-[15px] text-subtle transition-colors hover:border-line-strong">
                <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-teal/25 to-[#3B82F6]/10 text-teal shadow-[inset_0_0_0_1px_rgb(45_212_191/0.25)] transition-transform duration-300 group-hover:scale-110 group-hover:rotate-[-4deg]">
                  <w.icon className="size-5" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="font-display text-[28px] leading-none text-foreground">{w.name}</span>
                  <span>{w.line}</span>
                </span>
                <ArrowRight className="mt-1.5 size-5 shrink-0 text-teal transition-transform group-hover:translate-x-1" aria-hidden />
              </Link>
            </FadeIn>
          ))}
        </ul>
      </section>

      {/* ------------------------------------------------------------ footer */}
      <footer className="mt-20 flex flex-col gap-4 text-[12.5px] leading-5 text-faint sm:flex-row sm:items-start sm:justify-between">
        <div className="flex max-w-[860px] flex-col gap-1.5">
          <p>
            Measured PM2.5 and PM10: CPCB stations via <a className="underline underline-offset-2 hover:text-foreground" href="https://openaq.org" target="_blank" rel="noreferrer">OpenAQ</a>.
            Official AQI: CPCB daily bulletins (cpcb.gov.in; earlier dates parsed by UrbanEmissions.info). Weather data by{" "}
            <a className="underline underline-offset-2 hover:text-foreground" href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo.com</a> (CC BY 4.0), reanalysis from the Copernicus Climate Change Service.
          </p>
          <p>
            Map: India boundary as per the Survey of India (<a className="underline underline-offset-2 hover:text-foreground" href="https://github.com/datameet/maps" target="_blank" rel="noreferrer">DataMeet</a>, CC0);
            city positions from <a className="underline underline-offset-2 hover:text-foreground" href="https://www.geonames.org" target="_blank" rel="noreferrer">GeoNames</a> (CC BY 4.0).
          </p>
        </div>
        <button type="button" onClick={openData} className="self-start text-sm text-subtle underline underline-offset-2 hover:text-foreground">
          Data &amp; accuracy
        </button>
      </footer>
    </div>
  );
}

/** "Ask India's air anything": words rise in one after another (shown at once with reduced motion). */
function Headline() {
  const reduce = useReducedMotion();
  const words = ["Ask", "India's", "air"];
  const rise = (i: number) => (reduce ? {} : {
    initial: { opacity: 0, y: 26, filter: "blur(8px)" }, animate: { opacity: 1, y: 0, filter: "blur(0px)" },
    transition: { duration: 0.7, delay: 0.05 + i * 0.09, ease: [0.16, 1, 0.3, 1] as const },
  });
  return (
    <h1 id="home-title" className="mt-5 mb-4 font-display text-[52px] leading-[0.98] tracking-[-0.02em] sm:text-[72px] xl:text-[84px]">
      {/* real spaces between the words, so the heading reads as one sentence */}
      {words.map((w, i) => (
        <span key={w}><motion.span className="inline-block" {...rise(i)}>{w}</motion.span>{" "}</span>
      ))}
      <motion.em className="sq-shimmer-text inline-block pr-2" {...rise(words.length)}>anything</motion.em>
    </h1>
  );
}

function Stat({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="tile flex min-w-0 flex-col gap-0.5 px-3 py-2.5">
      <dt className="order-2 text-[11.5px] leading-4 text-faint">{label}</dt>
      <dd className="order-1 text-[22px] leading-7 font-semibold text-foreground">
        {value == null ? <span aria-hidden className="inline-block h-5 w-10 animate-pulse rounded bg-raised/70" /> : <StatNumber value={value} decimals={0} />}
      </dd>
    </div>
  );
}

/** Every city in CPCB's daily bulletin: how many are in each category, and the highest and lowest. */
function AcrossIndia({ cities }: { cities: CpcbCity[] }) {
  const date = cities.reduce((a, c) => (c.date > a ? c.date : a), "");
  const today = cities.filter((c) => c.date === date && c.aqi != null);
  const counts = ORDER.map((k) => ({ k, n: today.filter((c) => cpcbCategory(c) === k).length }));
  const total = counts.reduce((a, c) => a + c.n, 0);
  const sorted = [...today].sort((a, b) => b.aqi - a.aqi);
  const high = sorted.slice(0, 5), low = sorted.slice(-5).reverse();
  return (
    <section aria-labelledby="india-title" className="mt-20">
      <div className="mb-5 flex flex-col gap-1.5 sm:flex-row sm:items-baseline sm:justify-between">
        <h2 id="india-title" className="font-display text-[32px] leading-tight sm:text-[36px]">Across India</h2>
        <p className="text-[13px] text-faint">Official <Term k="aqi" /> (<Term k="cpcb" /> 4 PM bulletin, {fmtDate(date)}) for {total} cities.</p>
      </div>
      <FadeIn>
        <div className="card p-5 sm:p-6">
          <p className="mb-3 text-[13px] font-medium text-subtle">Cities in each <Term k="aqi" /> category</p>
          <div className="flex h-4 w-full overflow-hidden rounded-full bg-white/[0.04]" role="img"
            aria-label={counts.filter((c) => c.n).map((c) => `${CATEGORY_STYLE[c.k].label}: ${c.n}`).join(", ")}>
            {counts.filter((c) => c.n).map((c, i) => (
              <span key={c.k} className="sq-grow h-full" style={{ width: `${(100 * c.n) / total}%`, background: CATEGORY_STYLE[c.k].bg, animationDelay: `${0.1 + i * 0.08}s` }} />
            ))}
          </div>
          <ul className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-[13px] sm:grid-cols-3 lg:grid-cols-6">
            {counts.map((c) => (
              <li key={c.k} className="flex items-center gap-2">
                <span aria-hidden className="size-2.5 rounded-full" style={{ background: CATEGORY_STYLE[c.k].bg }} />
                <span className="text-subtle">{CATEGORY_STYLE[c.k].label}</span>
                <span className="num ml-auto font-semibold lg:ml-0">{c.n}</span>
              </li>
            ))}
          </ul>
        </div>
      </FadeIn>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <FadeIn delay={0.05}><Ranked title="Highest AQI" items={high} /></FadeIn>
        <FadeIn delay={0.1}><Ranked title="Lowest AQI" items={low} /></FadeIn>
      </div>
    </section>
  );
}

function Ranked({ title, items }: { title: string; items: CpcbCity[] }) {
  return (
    <div className="card sq-glow h-full p-5 sm:p-6">
      <h3 className="section-title">{title}</h3>
      <ol className="mt-4 flex flex-col gap-1">
        {items.map((c, i) => {
          const cat = cpcbCategory(c);
          const colour = cat ? CATEGORY_STYLE[cat].bg : CATEGORY_STYLE.None.bg;
          return (
            <li key={c.city}>
              <Link href={cityHref(c.city)} className="group flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-white/[0.04]">
                <span className="num w-4 text-[12px] text-faint">{i + 1}</span>
                <span className="w-[118px] truncate text-[14px] font-medium sm:w-[140px]">{c.city}</span>
                <span className="relative h-2 flex-1 overflow-hidden rounded-full bg-white/[0.05]">
                  <span className="sq-grow absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.min(100, (c.aqi / 500) * 100)}%`, background: `linear-gradient(90deg, ${colour}55, ${colour})`, animationDelay: `${0.2 + i * 0.07}s` }} />
                </span>
                <span className="num w-10 text-right text-[15px] font-semibold">{c.aqi}</span>
                <ArrowRight className="size-3.5 text-faint opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100" aria-hidden />
              </Link>
            </li>
          );
        })}
      </ol>
      <p className="mt-3 text-[12px] text-faint">Bar: AQI on CPCB&apos;s 0–500 scale. Open a city for its last 30 days.</p>
    </div>
  );
}
