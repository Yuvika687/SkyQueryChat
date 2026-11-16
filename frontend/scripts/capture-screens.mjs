// Screenshots of every page at desktop (1440x900) and phone (390x844) size, against a running site and backend.
//   node scripts/capture-screens.mjs [base url, default http://localhost:3000]   -> docs/screenshots/current/
// The Ask shots use a live answer (the backend must have GEMINI_API_KEY); nothing is mocked.
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const BASE = process.argv[2] || "http://localhost:3000";
const OUT = fileURLToPath(new URL("../../docs/screenshots/current/", import.meta.url));
mkdirSync(OUT, { recursive: true });

const SIZES = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } };
const PAGES = [
  { name: "home", path: "/", wait: "text=Six cities, highest first" },
  { name: "explore-india", path: "/explore", wait: ".sq-city-pin", settle: 4000 },
  { name: "explore-all-cities", path: "/explore?layer=cpcb", wait: "#cpcb-search", settle: 4000 },
  { name: "explore-city-lucknow", path: "/explore?layer=cpcb&cpcb=Lucknow", wait: "text=Ask about this city", settle: 4000 },
  { name: "ask-lucknow", path: "/ask?q=" + encodeURIComponent("AQI in Lucknow"), wait: "text=numbers checked", timeout: 90000, settle: 2500 },
  { name: "ask-compare", path: "/ask?q=" + encodeURIComponent("Compare Delhi and Mumbai over the last 30 days"), wait: "text=numbers checked", timeout: 90000, settle: 2500 },
  { name: "city-delhi", path: "/city/delhi", wait: "h1 >> text=Delhi", timeout: 60000, settle: 1500 },
  { name: "compare", path: "/compare", wait: "text=Ranking", timeout: 60000, settle: 2000 },
];

const browser = await chromium.launch();
for (const [size, viewport] of Object.entries(SIZES)) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: size === "mobile", hasTouch: size === "mobile" });
  for (const p of PAGES) {
    const page = await ctx.newPage();
    try {
      await page.goto(BASE + p.path, { waitUntil: "domcontentloaded" });
      await page.waitForSelector(p.wait, { timeout: p.timeout ?? 45000 });
      await page.waitForTimeout(p.settle ?? 1200);
      await page.screenshot({ path: `${OUT}${p.name}-${size}.png` });
      console.log("ok", p.name, size);
    } catch (e) {
      console.log("FAILED", p.name, size, String(e).split("\n")[0]);
    }
    await page.close();
  }
  await ctx.close();
}
await browser.close();
