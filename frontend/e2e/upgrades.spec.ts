import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

// Quick ask, station search, copy link and downloads. Real backend and local data; no AI quota (Ask is not sent).
const desktop = (p: Page) => (p.viewportSize()?.width ?? 0) >= 1024;

test("quick ask: Ctrl/Cmd+K opens it from any page, Escape closes, a suggestion opens Ask", async ({ page }) => {
  let asked = "";
  await page.route("**/api/chat", async (r) => { asked = JSON.parse(r.request().postData() || "{}").message; await r.abort(); });
  await page.goto("/compare");
  await page.keyboard.press("ControlOrMeta+k");
  const dlg = page.getByRole("dialog", { name: "Quick ask" });
  await expect(dlg).toBeVisible();
  await expect(dlg.getByLabel("Ask a question")).toBeFocused();
  await expect(dlg.getByRole("button", { name: /Diwali 2026|Compare Delhi|rain|winter/ })).toHaveCount(4);
  await page.keyboard.press("Escape");
  await expect(dlg).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+k");
  await dlg.getByRole("button", { name: "Compare Delhi and Mumbai over the last 30 days" }).click();
  await expect(page).toHaveURL(/\/ask/);
  await expect.poll(() => asked).toBe("Compare Delhi and Mumbai over the last 30 days");
});

test("station search finds a station across the six cities and flies to it", async ({ page }) => {
  await page.goto("/explore");
  await page.waitForSelector('[data-map="ready"]', { timeout: 60_000 });
  const box = page.getByRole("combobox", { name: "Find a station" }).first();
  await box.fill("dtu");
  await expect(page.getByRole("option", { name: /DTU, New Delhi/ })).toBeVisible();
  await box.press("Enter");
  await expect(page).toHaveURL(/city=delhi&station=\d+/i);
  if (desktop(page)) await expect(page.getByRole("complementary", { name: "Station", exact: true })).toContainText("DTU, New Delhi");
  await box.fill("zzzz");
  await expect(page.getByText(/No station matches/)).toBeVisible();
});

test("city page: copy link and download data (CSV) with toasts", async ({ page, context }, info) => {
  test.skip(info.project.name !== "desktop", "clipboard permission is granted on desktop Chromium only");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/city/delhi");
  await page.getByRole("button", { name: "Copy link" }).click();
  await expect(page.getByRole("status").getByText("Link copied")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/city\/delhi$/);
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download data (CSV)" }).click()]);
  expect(dl.suggestedFilename()).toBe("delhi-daily-pm.csv");
  const csv = readFileSync((await dl.path())!, "utf8");
  expect(csv.split("\n")[0]).toBe("city,date,pm25_ugm3,pm10_ugm3,stations_pm25,data_type,source");
  expect(csv).toMatch(/\nDelhi,2026-11-11,164\.7,/);
  await expect(page.getByRole("status").getByText("Data downloaded (CSV)")).toBeVisible();
});

test("compare: copy link keeps the selection; CSV holds the daily lines", async ({ page, context }, info) => {
  test.skip(info.project.name !== "desktop", "clipboard permission is granted on desktop Chromium only");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/compare?cities=delhi,mumbai&metric=pm25&period=30d");
  await expect(page.getByRole("heading", { name: "Ranking" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Copy link" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/cities=delhi(,|%2C)mumbai/);
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download data (CSV)" }).click()]);
  const csv = readFileSync((await dl.path())!, "utf8").trim().split("\n");
  expect(csv[0]).toBe("date,Delhi_pm25,Mumbai_pm25,unit,data_type,source");
  expect(csv).toHaveLength(31);
});

test("ask answer: copy link, copy answer, download chart and data", async ({ page, context }, info) => {
  test.skip(info.project.name !== "desktop", "clipboard permission is granted on desktop Chromium only");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/ask");
  await page.locator("textarea#question").fill("How bad was Delhi's air on Diwali 2025?");
  await page.locator("textarea#question").press("Enter");
  await expect(page.getByText("Saved demo answer")).toBeVisible({ timeout: 30_000 });
  const card = page.locator("article").first();
  await card.getByRole("button", { name: "Copy link" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/ask\?q=How%20bad%20was%20Delhi/);
  await card.getByRole("button", { name: "Copy answer" }).click();
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toMatch(/^Q: How bad was Delhi's air on Diwali 2025\?/);
  expect(text).toMatch(/numbers checked against the analysis/);
  expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  await expect(page.getByRole("status").getByText("Answer copied")).toBeVisible();
  await expect(page.locator('section[aria-label="Chart"] canvas').first()).toBeVisible({ timeout: 30_000 });   // chart drawn
  const [png] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download chart" }).first().click()]);
  expect(png.suggestedFilename()).toMatch(/\.png$/);
  const [csv] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download data" }).first().click()]);
  expect(csv.suggestedFilename()).toMatch(/\.csv$/);
});

test("health note: city card focus and city page hero show CPCB's statement", async ({ page }, info) => {
  test.skip(info.project.name === "mobile", "cards are compact on phones");
  await page.goto("/");
  const card = page.getByRole("link", { name: /^Delhi: .*CPCB health note: / });
  await expect(card).toBeVisible({ timeout: 30_000 });
  await page.goto("/city/delhi");
  await expect(page.getByText(/CPCB health note:/).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/vs \d{1,2} [A-Z][a-z]{2}/).first()).toBeVisible();      // day-over-day change
});
