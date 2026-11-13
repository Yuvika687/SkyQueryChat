import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Automated accessibility check on every page: zero serious or critical axe violations (WCAG 2.2 A/AA rules).
async function check(page: Page, what: string) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .exclude(".maplibregl-canvas").analyze();
  const bad = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(bad.map((v) => `${what}: ${v.id} (${v.impact}) ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
}

const PAGES: [string, string, string | RegExp][] = [
  ["home", "/", "Ask India's air"],
  ["explore", "/explore", "Every monitoring station"],
  ["explore station", "/explore?city=delhi&station=5626&pollutant=pm25", "Reference monitor"],
  ["ask", "/ask", "Ask any question about air quality in the six cities."],
  ["city", "/city/delhi", "Last 30 days"],
  ["compare", "/compare?cities=delhi,mumbai&metric=pm25&period=30d", "Ranking"],
  ["404", "/no-such-page", "This page doesn't exist"],
];

for (const [name, path, ready] of PAGES) {
  test(`a11y: ${name}`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByText(ready).first()).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(800);
    await check(page, name);
  });
}

test("a11y: ask answer and proof", async ({ page }, info) => {
  await page.goto("/ask");
  const box = page.getByLabel("Your question");
  await box.fill("How bad was Delhi's air on Diwali 2025?");
  await box.press("Enter");
  await expect(page.getByText("Saved demo answer")).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(800);
  await check(page, "ask answer");
  await page.locator("article").first().getByRole("button", { name: "352" }).first().click();
  await page.waitForTimeout(500);
  await check(page, `ask proof (${info.project.name})`);
});

test("a11y: data & accuracy panel", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Data & accuracy/ }).first().click();
  await expect(page.getByRole("heading", { name: "Test results" })).toBeVisible();
  await page.waitForTimeout(1500);
  await check(page, "panel");
});

test("keyboard: skip to content and visible focus", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  const first = page.locator(":focus");
  await expect(first).toBeVisible();
  const outline = await first.evaluate((e) => { const s = getComputedStyle(e); return s.outlineStyle !== "none" || s.boxShadow !== "none"; });
  expect(outline).toBe(true);
});
