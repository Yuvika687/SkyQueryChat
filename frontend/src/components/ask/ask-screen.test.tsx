import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureEvents } from "@/test/fixtures";
import type { ChatEvent, Health } from "@/lib/types";

vi.mock("@/lib/api", () => ({ streamChat: vi.fn(), waitForBackend: vi.fn(), getHealth: vi.fn() }));
// ECharts needs a real canvas; the chart's data is checked through the Data table view instead.
vi.mock("@/components/chart/echart", () => ({
  EChart: ({ ariaLabel }: { ariaLabel: string }) => <div role="img" aria-label={ariaLabel} />,
}));

import * as api from "@/lib/api";
import { AppProvider } from "@/components/shell/app-context";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AskScreen } from "./ask-screen";

const HEALTH: Health = {
  status: "ok", uptime_s: 1, data_loaded: true, ai_configured: true, ai_quota: { state: "ok", models: {} },
  data_windows: { measured_start: "2025-02-18", measured_end: "2026-10-30", aqi_end: "2026-10-25" },
};
const SID = "c".repeat(32);

function streamOf(events: ChatEvent[]) {
  return async function* () {
    for (const e of events) {
      await Promise.resolve();
      yield e;
    }
  };
}
function errorStream(code: string, message: string, extra: Record<string, unknown> = {}): ChatEvent[] {
  return [
    { event: "meta", data: { request_id: "r", session_id: SID } },
    { event: "error", data: { code, message, ...extra } },
    { event: "done", data: { request_id: "r", session_id: SID, status: "error", cached: false, elapsed_ms: 3 } },
  ];
}

function renderAsk() {
  return render(
    <TooltipProvider>
      <AppProvider>
        <AskScreen />
      </AppProvider>
    </TooltipProvider>,
  );
}

async function ask(q: string) {
  const user = userEvent.setup();
  const box = await screen.findByLabelText("Your question");
  await user.type(box, q);
  await user.keyboard("{Enter}");
  return user;
}

beforeEach(() => {
  vi.mocked(api.waitForBackend).mockReset().mockResolvedValue(HEALTH);
  vi.mocked(api.streamChat).mockReset();
  localStorage.clear();
});

