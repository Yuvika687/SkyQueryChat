import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Screenshots for visual review land in docs/screenshots/ask/<project>-<name>.png
const SHOTS = join(__dirname, "..", "..", "docs", "screenshots", "ask");
mkdirSync(SHOTS, { recursive: true });

const SAVED_Q = "How bad was Delhi's air on Diwali 2025?"; // a cached demo answer: real backend, no AI quota
const LIVE_Q = "Show PM2.5 levels in Kolkata for the last 30 days"; // a suggested question
// Recorded answer to LIVE_Q (live run 2026-11-08 replayed through the current backend; no AI quota in e2e).
const KOLKATA = readFileSync(join(__dirname, "..", "src", "test", "fixtures", "kolkata-replay.sse"), "utf8");
const SID = "d".repeat(32);

// ------------------------------------------------------------------ helpers
function watchConsole(page: Page, allow: RegExp[] = []) {
  const problems: string[] = [];
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (allow.some((r) => r.test(t))) return;
    problems.push(t);
  });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  return problems;
}

async function expectNoOverflow(page: Page) {
  const r = await page.evaluate(() => {
    const w = document.documentElement.clientWidth;
    const wide = [...document.querySelectorAll("body *")]
      .filter((e) => {
        const b = e.getBoundingClientRect();
        if (b.width === 0 || b.height === 0) return false;
        // ignore content inside horizontal scrollers (e.g. the data table)
        for (let p = e.parentElement; p; p = p.parentElement) {
          const s = getComputedStyle(p);
          if (s.overflowX === "auto" || s.overflowX === "scroll" || s.overflowX === "hidden") return false;
        }
        return b.right > w + 1;
      })
      .slice(0, 5)
      .map((e) => `${e.tagName}.${String(e.className).slice(0, 50)}`);
    return { scroll: document.documentElement.scrollWidth, w, wide };
  });
  expect(r.wide, `elements wider than the viewport: ${r.wide.join(", ")}`).toEqual([]);
  expect(r.scroll).toBeLessThanOrEqual(r.w);
}

async function shot(page: Page, info: TestInfo, name: string) {
  await page.waitForTimeout(400); // let charts finish their 200 ms animation
  await page.screenshot({ path: join(SHOTS, `${info.project.name}-${name}.png`) });
}

async function askVia(page: Page, q: string) {
  const box = page.getByLabel("Your question");
  await box.fill(q);
  await box.press("Enter");
}

const isDesktop = (info: TestInfo) => info.project.name === "desktop";

