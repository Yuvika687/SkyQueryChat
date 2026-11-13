import { expect, test } from "@playwright/test";

// The "Data & accuracy" side panel: short sections, stored first-pass scores only.
test("data & accuracy panel", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Data & accuracy/ }).first().click();
  const panel = page.getByRole("dialog");
  for (const h of ["Latest available", "Sources and licences", "Cities and stations", "How numbers are checked", "Test results", "Cross-check with CPCB", "Known limits"]) {
    await expect(panel.getByRole("heading", { name: h })).toBeVisible();
  }
  await expect(panel.getByText("Main question set")).toBeVisible();
  await expect(panel.getByText(/\d+ of \d+/).first()).toBeVisible();
  await expect(panel.getByText("GODL-India")).toBeVisible();
  const text = await panel.innerText();
  expect(text).not.toMatch(/combined|rerun|\d{4}-\d{2}-\d{2}|\blive\b/i);   // first-pass only, readable dates
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
});
