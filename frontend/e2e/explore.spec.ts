import { expect, test } from "@playwright/test";

// Explore with the real backend and local data (no AI quota). Software WebGL so the map renders headless.
test.use({ launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] } });
test.skip(({ viewport }) => (viewport?.width ?? 0) < 768, "desktop and tablet layout; the phone sheet has its own check");

test("flies into a city, opens a station, switches pollutant and moves through the days", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/explore");
  await expect(page.getByRole("heading", { name: "Explore" })).toBeVisible();
  await expect(page.getByText("See every monitoring station in the six cities.")).toBeVisible();
  await page.waitForSelector('[data-map="ready"]', { timeout: 60_000 });

  // the six cities, ranked, then fly into Delhi from its map marker
  await expect(page.getByRole("heading", { name: "Six cities, highest first" })).toBeVisible();
  await page.locator('.sq-city-pin[aria-label^="Delhi"]').click();
  await expect(page).toHaveURL(/city=delhi/);
  // stations are drawn by the map (dots with collision-free labels); the list is their accessible twin
  await expect(page.getByRole("list", { name: "Delhi stations" })).toBeVisible();
  const stations = page.getByRole("list", { name: "Delhi stations" }).getByRole("button");
  expect(await stations.count()).toBeGreaterThan(20);

  // open the highest station: the panel shows value, unit, valid hours and the Ask link
  await stations.first().click();
  const panel = page.getByRole("complementary", { name: "Station", exact: true });
  await expect(panel).toBeVisible();
  await expect(panel.getByText(/µg\/m³/).first()).toBeVisible();
  await expect(panel.getByText(/Valid hours:|Not enough data|No readings/)).toBeVisible();
  await expect(panel.getByRole("link", { name: "Ask about this station" })).toHaveAttribute("href", /\/ask\?q=/);
  await expect(page).toHaveURL(/station=\d+/);
  // the same station is the pressed row in the list (and drawn larger, always labelled, on the map)
  await expect(page.getByRole("list", { name: "Delhi stations" }).locator('button[aria-pressed="true"]')).toHaveCount(1);
  // the panel title has no operator suffix; provider and monitor type sit underneath
  await expect(panel.getByRole("heading").first()).not.toContainText(/ - (CPCB|DPCC|IMD)$/);
  await expect(panel.getByText(/^(CPCB|AirNow|AirGradient|StateAir \w+) · /)).toBeVisible();

  // PM10: legend ranges and address follow
  await page.getByRole("radio", { name: "PM10" }).click();
  await expect(page).toHaveURL(/pollutant=pm10/);
  await expect(page.getByText("PM10 categories, 24-hour mean (µg/m³)")).toBeVisible();
  await expect(page.getByText("101–250")).toBeVisible();

  // the slider moves the day; the date and the address change with it
  const slider = page.getByRole("slider", { name: "Day" });
  const before = await slider.getAttribute("aria-valuetext");
  await slider.focus();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  const after = await slider.getAttribute("aria-valuetext");
  expect(after).not.toBe(before);
  await expect(page).toHaveURL(/date=\d{4}-\d{2}-\d{2}/);

  // a shared address opens the same view
  const url = page.url();
  await page.goto(url);
  await page.waitForSelector('[data-map="ready"]', { timeout: 60_000 });
  await expect(page.getByRole("complementary", { name: "Station", exact: true })).toBeVisible();
  await expect(page.getByRole("radio", { name: "PM10" })).toHaveAttribute("aria-checked", "true");
  expect(errors).toEqual([]);
});

test("play steps through the days", async ({ page }) => {
  await page.goto("/explore?city=mumbai");
  await page.waitForSelector('[data-map="ready"]', { timeout: 60_000 });
  const slider = page.getByRole("slider", { name: "Day" });
  await expect(slider).toBeVisible();
  await expect(page.getByText(/^Latest available: /).first()).toBeVisible();   // the last day says "latest available"
  await page.getByRole("radio", { name: "2×" }).click();
  await expect(page.getByRole("radio", { name: "2×" })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("button", { name: "Play last 30 days" }).click();      // starts again from the first day
  await page.waitForTimeout(1500);
  await expect(page.getByText(/^Showing /).first()).toBeVisible();
  const v = Number(await slider.inputValue());
  expect(v).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Pause" }).click();
  const paused = Number(await slider.inputValue());
  await page.waitForTimeout(1200);
  expect(Number(await slider.inputValue())).toBe(paused);
});

test("map credits sit in the compact ⓘ control and expand to the full list", async ({ page }, info) => {
  test.skip((info.project.use.viewport?.width ?? 0) < 768, "phones: same control, top right");
  await page.goto("/explore");
  await page.waitForSelector('[data-map="ready"]', { timeout: 60_000 });
  const attrib = page.locator(".maplibregl-ctrl-attrib");
  await expect(attrib).not.toHaveClass(/maplibregl-compact-show/);           // collapsed at start
  await page.locator(".maplibregl-ctrl-attrib-button").click();
  for (const t of ["OpenFreeMap", "OpenMapTiles", "OpenStreetMap", "Survey of India", "CC BY 2.5 IN", "OpenAQ"]) {
    await expect(attrib).toContainText(t);
  }
});
