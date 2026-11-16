import { expect, test } from "@playwright/test";

// Compare page with the real backend and local data (no AI).
test("compare: purpose, chart, ranking with ranges, URL keeps the selection, AI link", async ({ page }) => {
  const problems: string[] = [];
  page.on("console", (m) => m.type() === "error" && problems.push(m.text()));
  page.on("pageerror", (e) => problems.push(e.message));
  await page.goto("/compare?cities=mumbai,chennai&metric=pm25&period=winter-2025-26");
  await expect(page.getByText("Put cities side by side over the same dates.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ranking" })).toBeVisible({ timeout: 30_000 });
  // summary strip above the chart: highest, lowest, and "too close to call" when the ranges overlap heavily
  const summary = page.getByLabel("Summary");
  await expect(summary.getByText("Highest")).toBeVisible();
  await expect(summary.getByText("Lowest")).toBeVisible();
  await expect(summary.getByText("Too close to call")).toBeVisible();
  await expect(page.getByText(/Too close to call:/)).toBeVisible();
  await expect(page.getByRole("img", { name: /95% range/ }).first()).toBeVisible();
  // add a city: the address keeps it
  await page.getByRole("button", { name: /^Delhi/ }).click();
  await expect(page).toHaveURL(/cities=mumbai%2Cchennai%2Cdelhi|cities=mumbai,chennai,delhi/);
  await expect(page.getByRole("img", { name: /PM2\.5 by day for .*Delhi/ })).toBeVisible();
  // official AQI uses its own chart
  await page.getByRole("radio", { name: "Official AQI" }).click();
  await expect(page).toHaveURL(/metric=aqi/);
  await expect(page.getByRole("heading", { name: "Official AQI by day" })).toBeVisible();
  // the AI link carries a precise question
  const href = await page.getByRole("link", { name: "Explain this with AI" }).getAttribute("href");
  expect(decodeURIComponent(href!.replace(/\+/g, " "))).toMatch(/Compare official AQI in [A-Za-z, ]+ and [A-Za-z]+ from 1 Dec 2025 to 28 Feb 2026\./);
  const body = await page.locator("main").innerText();
  expect(body).not.toMatch(/\d{4}-\d{2}-\d{2}|\blive\b/i);
  const r = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, w: document.documentElement.clientWidth }));
  expect(r.s).toBeLessThanOrEqual(r.w);
  expect(problems).toEqual([]);
});

test("compare: custom dates come from the address", async ({ page }) => {
  await page.goto("/compare?cities=delhi,mumbai&metric=pm25&start=2026-10-20&end=2026-11-05");
  await expect(page.getByRole("radio", { name: "Custom dates" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByLabel("From")).toHaveValue("2026-10-20");
  await expect(page.getByRole("heading", { name: "Ranking" })).toBeVisible({ timeout: 30_000 });
});

test("compare: official AQI for any bulletin city, and 2026 periods", async ({ page }) => {
  await page.goto("/compare?cities=delhi,mumbai&metric=aqi&period=30d");
  await expect(page.getByRole("radio", { name: "2026 so far" })).toBeVisible({ timeout: 30_000 });
  const add = page.getByRole("combobox", { name: "Add any CPCB bulletin city" });
  await add.fill("Lucknow");
  await page.getByRole("option", { name: /Lucknow/ }).click();
  await expect(page).toHaveURL(/cities=delhi(%2C|,)mumbai(%2C|,)Lucknow/);
  await expect(page.getByRole("button", { name: "Remove Lucknow" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ranking" })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("table:visible, ol:visible").filter({ hasText: "Lucknow" }).first()).toBeVisible();
  // PM2.5 is measured for the six metros only: the other city leaves the selection
  await page.getByRole("radio", { name: "PM2.5" }).click();
  await expect(page).not.toHaveURL(/Lucknow/);
});
