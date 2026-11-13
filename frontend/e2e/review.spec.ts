import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Review screenshots of three answers (comparison, Diwali, Kolkata trend), as a visitor first sees them.
// SHOT_DIR picks the folder (default docs/screenshots/review/after). Uses saved answers only (no AI quota):
// recorded real streams from src/test/fixtures and the backend's saved Diwali demo answer.
const DIR = process.env.SHOT_DIR ?? join(__dirname, "..", "..", "docs", "screenshots", "review", "after");
mkdirSync(DIR, { recursive: true });
const FIX = join(__dirname, "..", "src", "test", "fixtures");

const CASES = [
  { name: "comparison", q: "Compare Delhi and Mumbai over the last 30 days", fixture: "compare-live.sse" },
  { name: "diwali", q: "How bad was Delhi's air on Diwali 2025?", fixture: null }, // backend demo answer
  { name: "kolkata-trend", q: "Show PM2.5 levels in Kolkata for the last 30 days", fixture: "kolkata-replay.sse" },
];

async function ask(page: Page, q: string) {
  const box = page.getByLabel("Your question");
  await box.fill(q);
  await box.press("Enter");
}

async function shot(page: Page, info: TestInfo, name: string) {
  await page.waitForTimeout(600); // chart animation
  await page.screenshot({ path: join(DIR, `${info.project.name}-${name}.png`) });
}

for (const c of CASES) {
  test(`review: ${c.name}`, async ({ page }, info) => {
    test.skip(info.project.name === "tablet", "review shots are desktop and mobile");
    test.skip(!!c.fixture && !existsSync(join(FIX, c.fixture)), "fixture not recorded yet");
    const problems: string[] = [];
    page.on("console", (m) => m.type() === "error" && problems.push(m.text()));
    page.on("pageerror", (e) => problems.push(e.message));
    if (c.fixture) {
      const body = readFileSync(join(FIX, c.fixture), "utf8");
      await page.route("**/api/chat", (r) => r.fulfill({ status: 200, headers: { "Content-Type": "text/event-stream" }, body }));
    }
    await page.goto("/ask");
    await ask(page, c.q);
    await expect(page.getByText("How this answer was made").first()).toBeVisible({ timeout: 30_000 });   // the answer is complete
    await page.locator("article").first().evaluate((e) => e.scrollIntoView());
    await shot(page, info, c.name);
    expect(problems).toEqual([]);
  });
}