function sse(events: [string, unknown][]): string {
  return events.map(([e, d], i) => `id: ${i}\nevent: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join("");
}
const errorBody = (code: string, message: string, extra: Record<string, unknown> = {}) =>
  sse([
    ["meta", { request_id: "r1", session_id: SID }],
    ["step", { seq: 1, type: "run_started", title: "question received", detail: {}, ts: new Date().toISOString() }],
    ["error", { code, message, request_id: "r1", ...extra }],
    ["done", { request_id: "r1", session_id: SID, status: "error", cached: false, elapsed_ms: 40 }],
  ]);

async function mockChat(page: Page, fulfil: Parameters<Page["route"]>[1]) {
  await page.route("**/api/chat", fulfil);
}

// ------------------------------------------------------------------ tests
test.describe("Ask screen", () => {
  test("empty state", async ({ page }, info) => {
    const problems = watchConsole(page);
    await page.goto("/ask");
    await expect(page.getByRole("heading", { name: "What do you want to know about the air?" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Compare Delhi and Mumbai over the last 30 days/ })).toBeVisible();
    // freshness: full text on wider screens; icon + screen-reader text on phones
    await expect(page.getByText(/Station data to 30 Oct 2026/).first()).toBeAttached();
    await expectNoOverflow(page);
    await shot(page, info, "01-empty");
    expect(problems).toEqual([]);
  });

  test("saved answer from the real backend: answer, chart, table, evidence, timeline", async ({ page }, info) => {
    const problems = watchConsole(page);
    await page.goto("/ask");
    await askVia(page, SAVED_Q);
    await expect(page.getByText("Saved demo answer")).toBeVisible();
    await expect(page.getByText(/Delhi's air was Very Poor over Diwali 2025/)).toBeVisible();
    await expect(page.getByText("Official AQI is an index of several pollutants, not a PM2.5 or PM10 concentration.")).toBeVisible();
    const nums = page.getByLabel("Key numbers");
    await expect(nums).toContainText("352");
    await expect(nums).toContainText("Very poor");
    const evidence = page.getByRole("region", { name: "Evidence" });
    await expect(evidence).toContainText("Official AQI");
    await expect(evidence).toContainText("CPCB city bulletin");
    await page.locator("article").first().evaluate((e) => e.scrollIntoView());
    await expectNoOverflow(page);
    await shot(page, info, "02-answer-saved");

    // evidence details: interpreted dates, stations, method and sources
    await evidence.getByRole("button", { name: "Details" }).click();
    await expect(page.getByRole("region", { name: "How the question was read" })).toContainText("6 Oct 2025 – 24 Oct 2025");
    await expect(evidence).toContainText(/Stations chosen by CPCB/);
    await expectNoOverflow(page);

    // data table + CSV
    await page.getByRole("tab", { name: "Data table" }).click();
    await expect(page.getByRole("table")).toContainText("2025-10-21");
    await page.getByRole("table").scrollIntoViewIfNeeded();
    await shot(page, info, "03-data-table");
    const dl = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download CSV" }).click();
    expect((await dl).suggestedFilename()).toMatch(/\.csv$/);

    // after the answer the steps panel is gone; a compact summary expands to the steps
    await expect(page.getByRole("complementary", { name: "Agent steps" })).toHaveCount(0);
    const summary = page.getByRole("button", { name: /Agent steps: .*Corrected a number before answering/ });
    await summary.click();
    await expect(page.getByText("Checking every number")).toBeVisible();
    await expect(page.getByText("Done with a warning")).toHaveCount(0); // a fixed number is not a warning
    await summary.scrollIntoViewIfNeeded();
    await expectNoOverflow(page);
    await shot(page, info, "04-agent-steps");
    expect(problems).toEqual([]);
  });

  test("recorded live answer: Kolkata trend", async ({ page }, info) => {
    const problems = watchConsole(page);
    await mockChat(page, (route) => route.fulfill({ status: 200, headers: { "Content-Type": "text/event-stream" }, body: KOLKATA }));
    await page.goto("/ask");
    await page.getByRole("button", { name: new RegExp(LIVE_Q) }).click();
    await expect(page.getByText(/Kolkata's PM2\.5 averaged 45\.3 µg\/m³ over the latest 30 days available/)).toBeVisible();
    const evidence = page.getByRole("region", { name: "Evidence" });
    await expect(evidence).toContainText("Measured");
    await expect(evidence).toContainText(/% coverage/);
    await expect(evidence).toContainText("Latest 30 days available");
    if (info.project.name !== "mobile") await expect(page.getByLabel("Current conversation")).toContainText("Kolkata");
    await expect(page.getByRole("img", { name: /Kolkata PM2\.5/ })).toBeVisible();
    await page.locator("article").first().evaluate((e) => e.scrollIntoView());
    await expectNoOverflow(page);
    await shot(page, info, "05-answer-live");
    expect(problems).toEqual([]);
  });

  test("streaming: timeline and answer skeleton while the agent works", async ({ page }, info) => {
    test.skip(!isDesktop(info), "one streaming capture is enough");
    // Hold the stream open after the first steps (route.fulfill would close it), by answering /api/chat
    // from an in-page ReadableStream that never ends.
    await page.addInitScript((sid: string) => {
      const real = window.fetch.bind(window);
      window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        if (!String(input instanceof Request ? input.url : input).endsWith("/api/chat")) return real(input, init);
        const now = Date.now();
        const ts = (ms: number) => new Date(now + ms).toISOString();
        const evs: [string, unknown][] = [
          ["meta", { request_id: "r1", session_id: sid }],
          ["step", { seq: 1, type: "run_started", title: "question received", detail: {}, ts: ts(0) }],
          ["step", { seq: 2, type: "model_request", title: "asking the model", detail: {}, ts: ts(10) }],
          ["step", { seq: 3, type: "plan", title: "Plan: city_trend", detail: { steps: [{ tool: "city_trend", args: { city: "Kolkata", pollutant: "PM2.5", period: "last 30 days" } }] }, ts: ts(1800) }],
          ["step", { seq: 4, type: "tool_call", title: "city_trend", detail: { args: { city: "Kolkata", pollutant: "PM2.5", period: "last 30 days", freq: "D" } }, ts: ts(1802) }],
          ["step", { seq: 5, type: "tool_result", title: "city_trend: PM2.5 trend in Kolkata", detail: { dataset_id: "ds1", data_type: "measured", fields: 11, warnings: 1 }, ts: ts(1840) }],
        ];
        const enc = new TextEncoder();
        const body = new ReadableStream({
          start(c) {
            for (const [e, d] of evs) c.enqueue(enc.encode(`event: ${e}\ndata: ${JSON.stringify(d)}\n\n`));
          },
        });
        return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
      };
    }, SID);
    await page.goto("/ask");
    await askVia(page, LIVE_Q);
    const panel = page.getByRole("complementary", { name: "Agent steps" });
    await expect(panel).toContainText("Running the calculation");
    await expect(page.getByRole("status", { name: "Loading answer" })).toBeVisible();
    await shot(page, info, "06-streaming");
  });

  for (const s of [
    { name: "07-quota-reached", body: errorBody("ai_limit", "The live AI limit has been reached for now (it resets in about 9 h). Cached answers, demo questions and the data pages still work. Please try a live question later.", { demo_questions: [SAVED_Q, "Which of the six cities had the highest PM2.5 in winter 2025?"] }), expect: "Live AI limit reached" },
    { name: "08-busy", body: errorBody("ai_busy", "The live AI is busy with other visitors right now. Please try again in about a minute.", { demo_questions: [SAVED_Q] }), expect: "The AI service is busy. Try again in a moment." },
    { name: "09-request-failed", body: errorBody("internal", "Something went wrong. Please try again."), expect: "The answer couldn't be completed" },
  ]) {
    test(`state: ${s.name}`, async ({ page }, info) => {
      const problems = watchConsole(page);
      await mockChat(page, (route) => route.fulfill({ status: 200, headers: { "Content-Type": "text/event-stream" }, body: s.body }));
      await page.goto("/ask");
      await askVia(page, "What was Delhi's average PM2.5 in March 2026?");
      await expect(page.getByText(s.expect)).toBeVisible();
      await expectNoOverflow(page);
      await shot(page, info, s.name);
      expect(problems).toEqual([]);
    });
  }

  test("state: rate limited (HTTP 429 with Retry-After)", async ({ page }, info) => {
    const problems = watchConsole(page, [/429/]);
    await mockChat(page, (route) =>
      route.fulfill({
        status: 429,
        headers: { "Content-Type": "application/json", "Retry-After": "38", "Access-Control-Allow-Origin": "*", "Access-Control-Expose-Headers": "Retry-After" },
        body: JSON.stringify({ error: { code: "rate_limited", message: "Too many questions. Please wait 37 seconds.", request_id: "r" } }),
      }),
    );
    await page.goto("/ask");
    await askVia(page, "What was Delhi's average PM2.5 in March 2026?");
    await expect(page.getByText("Too many questions. Please wait 37 seconds.")).toBeVisible();
    await expect(page.getByRole("button", { name: /Retry in \d+ s/ })).toBeDisabled();
    await shot(page, info, "10-rate-limited");
    expect(problems).toEqual([]);
  });

  test("state: backend waking up", async ({ page }, info) => {
    await page.route("**/api/health", () => {
      /* never answer: like a sleeping Render service */
    });
    await page.goto("/ask");
    await expect(page.getByText("Starting the analysis service. This can take a minute or two.")).toBeVisible({ timeout: 15_000 });
    await expectNoOverflow(page);
    await shot(page, info, "11-backend-waking");
  });

  test("state: no measured data for the period (real backend)", async ({ page }, info) => {
    const problems = watchConsole(page);
    await page.goto("/ask");
    await askVia(page, "What was Delhi's AQI on Diwali 2026?"); // cached demo answer: data not available yet
    const main = page.getByRole("main");
    // spec message until shortly after the festival; afterwards the general official-AQI message
    await expect(main.getByText(/Diwali 2026 falls on 8 November\. Data isn't available yet\.|Official AQI isn't available for this period/)).toBeVisible({ timeout: 30_000 });
    await expect(main.getByRole("region", { name: "Evidence" })).toContainText("No bulletins found");
    await expect(main.getByText(/Diwali 2026/).nth(1)).toBeVisible();
    await page.locator("article").first().evaluate((e) => e.scrollIntoView());
    await expectNoOverflow(page);
    await shot(page, info, "12-no-data");
    expect(problems).toEqual([]);
  });

  test("keyboard: reach a suggestion, send it, and see focus", async ({ page }, info) => {
    test.skip(info.project.name === "mobile", "keyboard check runs on desktop and tablet");
    await page.goto("/ask");
    await page.getByRole("button", { name: new RegExp("Was Delhi worse around Diwali") }).focus();
    const outline = await page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle);
    expect(outline).not.toBe("none");
    await shot(page, info, "13-keyboard-focus");
    await page.getByLabel("Your question").focus();
    await page.keyboard.type(SAVED_Q);
    await page.keyboard.press("Enter");
    await expect(page.getByText("Saved demo answer")).toBeVisible();
  });
});
