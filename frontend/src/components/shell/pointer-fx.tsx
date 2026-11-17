"use client";

// Mouse effects for the whole site (decoration only, never needed to use the page):
// - a soft teal glow that follows the cursor behind the content,
// - a spotlight inside the card or tile under the cursor (.card, .tile, [data-spot]),
// - a gentle 3D tilt on [data-tilt] cards and a magnetic pull on [data-magnetic] buttons,
// - a ring that ripples out from every click.
// Only with a fine pointer (mouse or trackpad) and without reduced motion; touch screens get none of it.
import { useEffect } from "react";

const SPOT = ".card, .tile, [data-spot]";

export function PointerFx() {
  useEffect(() => {
    const fine = window.matchMedia("(pointer: fine)").matches;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!fine || reduce) return;
    const root = document.documentElement;
    root.classList.add("sq-fx");
    let raf = 0, x = 0, y = 0;
    let target: Element | null = null;
    let spot: HTMLElement | null = null, tilt: HTMLElement | null = null, mag: HTMLElement | null = null;

    const swap = (prev: HTMLElement | null, next: HTMLElement | null, off: (el: HTMLElement) => void) => {
      if (prev && prev !== next) off(prev);
      return next;
    };
    const frame = () => {
      raf = 0;
      root.style.setProperty("--cx", `${x}px`);
      root.style.setProperty("--cy", `${y}px`);
      const el = target;
      // spotlight: the innermost card or tile under the cursor
      const s = el?.closest<HTMLElement>(SPOT) ?? null;
      spot = swap(spot, s, (p) => p.removeAttribute("data-spot-on"));
      if (s) {
        const r = s.getBoundingClientRect();
        s.setAttribute("data-spot-on", "");
        s.style.setProperty("--mx", `${x - r.left}px`);
        s.style.setProperty("--my", `${y - r.top}px`);
      }
      // tilt: up to about 4 degrees, towards the cursor
      const t = el?.closest<HTMLElement>("[data-tilt]") ?? null;
      tilt = swap(tilt, t, (p) => { p.style.setProperty("--rx", "0deg"); p.style.setProperty("--ry", "0deg"); });
      if (t) {
        const r = t.getBoundingClientRect();
        t.style.setProperty("--rx", `${(((y - r.top) / r.height) - 0.5) * -5}deg`);
        t.style.setProperty("--ry", `${(((x - r.left) / r.width) - 0.5) * 7}deg`);
      }
      // magnetic: the button leans a few pixels towards the cursor
      const m = el?.closest<HTMLElement>("[data-magnetic]") ?? null;
      mag = swap(mag, m, (p) => { p.style.setProperty("--tx", "0px"); p.style.setProperty("--ty", "0px"); });
      if (m) {
        const r = m.getBoundingClientRect();
        const dx = x - (r.left + r.width / 2), dy = y - (r.top + r.height / 2);
        m.style.setProperty("--tx", `${Math.max(-6, Math.min(6, dx * 0.18))}px`);
        m.style.setProperty("--ty", `${Math.max(-5, Math.min(5, dy * 0.25))}px`);
      }
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" && e.pointerType !== "pen") return;
      x = e.clientX; y = e.clientY; target = e.target instanceof Element ? e.target : null;
      if (!raf) raf = requestAnimationFrame(frame);
    };
    const onLeave = () => { target = null; if (!raf) raf = requestAnimationFrame(frame); };
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      const s = document.createElement("span");
      s.className = "sq-spark";
      s.setAttribute("aria-hidden", "true");
      s.style.left = `${e.clientX}px`;
      s.style.top = `${e.clientY}px`;
      document.body.appendChild(s);
      s.addEventListener("animationend", () => s.remove(), { once: true });
      window.setTimeout(() => s.remove(), 1200);             // in case the animation never runs
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    window.addEventListener("pointerdown", onDown, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("pointerdown", onDown);
      root.classList.remove("sq-fx");
    };
  }, []);
  return <div aria-hidden className="sq-cursor-glow" />;
}
