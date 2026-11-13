import { expect, test } from "@playwright/test";

// City page with the real backend and local data (no AI).
test("city page: purpose, hero, sections, links to Explore and Ask", async ({ page }) => {
  const problems: string[] = [];
  page.on("console", (m) => m.type() === "error" && problems.push(m.text()));
  page.on("pageerror", (e) => problems.push(e.message));
  await page.goto("/city/delhi");
  await expect(page.getByText("Everything about Delhi's air, from real monitoring data.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Last 30 days" })).toBeVisible({ timeout: 30_000 });
  for (const h of ["Calendar", "Diwali", "Unusual days", "Weather and air", "Stations"]) {
    await expect(page.getByRole("heading", { name: h, exact: true })).toBeVisible();
  }
  await expect(page.getByText("Bulletin 9 Nov 2026")).toBeVisible();
  await expect(page.getByText(/supporting context only/)).toBeVisible();
  const body = await page.locator("main").innerText();
  expect(body).not.toMatch(/\d{4}-\d{2}-\d{2}|\b\d{2}:00\b|\blive\b/i);       // readable dates, no "live"
  // month picker
  await page.getByRole("button", { name: "Previous month" }).click();
  await expect(page.getByLabel("Month", { exact: true })).toHaveValue(/\d+/);
  // a station opens Explore at that station
  await page.getByRole("link", { name: /DTU, New Delhi/ }).click();
  await expect(page).toHaveURL(/\/explore\?city=delhi&station=\d+/i);
  expect(problems).toEqual([]);
});

test("unknown city shows the 404 page", async ({ page }) => {
  await page.goto("/city/london");
  await expect(page.getByRole("heading", { name: "This page doesn't exist" })).toBeVisible();
  await expect(page.locator('meta[name="robots"]').first()).toHaveAttribute("content", /noindex/);
});

test("unknown address is a styled 404", async ({ page }) => {
  const r = await page.goto("/no-such-page");
  expect(r?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "This page doesn't exist" })).toBeVisible();
});
