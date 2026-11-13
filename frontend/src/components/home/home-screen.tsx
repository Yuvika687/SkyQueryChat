"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useApp } from "@/components/shell/app-context";
import { useOpenDataPanel } from "@/components/shell/app-shell";
import { AskBox } from "@/components/ds/ask-box";
import { CityCard } from "@/components/ds/city-card";
import { ErrorState, FadeIn, Skeleton, WakeUpState } from "@/components/ds/states";
import { fmtDate, fmtSpan } from "@/lib/format";
import { IndiaMap } from "./india-map";

// Questions the app answers well today (each opens Ask with that question).
export const HOME_QUESTIONS = [
  "How did Delhi's air change around Diwali 2026?",
  "Which of the six cities had the highest PM2.5 in winter 2025?",
  "Is rain associated with lower PM10 in Mumbai?",
  "Were there any unusual PM2.5 days in Delhi in 2025?",
];

const WAYS = [
  { href: "/ask", name: "Ask", line: "Type a question in plain words; every number links to its proof." },
  { href: "/explore", name: "Explore", line: "Click a city on the map to see its monitoring stations." },
  { href: "/compare", name: "Compare", line: "Put two to six cities side by side over any period." },
];

export function HomeScreen() {
  const { latest, latestState, backend, reloadLatest, recheckBackend } = useApp();
  const openData = useOpenDataPanel();
  const loading = !latest && (backend === "checking" || backend === "waking" || latestState === "loading" || latestState === "idle");
  const failed = !latest && (backend === "down" || latestState === "error");
  const retry = () => void (backend === "down" ? recheckBackend() : reloadLatest());

  return (
    <div className="mx-auto w-full max-w-[1360px] px-4 pt-[84px] pb-[calc(104px+env(safe-area-inset-bottom))] sm:px-8 md:pt-[96px] md:pb-10">
      {/* ------------------------------------------------------------ hero */}
      <section aria-labelledby="home-title" className="grid grid-cols-[minmax(0,1fr)] items-center gap-6 lg:min-h-[calc(100dvh-140px)] lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-10">
        <FadeIn className="relative z-10 min-w-0">
          {/* the nav chip shows this on wide screens */}
          <p className="inline-flex h-8 items-center gap-2 rounded-full border border-line-strong bg-white/[0.02] px-3 text-[13px] text-subtle lg:hidden">
            <span aria-hidden className="size-1.5 rounded-full bg-teal" />
            Latest available:{" "}
            {latest ? <strong className="font-semibold text-foreground">{fmtDate(latest.date)}</strong> : <span aria-hidden className="inline-block h-3.5 w-20 animate-pulse rounded bg-raised/70" />}
          </p>
          <h1 id="home-title" className="mt-5 mb-4 font-display lg:mt-0 text-[52px] leading-[0.98] tracking-[-0.02em] sm:text-[72px] xl:text-[84px]">
            Ask India&apos;s air <em className="text-[#BFF7EE]">anything</em>
          </h1>
          <p className="max-w-[470px] text-base text-subtle sm:text-[17px] sm:leading-7">
            See the latest available air quality for six Indian cities, then ask about any of it in plain words.
          </p>
          <AskBox
            className="mt-7"
            placeholder="e.g. How did Delhi's air change around Diwali 2026?"
            hint="Type a question, or pick one below. Every number in the answer links to its proof."
            suggestions={HOME_QUESTIONS}
          />
        </FadeIn>

        <FadeIn delay={0.08}>
          {/* no box: the map sits on the page, with a soft glow behind India and edges that fade out (CSS mask) */}
          <p className="mb-2 text-xs text-subtle sm:text-center lg:text-left">
            <strong className="font-semibold text-foreground">PM2.5{latest ? `, ${fmtDate(latest.date)}` : ""}</strong> · 24-hour city average, µg/m³
          </p>
          <div className="relative aspect-[10/11] sm:aspect-auto sm:h-[600px] lg:h-[min(640px,calc(100dvh-170px))]">
            <div aria-hidden className="pointer-events-none absolute inset-[-6%] bg-[radial-gradient(ellipse_52%_50%_at_50%_50%,rgba(45,212,191,0.13),rgba(30,64,120,0.10)_45%,transparent_72%)]" />
            {latest ? (
              <IndiaMap cities={latest.cities} date={latest.date} className="sq-home-map absolute inset-0" />
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
          <h2 id="cities-title" className="font-display text-[32px] leading-tight sm:text-[38px]">Six cities, highest first</h2>
          {latest && (
            <p className="text-[13px] text-faint">
              PM2.5 24-hour city average for {fmtDate(latest.date)}, in µg/m³. Small line: daily values, {fmtSpan(latest.start, latest.date)}.
            </p>
          )}
        </div>
        {failed ? (
          <ErrorState title="The city values could not load" message="Please try again in a moment." onRetry={retry} />
        ) : (
          <ol className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {latest
              ? latest.cities.map((c, i) => (
                  <FadeIn as="li" key={c.city} delay={i * 0.04}>
                    <CityCard city={c} rank={i + 1} date={latest.date} />
                  </FadeIn>
                ))
              : Array.from({ length: 6 }, (_, i) => (
                  <li key={i}><Skeleton className="h-[76px] rounded-2xl md:h-[204px]" /></li>
                ))}
          </ol>
        )}
      </section>

      {/* ------------------------------------------------------------ three ways */}
      <section aria-labelledby="ways-title" className="mt-16">
        <h2 id="ways-title" className="font-display text-[32px] leading-tight sm:text-[38px]">Three ways to use SkyQueryChat</h2>
        <ul className="mt-5 grid gap-4 md:grid-cols-3">
          {WAYS.map((w) => (
            <li key={w.href}>
              <Link href={w.href} className="glass group sq-lift flex h-full items-start gap-4 rounded-2xl p-5 text-subtle shadow-card transition-colors hover:border-line-strong">
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="font-display text-[28px] leading-none text-foreground">{w.name}</span>
                  <span>{w.line}</span>
                </span>
                <ArrowRight className="mt-1.5 size-5 shrink-0 text-teal transition-transform group-hover:translate-x-0.5" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* ------------------------------------------------------------ footer */}
      <footer className="mt-16 flex flex-col gap-4 border-t border-line pt-6 text-xs text-faint sm:flex-row sm:items-start sm:justify-between">
        <div className="flex max-w-[860px] flex-col gap-1.5">
          <p>
            Measured PM2.5 and PM10: CPCB stations via <a className="underline underline-offset-2 hover:text-foreground" href="https://openaq.org" target="_blank" rel="noreferrer">OpenAQ</a>.
            Official AQI: CPCB daily bulletins (cpcb.gov.in; earlier dates parsed by UrbanEmissions.info). Weather data by{" "}
            <a className="underline underline-offset-2 hover:text-foreground" href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo.com</a> (CC BY 4.0), reanalysis from the Copernicus Climate Change Service.
          </p>
          <p>
            Map: <MapCredits />. Full credits: the ⓘ on the map.
          </p>
        </div>
        <button type="button" onClick={openData} className="self-start text-sm text-subtle underline underline-offset-2 hover:text-foreground">
          Data &amp; accuracy
        </button>
      </footer>
    </div>
  );
}

function MapCredits() {
  const a = "underline underline-offset-2 hover:text-foreground";
  return (
    <>
      <a className={a} href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a> ©{" "}
      <a className={a} href="https://openmaptiles.org" target="_blank" rel="noreferrer">OpenMapTiles</a> Data from{" "}
      <a className={a} href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> · India boundary as per the
      Survey of India (<a className={a} href="https://github.com/datameet/maps" target="_blank" rel="noreferrer">DataMeet</a>, CC0)
    </>
  );
}

