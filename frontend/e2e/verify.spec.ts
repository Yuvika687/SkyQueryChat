import { expect, test } from "@playwright/test";

// Easy to verify: the official CPCB AQI beside measured PM, short terms with full forms, and the early wake-up ping.

test("home cards show the official AQI chip and label PM as a concentration", async ({ page }) => {
  await page.goto("/");
  const cards = page.getByRole("list").filter({ has: page.getByRole("link", { name: /Open the city page/ }) });
  const first = cards.getByRole("link").first();
  await expect(first).toHaveAccessibleName(/Official AQI \(Air Quality Index\) \d+, .*CPCB 4 PM bulletin, \d{1,2} [A-Z][a-z]{2} \d{4}|Official AQI: bulletin not available/);
  const chip = first.getByTestId("official-aqi").filter({ visible: true });
  await expect(chip).toContainText(/Official AQI/);
  await expect(first.getByText(/concentration/).filter({ visible: true }).first()).toContainText(/not AQI/);
});

test("the map hover card and Explore list show the official AQI", async ({ page, isMobile }) => {
  test.skip(isMobile, "hover card is a desktop interaction");
  await page.goto("/");
  await page.getByRole("button", { name: /^Delhi: .*Open Delhi in Explore/ }).hover();
  await expect(page.getByRole("dialog", { name: "Delhi details" }).getByTestId("official-aqi")).toContainText(/Official AQI/);
  await page.goto("/explore");
  await expect(page.getByRole("button", { name: /^\d+ Delhi/ }).getByTestId("official-aqi").or(
    page.getByTestId("official-aqi").first())).toBeVisible();
});

test("city page hero shows the official AQI and terms have full forms", async ({ page }) => {
  await page.goto("/city/delhi");
  await expect(page.getByText(/PM2\.5 \(fine particles\)/).first()).toBeVisible();
  await expect(page.getByTestId("official-aqi").first()).toContainText(/Official AQI/);
  const term = page.getByRole("button", { name: /^PM2\.5\s*\(Particulate Matter, 2\.5 micrometres or smaller\)$/ }).first();
  await term.click();                                         // tap/click opens the tooltip
  await expect(page.getByRole("tooltip")).toHaveText("Particulate Matter, 2.5 micrometres or smaller");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
});

test("data & accuracy panel has the Check our numbers note and the glossary", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Data & accuracy/ }).first().click();
  const panel = page.getByRole("dialog");
  await expect(panel.getByRole("heading", { name: "Check our numbers" })).toBeVisible();
  const note = panel.getByTestId("check-numbers");
  await expect(note.getByRole("listitem")).toHaveCount(5);
  await expect(note).toContainText("0–500 index");
  await expect(note).toContainText("at least 16 valid hours");
  await expect(note.getByRole("link", { name: /daily AQI bulletin/ })).toHaveAttribute("href", "https://cpcb.gov.in/AQI_Bulletin.php");
  await expect(panel.getByRole("heading", { name: "Short terms" })).toBeVisible();
  await expect(panel.getByText("Central Pollution Control Board.")).toBeVisible();
  await expect(page.getByRole("tooltip")).toHaveCount(0);       // opening the panel does not pop a tooltip
});

test("every page pings the backend health endpoint before the app loads", async ({ page }) => {
  const html = await (await page.request.get("/explore")).text();
  expect(html).toMatch(/<script id="wake-ping">[^<]*\/api\/health/);
  const ping = page.waitForRequest((r) => r.url().endsWith("/api/health"));
  await page.goto("/compare");
  await ping;
});