describe("Ask screen", () => {
  it("shows the empty state with six suggested questions (an even grid) and the sources line", async () => {
    renderAsk();
    expect(await screen.findByRole("heading", { name: "What do you want to know about the air?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Compare Delhi and Mumbai over the last 30 days/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Diwali 2025 than Diwali 2024/ })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(6);
    expect(screen.getByText(/Answers use the data available and may contain gaps\. Sources: CPCB via/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open-Meteo.com" })).toHaveAttribute("href", "https://open-meteo.com/");
  });

  it("shows the model's own headline, explanation and follow-ups from a recorded live answer", async () => {
    vi.mocked(api.streamChat).mockImplementation(streamOf(fixtureEvents("compare-llm.sse")));
    renderAsk();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /Compare Delhi and Mumbai over the last 30 days/ }));
    expect(await screen.findByText(/^Delhi had a higher measured PM2.5 mean than Mumbai/)).toBeInTheDocument();
    // the explanation is split around its clickable numbers, so match the whole paragraph
    expect(screen.getByText((_, el) => el?.tagName === "P" && /the comparison covers 24 common days out of 30/.test(el.textContent ?? ""))).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "How does Bengaluru compare to Hyderabad over the last 30 days?" })).toBeInTheDocument();
    expect(screen.queryByText(/Is rain associated with lower/)).not.toBeInTheDocument();      // no template follow-ups
  });

  it("streams a live answer: timeline, answer, cards, chart, interpreted dates and evidence", async () => {
    vi.mocked(api.streamChat).mockImplementation(streamOf(fixtureEvents("compare-live.sse")));
    renderAsk();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /Compare Delhi and Mumbai over the last 30 days/ }));
    // the code-written headline leads; the model's "ranked 1" sentence is not shown
    expect(await screen.findByText(/Delhi's PM2.5 was higher than Mumbai's over the latest 30 days available/)).toBeInTheDocument();
    expect(screen.queryByText(/ranked 1/)).not.toBeInTheDocument();
    expect(vi.mocked(api.streamChat).mock.calls[0][0]).toBe("Compare Delhi and Mumbai over the last 30 days");

    // badge row: data type and numbers checked; no rank cards; short key-number labels
    expect(screen.getByText("Measured PM")).toBeInTheDocument();
    expect(screen.queryByText(/Saved answer/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Backup model/)).not.toBeInTheDocument();
    expect(screen.queryAllByText(/rank/i).filter((el) => el.closest("dl"))).toHaveLength(0);
    expect(screen.getAllByRole("button", { name: "73.0" }).length).toBeGreaterThanOrEqual(1);   // headline and key number
    expect(screen.getByLabelText("Your question")).toHaveAttribute("placeholder", "Ask about air quality in the six cities");
    // the evidence follows the answer (phone layout in tests): coverage, stations and the period in words
    const tabs = screen.getByRole("tablist", { name: "Evidence or data" });
    expect(within(tabs).getByRole("tab", { name: "Evidence" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getAllByText(/Latest 30 days available/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Stations").length).toBeGreaterThan(0);   // evidence table row
    // how the answer was made: collapsed summary, then the steps
    const summary = screen.getAllByText("How this answer was made")[0];
    await user.click(summary);
    expect(screen.getAllByText(/Checked all \d+ numbers against the analysis|Checked every number/).length).toBeGreaterThan(0);
    // the Data tab holds the table of values
    await user.click(within(tabs).getByRole("tab", { name: "Data" }));
    const table = screen.getByRole("table");
    expect(within(table).getAllByText("Delhi").length).toBeGreaterThan(0);
    // saved to recent chats
    await waitFor(() => expect(JSON.parse(localStorage.getItem("sq_recent_chats_v1") || "[]")).toHaveLength(1));
  });

  it("clicking a highlighted number opens its proof", async () => {
    vi.mocked(api.streamChat).mockImplementation(streamOf(fixtureEvents("diwali-cached.sse")));
    renderAsk();
    const user = await ask("How bad was Delhi's air on Diwali 2025?");
    await screen.findByText("Saved demo answer");
    const nums = screen.getAllByRole("button", { name: /^\d+(\.\d+)?$/ });
    expect(nums.length).toBeGreaterThan(0);
    await user.click(nums[0]);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getAllByText("Proof").length).toBeGreaterThan(0);
    expect(within(dialog).getByText("How it was worked out")).toBeInTheDocument();
    expect(within(dialog).getByText(/^Copied exactly from the analysis result\./)).toBeInTheDocument();
    expect(dialog.textContent).not.toMatch(/gemini|\d{4}-\d{2}-\d{2}|16:00/);
  });

  it("a follow-up chip asks at once and the chat is kept in this browser", async () => {
    vi.mocked(api.streamChat).mockImplementation(streamOf(fixtureEvents("compare-llm.sse")));
    renderAsk();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /Compare Delhi and Mumbai over the last 30 days/ }));
    const chip = await screen.findByRole("button", { name: "How does Bengaluru compare to Hyderabad over the last 30 days?" });
    await waitFor(() => expect(JSON.parse(localStorage.getItem("sq_recent_chats_v1") || "[]")).toHaveLength(1));
    await user.click(chip);
    await waitFor(() => expect(vi.mocked(api.streamChat)).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.streamChat).mock.calls[1][0]).toBe("How does Bengaluru compare to Hyderabad over the last 30 days?");
    await waitFor(() => expect(JSON.parse(localStorage.getItem("sq_recent_chats_v1") || "[]")[0].turns).toHaveLength(2));
  });

  it("history survives blocked storage", async () => {
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.mocked(api.streamChat).mockImplementation(streamOf(fixtureEvents("compare-llm.sse")));
    renderAsk();
    await ask("Compare Delhi and Mumbai over the last 30 days");
    // the answer still shows and its follow-ups still work, even though nothing can be saved
    expect(await screen.findByRole("button", { name: "How does Bengaluru compare to Hyderabad over the last 30 days?" })).toBeInTheDocument();
    expect(set).toHaveBeenCalled();
    set.mockRestore();
  });

  it("labels saved answers and always shows required warnings", async () => {
    vi.mocked(api.streamChat).mockImplementation(streamOf(fixtureEvents("diwali-cached.sse")));
    renderAsk();
    await ask("How bad was Delhi's air on Diwali 2025?");
    expect(await screen.findByText("Saved demo answer")).toBeInTheDocument();
    expect(screen.getByText("Official AQI is an index of several pollutants, not a PM2.5 or PM10 concentration.")).toBeInTheDocument();
    expect(screen.getAllByText("Official AQI").length).toBeGreaterThan(0);
  });

  it("labels a backup model and shows the backend notice", async () => {
    const evs = fixtureEvents("compare-live.sse").flatMap((e): ChatEvent[] =>
      e.event === "meta"
        ? [e, { event: "notice", data: { code: "fallback", message: "The main AI model is at its shared limit, so this answer uses a backup model." } }]
        : e.event === "answer"
          ? [{ ...e, data: { ...e.data, model: "gemini-3.1-flash-lite" } }]
          : [e],
    );
    vi.mocked(api.streamChat).mockImplementation(streamOf(evs));
    renderAsk();
    await ask("Compare Delhi and Mumbai over the last 30 days");
    expect(await screen.findByText("Backup model")).toBeInTheDocument();
    expect(screen.getByText(/so this answer uses a backup model/)).toBeInTheDocument();
  });

  it("quota reached: explains and offers saved answers", async () => {
    vi.mocked(api.streamChat).mockImplementation(
      streamOf(errorStream("ai_limit", "The live AI limit has been reached for now.", { demo_questions: ["How bad was Delhi's air on Diwali 2025?"] })),
    );
    renderAsk();
    await ask("Show PM2.5 in Delhi");
    expect(await screen.findByText("Today's AI limit has been reached")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Explore" })).toHaveAttribute("href", "/explore");
    expect(screen.getByRole("link", { name: "Compare" })).toHaveAttribute("href", "/compare");
    expect(screen.getByRole("button", { name: "How bad was Delhi's air on Diwali 2025?" })).toBeInTheDocument();
  });

  it("busy: shows the spec message and a Retry button", async () => {
    vi.mocked(api.streamChat).mockImplementationOnce(streamOf(errorStream("ai_busy", "The live AI is busy with other visitors right now.")));
    vi.mocked(api.streamChat).mockImplementationOnce(streamOf(fixtureEvents("compare-live.sse")));
    renderAsk();
    const user = await ask("Compare Delhi and Mumbai over the last 30 days");
    expect(await screen.findByText("The AI service is busy right now")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText(/Delhi's PM2.5 was higher/)).toBeInTheDocument();
    expect(screen.queryByText("The AI service is busy right now")).not.toBeInTheDocument();
  });

  it("rate limited: Retry waits for the Retry-After countdown", async () => {
    vi.mocked(api.streamChat).mockImplementation(
      streamOf([{ event: "error", data: { code: "rate_limited", message: "Too many questions. Please wait 30 seconds.", retry_after_s: 30 } }]),
    );
    renderAsk();
    await ask("q");
    const btn = await screen.findByRole("button", { name: /Try again in \d+ seconds/ });
    expect(btn).toBeDisabled();
    expect(screen.getByText("You've asked a lot of questions in a short time")).toBeInTheDocument();
    expect(screen.getByText(/You can ask again in \d+ seconds\./)).toBeInTheDocument();
  });

  it("request failed: plain message, no technical text, Retry", async () => {
    vi.mocked(api.streamChat).mockImplementation(
      streamOf([{ event: "error", data: { code: "network", message: "We couldn't reach the analysis service. Check your connection and try again." } }]),
    );
    renderAsk();
    await ask("q");
    expect(await screen.findByText("We couldn't reach the data server")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
    expect(document.body.textContent).not.toMatch(/TypeError|Traceback|500/);
  });

  it("backend waking: shows the start-up message", async () => {
    vi.mocked(api.waitForBackend).mockImplementation(({ onWaking } = {}) => {
      onWaking?.();
      return new Promise(() => {});
    });
    renderAsk();
    expect(await screen.findByText("Starting the analysis service. This can take a minute or two.")).toBeInTheDocument();
  });

  it("missing data: says measured data isn't available and gives the real data window", async () => {
    const evs = fixtureEvents("compare-live.sse").map((e) =>
      e.event === "answer" ? ({ ...e, data: { ...e.data, status: "unavailable", text: "There is no measured data for that period." } } as ChatEvent) : e,
    );
    vi.mocked(api.streamChat).mockImplementation(streamOf(evs));
    renderAsk();
    await ask("PM2.5 in Delhi in 2023");
    expect(await screen.findByText("Measured data isn't available for this period")).toBeInTheDocument();
    expect(screen.getByText(/18 Feb 2025 to 30 Oct 2026/)).toBeInTheDocument();
  });

  it("unsupported city: offers the six cities", async () => {
    const evs: ChatEvent[] = [
      { event: "meta", data: { request_id: "r", session_id: SID } },
      { event: "step", data: { seq: 1, type: "tool_result", title: "check_request", detail: { unsupported: ["Pune"] } } },
      {
        event: "answer",
        data: {
          status: "refused", text: "Pune isn't one of the supported cities.", explanation: "", clarifying_question: null, data_types: [],
          resolved_query: null, required_warnings: [], model: "gemini-3.5-flash-lite", verification: {},
        },
      },
      { event: "cards", data: [] }, { event: "chart", data: null }, { event: "sources", data: { sources: [], coverage: {} } }, { event: "warnings", data: [] },
      { event: "done", data: { request_id: "r", session_id: SID, status: "refused", cached: false, elapsed_ms: 9 } },
    ];
    vi.mocked(api.streamChat).mockImplementation(streamOf(evs));
    renderAsk();
    await ask("PM2.5 in Pune last month");
    expect(await screen.findByText(/SkyQueryChat covers these six cities/)).toBeInTheDocument();
    for (const c of ["Delhi", "Mumbai", "Kolkata", "Chennai", "Bengaluru", "Hyderabad"]) {
      expect(screen.getByRole("button", { name: c })).toBeInTheDocument();
    }
  });

  it("Stop cancels a running answer", async () => {
    vi.mocked(api.streamChat).mockImplementation(async function* (_q, _s, signal) {
      yield { event: "meta", data: { request_id: "r", session_id: SID } } as ChatEvent;
      yield { event: "step", data: { seq: 1, type: "run_started", title: "question received", detail: {} } } as ChatEvent;
      await new Promise<void>((resolve) => signal?.addEventListener("abort", () => resolve()));
    });
    renderAsk();
    const user = await ask("Compare Delhi and Mumbai over the last 30 days");
    const stop = await screen.findByRole("button", { name: "Stop" });
    await act(async () => {
      await user.click(stop);
    });
    expect(await screen.findByText("Stopped before the answer was ready.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
  });

  it("announces agent steps to screen readers", async () => {
    vi.mocked(api.streamChat).mockImplementation(streamOf(fixtureEvents("compare-live.sse")));
    renderAsk();
    await ask("Compare Delhi and Mumbai over the last 30 days");
    await screen.findByText(/Delhi's PM2.5 was higher/);
    const live = document.querySelector('[aria-live="polite"]');
    expect(live?.textContent).toBe("Answer ready.");
  });
});
