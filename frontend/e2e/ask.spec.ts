import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Ask page with the real backend and local data. Saved demo answers and recorded streams only: no AI quota.
const SHOTS = join(__dirname, "..", "..", "docs", "screenshots", "ask");
mkdirSync(SHOTS, { recursive: true });

const SAVED_Q = "How bad was Delhi's air on Diwali 2025?"; // a saved demo answer from the backend
const COMPARE = readFileSync(join(__dirname, "..", "src", "test", "fixtures", "compare-llm.sse"), "utf8"); // recorded live answer
const SID = "d".repeat(32);
const isDesktop = (info: TestInfo) => (info.project.use.viewport?.width ?? 0) >= 1024;

function watchConsole(page: Page) {
  const problems: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") problems.push(m.text()); });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  return problems;
}

async function expectNoOverflow(page: Page) {
  const r = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, w: document.documentElement.clientWidth }));
  expect(r.scroll).toBeLessThanOrEqual(r.w);
}

async function askVia(page: Page, q: string) {
  const box = page.getByLabel("Your question");
  await box.fill(q);
  await box.press("Enter");
}

function sse(events: [string, unknown][]): string {
  return events.map(([e, d], i) => `id: ${i}\nevent: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join("");
}
const errorBody = (code: string, message: string, extra: Record<string, unknown> = {}) =>
  sse([
    ["meta", { request_id: "r1", session_id: SID }],
    ["error", { code, message, request_id: "r1", ...extra }],
    ["done", { request_id: "r1", session_id: SID, status: "error", cached: false, elapsed_ms: 40 }],
  ]);

/** Answers every chat request with a recorded stream and counts the requests. */
async function recordedChat(page: Page, body = COMPARE) {
  const seen: string[] = [];
  await page.route("**/api/chat", async (route) => {
    seen.push(JSON.parse(route.request().postData() || "{}").message);
    await route.fulfill({ status: 200, headers: { "Content-Type": "text/event-stream" }, body });
  });
  return seen;
}

test.describe("Ask page", () => {
  test("empty state: purpose, hint and suggestions", async ({ page }) => {
    const problems = watchConsole(page);
    await page.goto("/ask");
    await expect(page.getByText("Ask any question about air quality in the six cities.")).toBeVisible();
    await expect(page.getByText("Click any highlighted number to see where it came from.")).toBeVisible();
    await expect(page.getByRole("button", { name: /Compare Delhi and Mumbai over the last 30 days/ })).toBeVisible();
    await expectNoOverflow(page);
    expect(problems).toEqual([]);
  });

  test("saved answer: badge, checked numbers, notes, evidence and data", async ({ page }, info) => {
    const problems = watchConsole(page);
    await page.goto("/ask");
    await askVia(page, SAVED_Q);
    await expect(page.getByText("Saved demo answer")).toBeVisible();
    const card = page.locator("article").first();
    await expect(card.getByText("Official AQI", { exact: true }).first()).toBeVisible();
    await expect(card.getByText(/\d+ numbers checked/)).toBeVisible();
    await expect(card.getByText("Official AQI is an index of several pollutants, not a PM2.5 or PM10 concentration.")).toBeVisible();
    await expect(card.getByText(/\d{4}-\d{2}-\d{2}|16:00/)).toHaveCount(0);            // readable dates and times only
    const tabs = page.getByRole("tablist", { name: "Evidence or data" });
    await expect(tabs.getByRole("tab", { name: "Evidence" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText("How this answer was made").first()).toBeVisible();
    await tabs.getByRole("tab", { name: "Data" }).click();
    await expect(page.getByRole("table")).toContainText("21 Oct 2025");
    if (isDesktop(info)) await expect(page.getByRole("complementary", { name: "Evidence" })).toBeVisible();
    await expectNoOverflow(page);
    expect(problems).toEqual([]);
  });

  test("clicking a highlighted number opens its proof, and Back returns", async ({ page }, info) => {
    await page.goto("/ask");
    await askVia(page, SAVED_Q);
    await expect(page.getByText("Saved demo answer")).toBeVisible();
    await page.locator("article").first().getByRole("button", { name: "352" }).first().click();
    const proof = isDesktop(info) ? page.getByRole("complementary", { name: "Proof" }) : page.getByRole("dialog");
    await expect(proof).toBeVisible();
    await expect(proof.getByText("How it was worked out")).toBeVisible();
    await expect(proof.getByText(/Mean of the 2 festival bulletins/)).toBeVisible();
    await expect(proof.getByText(/^Copied exactly from the analysis result\./)).toBeVisible();
    await expect(proof).not.toContainText(/gemini/i);                                      // the model is named only in the steps
    await proof.getByRole("button", { name: isDesktop(info) ? "Back to evidence" : "Close" }).click();
    if (isDesktop(info)) await expect(page.getByRole("complementary", { name: "Evidence" })).toBeVisible();
    else await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("a follow-up chip asks at once; history keeps the chat", async ({ page }) => {
    const seen = await recordedChat(page);
    await page.goto("/ask");
    await askVia(page, "Compare Delhi and Mumbai over the last 30 days");
    const chip = page.getByRole("button", { name: /How does Bengaluru compare to Hyderabad over the last 30 days\?/ });
    await expect(chip).toBeVisible();
    await chip.click();
    await expect.poll(() => seen.length).toBe(2);
    expect(seen[1]).toBe("How does Bengaluru compare to Hyderabad over the last 30 days?");
    await expect(page.locator("article")).toHaveCount(2);
    // history: start a new chat, then reopen the saved one
    await page.getByRole("button", { name: "New chat" }).click();
    await expect(page.locator("article")).toHaveCount(0);
    await page.getByRole("button", { name: /Recent chats/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Compare Delhi and Mumbai over the last 30 days", exact: true }).click();
    await expect(page.locator("article")).toHaveCount(2);
  });

  test("/ask?q= asks once, with no double submit", async ({ page }) => {
    const seen = await recordedChat(page);
    await page.goto("/ask?q=" + encodeURIComponent("Compare Delhi and Mumbai over the last 30 days"));
    await expect(page.getByText(/numbers checked/).first()).toBeVisible();
    await page.waitForTimeout(800);
    expect(seen).toEqual(["Compare Delhi and Mumbai over the last 30 days"]);
    await expect(page).toHaveURL(/\/ask$/);                                                  // the address is cleared
  });

  test("states: rate limited, daily AI limit and a failed request", async ({ page }) => {
    let mode = "rate";
    await page.route("**/api/chat", async (route) => {
      if (mode === "rate") {
        // the real backend exposes Retry-After to the browser (CORS); the mock must do the same
        await route.fulfill({ status: 429, headers: { "Retry-After": "40", "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*", "Access-Control-Expose-Headers": "Retry-After" },
          body: JSON.stringify({ error: { code: "rate_limited", message: "Too many questions." } }) });
      } else if (mode === "quota") {
        await route.fulfill({ status: 200, headers: { "Content-Type": "text/event-stream" }, body: errorBody("ai_limit", "The live AI limit has been reached for now.") });
      } else {
        await route.abort("failed");
      }
    });
    await page.goto("/ask");
    await askVia(page, "Delhi PM2.5 last week");
    await expect(page.getByText("You've asked a lot of questions in a short time")).toBeVisible();
    await expect(page.getByText(/You can ask again in \d+ seconds\./)).toBeVisible();
    await expect(page.getByRole("button", { name: /Try again in \d+ seconds/ })).toBeDisabled();

    mode = "quota";
    await page.getByRole("button", { name: "New chat" }).click();
    await askVia(page, "Delhi PM2.5 last week");
    await expect(page.getByText("Today's AI limit has been reached")).toBeVisible();
    await expect(page.getByRole("main").getByRole("link", { name: "Explore" })).toHaveAttribute("href", "/explore");
    await expect(page.getByRole("main").getByRole("link", { name: "Compare" })).toHaveAttribute("href", "/compare");

    mode = "fail";
    await page.getByRole("button", { name: "New chat" }).click();
    await askVia(page, "Delhi PM2.5 last week");
    await expect(page.getByText("We couldn't reach the data server")).toBeVisible();
    await expect(page.getByRole("button", { name: "Try again" })).toBeEnabled();
    expect(await page.locator("body").innerText()).not.toMatch(/TypeError|Traceback/);
  });
});
