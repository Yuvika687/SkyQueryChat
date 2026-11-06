import { defineConfig, devices } from "@playwright/test";

// Runs the real backend (FastAPI, local data) and the frontend together.
// Test-only rate limits are raised through env so repeated runs aren't blocked by the per-visitor limit.
export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: "http://localhost:3000", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "tablet", use: { ...devices["Desktop Chrome"], viewport: { width: 1024, height: 768 } } },
    { name: "mobile", use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } } },
  ],
  webServer: [
    {
      command: "cd .. && RATE_PER_MINUTE=60 RATE_PER_DAY=1000 .venv/bin/python -m uvicorn backend.api.main:app --port 8000 --log-level warning",
      url: "http://localhost:8000/api/health",
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: "npx next dev -p 3000",
      url: "http://localhost:3000/ask",
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
