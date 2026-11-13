// Screenshots of every mockup at 2x: desktop 1440x900 and phone 390x844 (full page), plus the Ask screen with the
// proof drawer open. Run from the repository root:
//   python3 -m http.server 8765 --directory docs/design-directions &
//   node docs/design-directions/capture.mjs [a-night-observatory ...]
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, "../../frontend/package.json"));
const { chromium } = require("@playwright/test");

const BASE = process.env.BASE || "http://localhost:8765";
const DIRS = process.argv.slice(2).length ? process.argv.slice(2) : ["a-night-observatory", "b-broadsheet", "c-instrument"];
const VIEWS = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } };
const SHOTS = [
  ["home", "home.html", "desktop"], ["home", "home.html", "mobile"],
  ["ask", "ask.html", "desktop"], ["ask", "ask.html", "mobile"],
  ["ask-proof", "ask.html#proof=festival", "desktop"], ["ask-proof", "ask.html#proof=festival", "mobile"],
];

const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
for (const dir of DIRS) {
  for (const [name, url, view] of SHOTS) {
    const ctx = await browser.newContext({ viewport: VIEWS[view], deviceScaleFactor: 2, isMobile: view === "mobile", hasTouch: view === "mobile" });
    const page = await ctx.newPage();
    page.on("console", (m) => { if (m.type() === "error") console.log(`  [${dir}/${name}/${view}] ${m.text()}`); });
    await page.goto(`${BASE}/${dir}/${url}`, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => window.SQ_MAP_READY === true, null, { timeout: 45_000 });
    await page.waitForTimeout(1200);
    const mode = await page.evaluate(() => document.getElementById("map")?.dataset.map || "-");
    const out = path.join(here, "screenshots", `${dir}--${name}--${view}.png`);
    const proof = name === "ask-proof";
    if (!proof) {   // full-page capture: dock fixed bottom bars at the end of the page instead of mid-page
      await page.evaluate(() => {
        document.body.style.position = "relative";
        for (const el of document.querySelectorAll("[data-dock]")) {
          const cs = getComputedStyle(el);
          if (cs.position !== "fixed") continue;          // only bars that float over the viewport
          const fromBottom = innerHeight - el.getBoundingClientRect().bottom;
          el.style.setProperty("position", "absolute", "important");
          el.style.setProperty("top", "auto", "important");
          el.style.setProperty("bottom", `${fromBottom}px`, "important");
        }
      });
      await page.waitForTimeout(300);
    }
    await page.screenshot({ path: out, fullPage: !proof });
    console.log(`${out}  (map: ${mode})`);
    await ctx.close();
  }
}
await browser.close();
