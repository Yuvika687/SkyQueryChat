import { expect, test } from "@playwright/test";

// Phone layout: full-screen map with a bottom sheet holding the same content.
test.use({ launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] } });
test.skip(({ viewport }) => (viewport?.width ?? 1000) >= 768, "phone layout only");

test("bottom sheet: pick a city from the list, open a station, nothing hidden by the tab bar", async ({ page }) => {
  await page.goto("/explore");
  const sheet = page.getByRole("region", { name: "Explore panel" });
  await expect(sheet).toBeVisible();
  await page.getByRole("button", { name: "Show more" }).click();               // the handle also works without dragging
  await sheet.getByRole("button", { name: /^Kolkata/ }).click();
  await expect(page).toHaveURL(/city=kolkata/);
  await sheet.getByRole("list", { name: "Kolkata stations" }).getByRole("button").first().click();
  await expect(sheet.getByRole("link", { name: "Ask about this station" })).toBeVisible();
  await expect(page).toHaveURL(/station=\d+/);
  const bar = await page.getByRole("navigation", { name: "Main" }).last().boundingBox();
  const box = await sheet.boundingBox();
  expect(box!.y + box!.height).toBeLessThanOrEqual(bar!.y + 1);                // the sheet ends above the tab bar
});
