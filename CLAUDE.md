# SkyQueryChat — Project Rules for Claude Code

SkyQueryChat is an agentic AI-powered conversational air quality platform for Indian cities.

Claude acts as the user's **Senior Full-Stack AI Engineer and mentor**. The user is learning
while building: explain important decisions in simple language *before* implementing them.

## 1. Product scope

A chat app that answers natural-language questions using real data and Python analysis.

- **Cities:** Delhi, Mumbai, Kolkata, Chennai, Bengaluru, Hyderabad
- **Pollutants:** PM2.5 and PM10 only

Essential features:
- Natural-language chat with follow-up questions
- Historical trends and city comparisons
- Diwali comparisons where data exists
- Unusual pollution day detection
- Weather and pollution relationship analysis
- Interactive charts and metric cards
- A live agent execution timeline
- Source, data type and coverage shown with every answer

**Do NOT build:** all-India coverage, satellite processing, custom ML forecasting, login,
multilingual support, or arbitrary Python execution.

## 2. Technology stack

- **Frontend:** Next.js, TypeScript, Tailwind CSS, shadcn/ui, Apache ECharts
- **Backend:** Python, FastAPI, Server-Sent Events
- **Agent:** Pydantic AI — Gemini 3.5 Flash-Lite primary; Gemini 3.1 Flash Lite and Gemini 3.8 Flash as fallbacks
  (live order 2026-11-08). Groq gpt-oss-120b is configured but disabled (kept for testing).
- **Data:** OpenAQ, Open-Meteo Air Quality, Open-Meteo Weather, DuckDB, Parquet, pandas
- **Hosting:** Vercel (frontend), Render (backend)

The deployed app uses its own Groq and Gemini API keys. The Claude Pro plan is only for
building with Claude Code.

## 3. Known facts — VERIFY before depending on them

These came from earlier research. Confirm each before relying on it; report any change.

OpenAQ:
- Limits were 60 requests/minute and 2,000/hour. Respect rate-limit headers; retry safely on 429.
- CPCB feed was reported stale after 2026-10-07 14:30 UTC; other providers stayed current.
  Do not assume it has recovered.
- `/countries?iso=IN` filter was reported as ignored. Confirm the correct India filter and
  validate every returned location.
- `locality` may be missing — assign stations to cities by coordinates + radius.
- Long measurement requests may time out — fetch in slices of ≤ 30 days.
- Daily averages must use Indian local dates (IST, Asia/Kolkata), not UTC dates.

Open-Meteo:
- Global air quality is modelled, ~3-hourly at ~45 km resolution from August 2022.
- Weather history is available, with free-use limits and required attribution.
- Modelled data may underestimate severe pollution events in South Asia.

## 4. Data rules

- Real data only. **Never** create fake or synthetic pollution readings.
- Label every result as **measured** or **modelled**.
- Never mix measured and modelled values in one number without saying so.
- Store provider, sensor type, units, station count and coverage.
- Separate reference monitors from low-cost sensors.
- Clean invalid values without hiding them; record what was removed.
- Preprocess data into Parquet; query it with DuckDB.
- If OpenAQ is not usable, STOP and explain the evidence and options before changing the data plan.

Diwali dates live in a verified config file:
- Verified: 2024 = Thu 31 Oct (Delhi celebrated 31 Oct–1 Nov; include both nights),
  2025 = Mon 20 Oct, 2026 = Sun 8 Nov (DoPT holiday lists; Drik Panchang).
- If 2026 data is not available yet, the agent must say so instead of guessing.
- Use the same stations across years wherever possible.
- Compare each festival period against a pre-festival baseline (dates fall at different
  points in the season).

### Source rules (agreed 2026-11-03; evidence in docs/data-source-check.md)

- **Archive first:** OpenAQ S3 archive for history; API only for station discovery,
  metadata and recent data.
- **Never treat AQI and PM2.5 as the same metric.**
- CPCB bulletin data (UrbanEmissions `AQI_bulletins`) is shown as **official measured AQI**
  (city average, past 24 h up to 4 PM — Diwali night shows in the D+1 bulletin).
- US embassy/consulate data is **supporting, single-station** only.
- Open-Meteo for Diwali is **clearly labelled modelled context**, never the main evidence.
- Measured Diwali 2025 vs 2026 only after 8 Nov 2026 **and only if coverage is sufficient**.
- If the app has no measured data for a period, it must say so.
- OpenCity Delhi files: timestamps say `+0000` but are **IST** (verified identical to OpenAQ
  for values ≤ 999). **OpenCity blanks every value > 999 µg/m³.**
- **Diwali (decided 2026-11-03):** CPCB bulletin AQI is the MAIN Diwali comparison for all six
  cities, including Delhi. Delhi OpenCity PM2.5/PM10 is SUPPORTING context only, always shown
  with the >999 blanking warning and blank rates. **Never calculate or show PM % changes for
  Diwali 2024 vs 2025.** Same rule for Delhi Diwali 2025 vs 2026 unless a source without the
  999 limit is verified. Other five cities: measured Diwali 2025 PM is marked incomplete
  (reason stored separately; user text: "Measured PM data is incomplete for Diwali 2025.").
- Festival days = D and D+1; baseline = D−14…D−8; bulletins aligned to D+1, D+2 (4 PM period).

### Value rules (decided 2026-11-03)

- Invalid (removed, counted with reason): values ≤ 0 and values > 5,000 µg/m³.
- Values > 1,000 µg/m³ are KEPT and flagged (real Diwali peaks reach ~1,800).
- Sensor-fault patterns (flat-lines of identical values, isolated spikes that nearby stations
  do not show) are FLAGGED for review, never deleted without clear evidence.
- Never impute blank readings. Label a blank as "blanked by source limit" only where the
  source proves it (OpenCity blank where OpenAQ has a value > 999 at the same time);
  otherwise it is "missing or blank".
- Archive/OpenCity timestamps mark the END of each interval: hour = floor(ts − interval).
  Old-format OpenAQ (to ~2026-08-17) truly lacks readings ending 00:00/00:15/00:30 IST.
- Recent days the archive has not published yet are "not yet available", not outages.
- City value = equal-weight mean of valid station-days, needs ≥ max(3, ceil(50%)) of primary
  stations. Comparisons use a fixed station group. A date with a network-wide gap is low
  quality for comparisons even if stations reach 16 valid hours.
- Narela, Najafgarh and the four Hyderabad outskirt stations (Patancheru, Ramachandrapuram,
  Pashamylaram, Kandi) stay out of primary city averages (possible later additions).

### Data design rules

- Never average overlapping hourly windows (API `/hours` can return `:00` and `:30` periods).
- Calculate coverage ourselves; ignore the API `coverage` field.
- **2022-11-01 → 2025-02-18 is a hard gap**: never treat a date range as continuous across it,
  never stitch old and new sensors into one series.
- Select sensors by their **own** first/last dates, not location dates.
- City assignment = distance **and** station name names the city (25 km alone mixes in
  Noida/Ghaziabad/Gurugram/Faridabad, Navi Mumbai/Thane, Howrah).
- Track hourly OpenAQ API use (only the per-minute window is in headers); show outages as "no data".
- Exclude provider "N/A" locations unless verified. Keep low-cost sensors in a separate tier.

### Analysis rules (decided 2026-11-04)

- **Diwali: AQI LEVELS, categories and exact bulletin dates are the main result** (festival bulletins
  D+1, D+2). **No percentage in the default answer.** Only when a user asks: `diwali_aqi_percent`
  (baseline D-7..D-1; single figure only if the D-14..D-8, D-7..D-1 and D-3..D-1 baselines agree
  within 25 points, otherwise a range). Charts label each point with its bulletin date and CPCB's
  4 PM-to-4 PM period. Never say Diwali caused a rise (AQI often rises beforehand). (approved 2026-11-04)
- Default analysis value excludes flat-line hours (>= 6 identical h), UNSUPPORTED isolated-spike
  hours, and physically impossible station-days: PM2.5 > PM10 + max(20% x PM10, 20 ug/m3) on either
  the station-day means or >= 16 matched hours. Supported spikes are KEPT: verified Diwali nights
  (18:00-06:00 on D and D+1) or corroborated by another clean same-city station within +-1 h (>= 50%
  of the value and > 2x the city median). Data stays stored; every result reports what was excluded
  or kept. Peer-outlier station-days are flagged only.
- PM-only AQI estimates (scripts/crosscheck_bulletins.py) are a data check, never shown as AQI.
- Data quality is a severity level per city-date (none/minor/moderate/severe; network/local),
  not a single flag. Severe days are excluded from weather associations.
- Weather (Open-Meteo reanalysis) is MODELLED, kept in its own table, IST dates, CC BY 4.0 with
  attribution "Weather data by Open-Meteo.com" + Copernicus C3S. Free tier is non-commercial.
  Weather results are associations, never causes.
- Every analysis result carries data type, source, dates, stations, coverage, quality,
  warnings, units, method and a chart spec (backend/analysis/result.py).
- Deploy ONLY `data/app/` (about 3 MB). `data/processed/` is the rebuild source; `data/raw/` is never
  committed or deployed.

## 5. Agent rules

Real agent loop: plan → call tool → inspect result → continue if needed → verify → answer.

Predefined, typed tools for:
- Resolving cities, dates, events and pollutants
- Loading air quality and weather data
- Trend, comparison, spike and weather analysis
- Creating typed chart specifications

Rules:
- The LLM must never invent or calculate pollution numbers. Python performs every calculation.
- Tools return summaries and dataset IDs, not large raw tables.
- Before responding, check that every number in the answer came from a tool result.
- State the metric, dates, stations and coverage used.
- Detect unusual days with a rolling-median approach and explain the method.
- Describe weather results as **associations, not causes**.
- If data is missing or too thin, say so clearly.
- Keep token use low. Check live free-tier limits; handle rate limits with retries,
  fallback and caching.

### Agent implementation (2026-11-05)

- Code: `backend/agent/` (models, resolver, tools, session, verify, schemas, core); terminal:
  `scripts/ask.py`; evaluation: `evals/questions.json` + `scripts/run_eval.py`.
- Model names live in `backend/config/models.json` (override: env `SKYQ_MODEL_CHAIN`). *(Replaced: Groq was
  primary until 2026-11-06. Current live chain: see "Gemini-only chain, timeouts and limits" below.)* Groq `openai/gpt-oss-120b`
  needs `groq_reasoning_effort: medium` (low made Groq reject outputs). Groq free tier for this key:
  1K requests/day, 8K tokens/min, ~200K tokens/day. Gemini free quotas are only visible in AI Studio.
- Final answer is accepted from the `final_answer` output tool OR as JSON text (gpt-oss alternates).
  Groq rejects JSON mode combined with tools.
- Every number in answer/explanation/metrics must match a tool result (after rounding); metrics must
  match their own dataset. Causal wording and prompt quotes are rejected. Up to 2 retries, then a
  clear error. Tests use FunctionModel/TestModel only (no quota).

### Answer building, evaluation and API decisions (2026-11-05)

- Tools return `{id, type, units, period, fields, notes}`; the model writes the answer text and picks
  cards as "dataset_id.field" and a chart dataset. CODE builds card value/label/unit/source/warnings
  and the chart. The written answer still passes the number check. *(Explanation: see "LLM-written answers".)*
- Chennai and other non-Delhi Diwali answers use official AQI only; measured PM status is a warning.
- Warn when a flag-only peer-outlier station moves a city value by > 25% (`peer_outlier_major`).
- PM-only AQI estimates stay internal; known limits (incl. Delhi 481 vs 351) in
  `backend/config/known_limits.json` (served at /api/limits).
- Evaluation: per-run folders `evals/runs/`; first-pass runs are the main result, reruns separate;
  scores per model; references computed independently (`evals/references.py`); Groq test
  (`evals/groq_test.json`) runs Groq-only with a quota guard; holdout (`evals/holdout.json`) is never
  used for tuning.
- API: `backend/api/` (FastAPI). Demo protection: per-visitor rate limits, per-question token cap,
  daily token budget, answer cache + demo answers (`data/app/demo_answers.json`), clear AI-limit
  message; data endpoints never call an LLM.

### Shared AI quota (2026-11-06)

- Owner's AI Studio limits for `gemini-3.5-flash-lite`: 15 RPM, 250,000 TPM, 500 RPD (resets at midnight
  Pacific). Stored with Groq's and a placeholder for `gemini-3.8-flash` in `models.json` → `quota.providers`.
- One limiter per model for all visitors (`backend/agent/quota.py`): caps = limit × 0.8; public stops at 85%
  of daily caps (15% demo reserve, unlocked by `X-Demo-Token` = env `DEMO_ACCESS_TOKEN`). Minute limits wait
  in a FIFO queue (≤ 20 s); daily limits skip to the next model. A new question needs room for 4 requests
  (measured max; mean 2.43 over 61 questions, `scripts/measure_requests.py`). Separate daily token budget
  per model; the old single 150K budget is gone. SSE `notice` event for low quota, backup model, or a
  saved answer; `ai_limit`/`ai_busy` errors when nothing has room.
- Chain (owner's order, 2026-11-06): gemini-3.5-flash-lite → gemini-3.1-flash-lite → Groq gpt-oss-120b →
  gemini-3.8-flash (last resort). *(Replaced 2026-11-08: Groq disabled; see "Gemini-only chain, timeouts and limits".)* AI Studio limits: 3.1 Flash Lite 15 RPM / 250K TPM / 500 RPD; 3.8 Flash 5 / 250K / 20.
  AI Studio "usage" figures are 28-day peaks, not today's use. Google 429s name the quota per project
  per model (`...PerProjectPerModel-FreeTier`, `model` dimension), so Gemini models do not share quota.

### Pre-frontend fixes (2026-11-06)

- Seasons accept year-first and loose forms ("2025 post-monsoon", "winter of 2025", "2025-26 winter"); a
  season with no year uses the latest one and says so. Periods in our own "start..end" format are accepted.
- Every answer carries `resolved_query` (city/cities, pollutant, start/end, assumptions) built by code from
  what the tools used, and `required_warnings` (999 limit, AQI is an index, not causal, modelled weather,
  association, peer outlier, PM incomplete, no data) that come first and are never truncated.
- Evaluation: `expect.resolved` checks cities/pollutant/dates; a wrong period fails. Headline first-pass
  scores never change; `scripts/rescore_runs.py` writes later re-scoring (resolved check, lenient wording)
  to `evals/rescored/`, listed separately. Holdout v1 retired; `evals/holdout2.json` is the clean holdout.
- Visitor = hashed IP from True-Client-IP / CF-Connecting-IP (env CLIENT_IP_HEADERS); X-Forwarded-For and
  X-Visitor-Id are not trusted. Check after deploy with `/api/visitor`.
- The model no longer describes defaults; code reports assumptions.

### Frontend foundation + Ask screen (2026-11-06)

- `frontend/`: Next.js 16.4.5 (needs Node >= 20.9; Node 26 OK), TypeScript, Tailwind 4, shadcn/ui (Base UI),
  ECharts 6 (tree-shaken), Lucide. Cache Components is on: request data (searchParams, cookies) must sit in Suspense.
- Browser calls the backend directly (`NEXT_PUBLIC_API_BASE_URL`) so rate limits see each visitor's IP. The only
  server route is the owner demo proxy (`/api/demo/*`): DEMO_ACCESS_TOKEN stays server-side; the browser gets an
  httpOnly HMAC cookie.
- Chat stream: fetch + own SSE parser (`src/lib/sse.ts`), turn state is a pure reducer (`src/lib/chat-state.ts`),
  backend step events map to the spec's 7 plain-language steps (`src/lib/timeline.ts`).
- Charts render the backend chart spec (`src/lib/chart-options.ts`): straight lines, missing days inserted as nulls
  so lines break (backend omits them), AQI never with PM reference lines, bars from zero, modelled = dashed violet.
- CPCB AQI colours verified from CPCB "About_AQI.pdf" fill colours: Poor is #FF6500 (backend had #FF9900; fixed).
  UI uses the spec's dark-tuned hexes. India PM10 24-h reference line = 100 ug/m3 (NAAQS; CPCB breakpoint table).
- Answer sources now include `stations` (count / count_by_city / tier) for the evidence bar.
- Follow-up suggestions: the model's own (see "LLM-written answers"); templates filled from `resolved_query` only
  when it gives none.
- Tests: `npm test` (Vitest, recorded real SSE fixtures), `npm run e2e` (Playwright, backend + frontend,
  screenshots in `docs/screenshots/ask/`).
- Known gap: the backend's city comparison chart is a bar of means, not the spec's multi-line; scatter has no
  trend line (would need a Python-calculated line).

### Gemini-only chain, timeouts and limits (2026-11-08)

- **Live chain:** gemini-3.5-flash-lite → gemini-3.1-flash-lite → gemini-3.8-flash. Groq gpt-oss-120b stays in
  `models.json` with `"enabled": false` (and its quota limits) for later testing; it is never built into the live
  chain or listed in `/api/health` / `/api/quota`. `scripts/run_eval.py --set groq` still runs it explicitly.
  `ai_configured` now means GEMINI_API_KEY is set.
- **Per-request timeout:** `limits.model_request_timeout_s` = 20 s per model request (provider call incl. SDK
  retries, not the quota queue). A timeout moves to the next model; if every model times out the chat returns
  error `model_timeout` ("The AI models took too long to respond…"). The whole question still stops at
  `QUESTION_TIMEOUT_S` (60 s).
- **One token cap:** `limits.max_tokens_per_question` = 12,000 is the run's hard cap AND the quota reservation per
  new question (`quota.question_tokens` removed). Measured max on current code 9,825 (holdout2). Env
  `TOKENS_PER_QUESTION` may only lower it.
- **Rate limits:** production defaults 4/min, 30/day per visitor. Raised values (Playwright: 60/min, 1000/day) work
  only locally; when `RENDER` is set or `SKYQ_ENV=production`, values above the defaults are ignored. `/api/health`
  shows the active `rate_limits`.

### Ask screen layout, answer wording and charts (2026-11-08)

- **Headline:** *(Replaced 2026-11-12: the model writes the headline; `backend/agent/lead.py` is now only the
  last-resort fallback. See "LLM-written answers".)* lead.py writes a lead sentence in analyst wording from what the
  final answer holds (cards, chart points, coverage, resolved period) and must pass `check_numbers` and the causal
  check. Small counts are written as words ("six cities") so no unverified number appears.
- AQI is written as bulletin values (whole numbers) in headlines; key numbers round AQI half-up for display; the data
  table and CSV keep exact values.
- `city_trend` chart frequency now defaults by period length (daily <= 92 days, weekly <= 1 year, else monthly); the
  summary values are the same. check_request's "relative to the latest data" note is carried into resolved_query
  when the model passes the resolved dates on (so the UI can say "latest 30 days available").
- Ask layout: insight first; one data-type badge; key-number strip (max 3, no rank cards, short labels); chart with
  quiet icon actions; one evidence row with expandable details (interpreted query, method, sources, notes); required
  warnings as a compact always-visible list. The agent panel shows only while the agent runs; afterwards each answer
  has a compact expandable summary. A corrected number is "Corrected a number before answering" (done, not a warning).
- Top bar on Ask: no city/pollutant selectors (the question decides them); a read-only context label follows the
  latest answer's resolved_query. Selectors stay for Explore.
- Charts: Diwali lines one colour each, Diwali day as a labelled vertical line (label above the plot), festival band
  unlabelled with a key above the chart; reference-line labels right of the plot; zoom only above 62 points.
- Figures use Inter tabular digits (`num` utility): JetBrains Mono gave decimals a full-width dot ("43 . 7").
- Review screenshots: `npx playwright test e2e/review.spec.ts` -> `docs/screenshots/review/after/`.

### LLM-written answers (2026-11-12)

- **Answers are LLM-written and number-verified.** The model's `final_answer` holds `answer` (the headline, 1-2
  sentences), `explanation` (1-3 sentences) and `follow_ups` (2-3 questions), in the same final response (no extra
  request). Python still does every calculation; the model only copies numbers from tool fields.
- `check_numbers`, the causal-wording check and the prompt-quote check run on `answer` AND `explanation`. A failure
  goes back to the model to correct (`output_retries`). **Only if every correction fails** (or the token cap is hit
  after a failed check) does code write the answer from tool results (`lead.py`); then
  `verification.answer_source = "code_fallback"` and the timeline shows a warning. Otherwise `answer_source = "llm"`.
  `verification.corrections` records why earlier attempts were rejected (one short line each).
- Follow-ups are suggestions, not claims: one with an unsupported number, causal wording or a prompt quote is
  DROPPED (no retry). Years in the data range and counts up to 31 are allowed. None left ->
  `follow_ups_source = "template"` and the UI uses its templates.
- `FinalAnswer.headline` = `answer`. `FinalAnswer.method` = the code-written data type / stations / coverage / method
  text (shown under Evidence details). Saved answers without `method` are older: their `explanation` was that code text.
- **Plan step:** the model writes one short sentence before its first tool call; it is shown as the plan if it has
  no numbers beyond the user's own, no causal wording and no prompt text (`backend/agent/plan.py`). Otherwise code
  describes the model's tool calls in plain words. Raw prompts and tool schemas are never shown.
- Token cost: fixed prompt +659 characters per model request (about 165 tokens). Saved demo answers: +690 tokens per
  question without a correction, max 8,575 (cap 12,000). Details in docs/data-source-check.md Part 12.
- `scripts/build_demo_answers.py --only 2,5` rebuilds chosen demo answers and prints model, tokens, time and
  verification per question.

### Diwali 2026 data refresh (2026-11-12)

- **Data ends:** measured PM 2026-11-11 (OpenAQ archive to 2026-11-08, then the OpenAQ API for 9-11 Nov); official AQI
  2026-11-11; weather 2026-11-11. Values for earlier dates did not change (checked table by table).
- **Bulletins:** UrbanEmissions `AQI_bulletins` still ends 2026-10-25. Later bulletins are read from CPCB's own PDFs
  (`backend/pipeline/cpcb_bulletins.py`, cache `data/raw/bulletins/cpcb_pdfs/`); the reader matched UrbanEmissions
  exactly on 1,501 overlapping city-days. Every bulletin row keeps its `source`; answers name both sources when mixed.
  If a festival bulletin is missing, stop and tell the user (never guess).
- **OpenAQ API top-up** (`backend/pipeline/openaq_api.py`, `build_dataset.py --api-topup`): only for location-days the
  archive has not published, written in the archive's file format (same cleaning, validity, fault-flag and gap rules);
  cached in `data/raw/openaq_api/` and replaced by archive files on a later refresh. Keep each API window short (a few
  days): a 10-day window per sensor was very slow.
- The station snapshot's sensor "last" dates are not an end: sensors active at the snapshot are requested to the build
  end, and `station_candidates.json` "last" dates are moved forward from API results (selection unchanged).
- **Weather:** `fetch_weather.py --append` adds only new days; existing rows are never refetched or changed.
- **Delhi Diwali 2026 PM** comes from OpenAQ (keeps values above 999) and is NEVER compared with 2024/2025 (OpenCity,
  999 blanking, different panel); required warning `not_comparable_years`. The 25-27 Oct 2026 OpenAQ outage falls on the
  baseline days, so no station meets the baseline rule: no baseline, festival-day values from stations valid on both
  festival days (status `baseline_incomplete`). Diwali night 2026 has a Delhi gap (fewer than half of stations
  reporting 23:00-03:00 IST), so festival-day PM is an underestimate.
- **Evaluation:** questions whose correct answer changed with new data carry `data_changed` (with `expect_before`);
  published scores are unchanged. All-data references follow `DATA_END` from `data/app/manifest.json`. New set
  `evals/diwali2026.json` (8 questions, references in `diwali2026_refs`); first pass 9/9 turns (separate scoreboard set).

### Diwali review follow-ups (2026-11-12)

- Bengaluru and Hyderabad share a 2026 week-before baseline of 64.6: a real coincidence (different daily values, both
  sum to 452 over bulletins 2-8 Nov). A test checks every baseline against that city's own bulletin rows.
- **Delhi measured PM around Diwali (any year) is offered to the model only when the question mentions PM**
  (`PM_ASKED` in `backend/agent/tools.py`; the tool is hidden by `only_if_pm_asked` and refuses as a backstop). Default
  Diwali answers use official AQI only. Follow-up suggestions that pair 2026 PM with 2024/2025 are dropped.
- The OpenAQ not-comparable warning is one text (`NOT_COMPARABLE_FULL`), so it is shown once; the PM result gives the
  festival days (8 and 9 Nov 2026) as a field.
- Known limit `delhi_estimate_above_official_2026` (for the Accuracy page): our PM-only estimate averages +28.6 above
  official Delhi AQI on the new bulletins (+6.5 over all days).

### Deployment settings (2026-11-12)

- Backend: `render.yaml` (free web service, Singapore, one uvicorn worker, health check `/api/health`, build filter so
  frontend/docs changes do not redeploy). Python pinned by `.python-version` (3.13.15); Render's default is now 3.14.
  Frontend: Vercel Hobby, root directory `frontend`, Node pinned by `engines` (26.x).
- **Production** (`RENDER` set, or `SKYQ_ENV=production`; `backend/runtime.py`): visitor limits capped at 4/min and
  30/day; Gemini-only chain even if a Groq entry is enabled; `SKYQ_MODEL_CHAIN`, `SKYQ_PROVIDER_LIMITS`,
  `SKYQ_QUOTA_SAFETY_MARGIN` and `SKYQ_DEMO_RESERVE` are ignored; `ALLOWED_ORIGINS` has no localhost default and drops
  `*` and non-https entries.
- `requirements.txt` is production only (no pytest, no Groq SDK, no pdfplumber, no truststore); local tools are in
  `requirements-dev.txt`. The API reads only code, `backend/config/`, `data/app/` and `evals/scoreboard.json`.
- **Memory** (Linux amd64 container, 512 MB, 0.1 CPU): peak 283 MiB after loading data and serving all data endpoints
  (was 408 MiB before: single-threaded Parquet reads, `ARROW_DEFAULT_MEMORY_POOL=system`, one DuckDB thread, the store
  loaded once). Startup to healthy: 25 s native, 72 s under emulation, so a cold visitor waits about a minute plus
  that; the frontend waits up to 150 s and shows "Starting the analysis service".

### Design system, navigation and Home (branch `redesign`, 2026-11-13)

- Chosen design: direction A's visual style (navy, teal accent, Instrument Serif headlines with Inter, soft glow,
  rounded glass cards) with direction C's layouts (Home: map plus ranked cities; Ask: answer left, evidence right).
  Direction B is dropped. Work happens on branch `redesign`; it is not merged to main.
- Tokens in `frontend/src/app/globals.css` (`--sq-*`, `--cat-*` for CPCB data colours only, radius, shadows,
  `glass` utility). Fonts via next/font. Components in `frontend/src/components/ds/`: CategoryBadge, ScaleBar,
  Sparkline, StatNumber (counts up; reduced motion shows the value), AskBox, CityCard, Skeleton, ErrorState,
  WakeUpState, FadeIn (Framer Motion, `MotionConfig reducedMotion="user"`).
- Navigation: floating top bar (desktop) and bottom tab bar (phone); the old sidebar is gone. Chat history moved to
  the Ask page ("New chat", "Recent chats"). "Data & accuracy" panel reads `/api/accuracy` (stored first-pass scores).
- Home reads `GET /api/latest` (latest date every city has a valid PM2.5 city value, highest first, 7-day series,
  stations reporting, map position = mean of primary stations). Read-only, no LLM, cached per process.
- Map: MapLibre GL 6 + OpenFreeMap dark style with border/label/road layers removed, official India outline from
  `frontend/public/geo/india-official.geojson` (Survey of India via DataMeet, CC0); SVG outline fallback. MapLibre 6
  needs its worker file served: `scripts/copy-maplibre-worker.mjs` copies it to `public/maplibre/` on predev and
  prebuild (gitignored). The map is static (no scroll-zoom or drag); markers are React buttons laid over it.
  Label sides are fixed per city (Mumbai and Bengaluru left; on phones Mumbai above) so labels never overlap.
- Ask accepts `/ask?q=...` (starts a new chat, sends once, then clears the address). Answer text is shown through
  `readable()` (ISO dates -> "9 Nov 2026", "16:00" -> "4 PM"); numbers are untouched.
- "Very poor" chips use dark text (#1A0404): white on #EF4444 is only 3.8:1.
- *(Replaced 2026-11-13: Explore, the city pages and Compare are built; see below.)* Explore and Compare were placeholder pages.

### Home polish and Explore (branch `redesign`, 2026-11-13)

- Home: the "Latest available" badge shows only below the `lg` width (the nav chip shows it on wide screens). The map
  card picks the first spot that covers no other city's label or marker, and that city's own label hides while it is
  open. Phones: suggested questions are one sideways-scrolling row, city cards are compact (two rows), the page has
  bottom padding for the tab bar.
- `GET /api/explore?pollutant=pm25|pm10` (read-only, cached per pollutant): the latest 30 available days (ending on
  the `/api/latest` date) for every station with data in that window: metadata (provider, tier, monitor type, lat/lon,
  km from centre, last reading UTC) plus each day's 24-hour mean and valid hours. A value needs >= 16 valid hours;
  otherwise `values[i]` is null and `valid_hours[i]` says how many hours there were (the map shows grey "not enough
  data"); no row at all = no readings. City values per day use the normal city rule. About 50 KB per pollutant.
- Explore (`/explore`): MapLibre map (shared setup in `src/lib/map-base.ts`), city markers then station markers (DOM
  buttons inside MapLibre markers, painted outside React components), left panel (ranking, then the city's station
  list = accessible alternative to the map), right station panel, date slider over 30 days with play (0.8 s per day;
  no autoplay with reduced motion), PM2.5/PM10 toggle, low-cost sensor toggle (real AirGradient sensors exist), legend.
  View in the address: `?city=&station=&pollutant=&date=`. Phones: bottom sheet (peek/half/full; drag or tap the handle).
  Logic in `src/lib/explore.ts` (tests in `explore.test.ts`); Playwright: `e2e/explore.spec.ts`, `e2e/explore-phone.spec.ts`.
- "Ask about this station" opens a city question for the 30-day window (the analyst works on city averages, which
  include the station); the panel says so.
- Memory (Linux container, 512 MB, 0.1 CPU, both explore payloads built): peak 284 MiB. The first `/api/explore`
  request takes about 8 s at 0.1 CPU under emulation (0.06 s natively), then it is cached.
- The MapLibre worker copy runs as `predev` and `prebuild` (package.json), so `npm run build` on Vercel includes it.

### Explore map fixes and Ask redesign (branch `redesign`, 2026-11-13)

- Explore basemap: Explore keeps OpenFreeMap roads, water names and place names from zoom 7 (Home keeps land and water
  only); every `boundary*` layer is removed on both. City outlines: `frontend/public/geo/city-outlines.geojson`, built by
  `frontend/scripts/build-city-outlines.py` from DataMeet's Census 2011 districts (CC BY 2.5 India; shapefile read
  directly, no GIS library). Delhi = its 9 districts; Mumbai = Mumbai + Mumbai Suburban; Bengaluru = Bangalore district.
- Station markers are MapLibre layers (dots; low-cost sensors are SDF diamonds), value labels use symbol collision,
  the selected/hovered station is larger and always labelled. The list is the keyboard path (focus highlights the dot).
  Fly-in padding keeps the left panel, the station panel area and the timeline clear.
- Severe is CPCB maroon `#7A0E12` (white text 11:1), with a light edge on dark backgrounds.
- Ask: conversation left, right panel with Evidence / Data tabs; a clicked number swaps the panel to its Proof (Back
  button); phones show evidence under the answer and the proof as a bottom sheet. Clickable numbers and proof content:
  `src/lib/proof.ts` (a number is clickable only when it equals a card value or chart point at the precision written).
  Live steps: `src/components/ask/live-steps.tsx` (real stream events; the model name only inside "How this answer was
  made").
- Answer wording: instructions ask for readable dates and "4 PM" times, no "date(s)"/"noting that", no bracketed
  definitions, but the answer must keep requested values and key caveats. The number checker now checks readable dates
  ("9 Nov 2026", "9–10 Nov 2026", "13 Oct – 11 Nov 2026", "Nov 9, 2026"): each day must be a tool date (dates are kept in
  the allowed set as `DATE_CODE + yyyymmdd`); "PM2.5 November" is not a date. The evaluation scorer matches readable
  dates against ISO expectations (`iso_dates` in `scripts/run_eval.py`).

### Statistics, city pages, Compare and release polish (2026-11-13)

- `backend/analysis/stats.py` (numpy only; tests check it against scipy, a dev dependency): Mann-Kendall + Sen's slope
  (direction only when p < 0.05; "not enough data" under 20 valid days), weekly block-bootstrap 95% ranges (fixed seed),
  Spearman with a Fisher-z 95% range, "too close to call" when neighbouring ranges overlap by at least half of the
  narrower one. `city_trend`, `compare_cities` (now a multi-line daily chart) and `weather_relationship` (scatter plus a
  Python-calculated Theil-Sen line) carry these. The checker allows the label "95% range"; `trend_conflicts` rejects
  trend wording that contradicts the trend test. Eval set `evals/analysis.json` (references in `analysis_refs`, scipy).
- Read-only `backend/analysis/pages.py`: `/api/city/{city}`, `/api/compare`, `/api/compare/periods` (cached; compare
  cache bounded). Frontend `/city/[slug]` (six static slugs; params read inside Suspense, unknown slug shows not-found),
  `/compare` (selection in the address), styled 404, `error.tsx` and `global-error.tsx` (this Next version passes
  `retry`), sitemap, robots, icon, static `public/og.png`.
- `/api/accuracy` adds `answer_wording_since` and the CPCB cross-check agreement figures only (never the PM-only
  estimates). The panel shows first-pass scores and marks runs measured with an earlier wording.
- Home draws the official outline as SVG at once and loads MapLibre when the browser is idle (Lighthouse desktop: Home
  99/100/100/100, Ask 100 x4). Explore has no zoom buttons on phones (pinch; axe target size).
- `e2e/a11y.spec.ts` runs axe on every page at three sizes (zero serious/critical).
- Memory (Linux amd64 container, 512 MB, 0.1 CPU): peak 305 MiB after every data, city and compare endpoint. The first
  city page takes about 15 s there under emulation (0.36 s natively), then it is cached.

### Final UI touches (main, 2026-11-13)

- Nav: frosted, mostly opaque pill plus a fade band behind it. Map credits: MapLibre's compact attribution ("ⓘ",
  collapsed at start; top right on phones) built from `CREDIT_ITEMS` / `CREDITS_HTML` in `src/lib/map-base.ts`; the
  basemap's own attribution is removed so nothing is listed twice; the same list is in the Data & accuracy panel.
- Home map has no box: glow behind India, edges faded by a CSS mask on the canvas only (never on markers or credits).
  The basemap loads on the first interaction or after 6.5 s (official outline drawn at once): Lighthouse Home 99/100/100/100.
- Explore: no zoom buttons; Mumbai's label left of its dot (as Home); slim timeline ("Showing <date>", "Latest
  available" on the last day, "Play last 30 days", 1x/2x, mini chart of daily averages, Diwali marker); station search;
  map padding is clamped to the canvas (MapLibre refuses to fit, and stays at the world origin, when padding is too big).
- Trends under 90 days are the total change over the period (`change_over_period` = Sen's slope per day x (days - 1)),
  with "Short periods include seasonal change."; the agent field is `trend_change_over_period`. Time-axis labels always
  carry the month.
- Day-over-day change is calculated in Python (`/api/latest` `change`, from the displayed one-decimal values, only when
  the previous calendar day has a value). CPCB health statements: `src/lib/health.ts`, verbatim from the bulletin's
  "Health Statements for AQI Categories".
- Evaluation quota guard (`backend/agent/eval_guard.py`, called by `scripts/run_eval.py`): counts today's evaluation runs
  (since midnight Pacific) plus the live server's `/api/quota` visitor use, refuses to start when the run would pass the
  public caps, and seeds the shared limiter (`ProviderQuota.seed`). The live counter resets on a server restart.
- Lazily loaded components do not forward refs: the chart handle for PNG export is a plain `handle` prop.

### Verify, explain and wake faster (main, 2026-11-14)

- **Official AQI chip:** `/api/latest` cities carry `official_aqi` (CPCB 4 PM bulletin for the SAME date, from
  `city_daily_aqi`; `{"available": false}` when the bulletin is missing, never estimated); `/api/explore` cities carry a
  per-date `aqi` list; the city hero repeats it. UI: `OfficialAqiChip` (Home cards, map hover card, Explore city list, city
  hero). PM stays the main figure, labelled "PM2.5 concentration (µg/m³), not AQI". Data & accuracy has "Check our numbers"
  (CPCB bulletin link: https://cpcb.gov.in/AQI_Bulletin.php) and a "Short terms" glossary.
- **Full forms:** `src/lib/glossary.ts` + `Term` (`src/components/ds/term.tsx`): tooltip on hover, keyboard focus
  (focus-visible only) and tap, portalled so cards never clip it. Inside a link or button use `plain` (an `<abbr>`; no
  nested controls). Each page's intro line writes the full forms; later mentions use `Term`. None in charts, tables or the map.
- **Cold start:** the port opens after the imports; data loads in a background thread (requests wait; `/api/health` is
  503 "starting" until then), then Home's result is built and the agent stack (Pydantic AI, ~40% of import time) is
  imported. `main.py` imports the agent lazily (`_agent()`, `_SharedQuota`); `ERROR_TEXT` lives in `backend/agent/errors.py`,
  windows come from `R.set_windows_from_store`. Measured (arm64 container, 0.1 CPU, 512 MB): ready 26.5–28.2 s -> 17.9–18.9 s;
  first `/api/latest` 27.7–28.9 s -> 19.6–21.0 s. Every page also sends an early no-cors `/api/health` ping from `<head>`.
  Keep-awake steps: `docs/keep-awake.md` (backend `https://skyquerychat-api.onrender.com`).

## 6. UI requirements

Premium, dark, responsive AI analytics SaaS interface:
- Deep navy background, one teal accent colour
- Professional typography, monospaced figures
- Left sidebar: history, city selection, suggested questions
- Center: chat with metric cards and inline charts
- Right panel: agent timeline, sources, coverage
- Pollution calendar heatmap and Diwali event bands
- Warning badge for modelled or incomplete data

Use official Indian AQI category colours **only** for data meaning.

## 7. Roadmap

- **Data:** setup, API checks, station selection, data pipeline, Parquet dataset
- **Analysis and agent:** analysis functions, typed tools, agent loop, number verification
- **API and interface:** FastAPI streaming, chat interface, charts, execution timeline
- **Release:** testing, UI polish, deployment, README, demo

Testing must include:
- Unit tests for every analysis function
- A set of test questions covering all five question types
- Tool-selection checks
- A check that answer numbers match tool outputs
- A sample comparison against official CPCB data where available

Deployment notes:
- Render free service (0.1 CPU, 512 MB) sleeps after 15 minutes idle, takes about a minute to wake, restarts with
  temporary local storage; 750 free instance hours per workspace per month.
- Ship the processed Parquet data with the app.
- Cache several demo answers so the demo still works if an LLM quota runs out.

## 8. Working rules

- Work one module at a time. Never generate the whole app at once.
- Test each module with real output before building on it.
- Do not call anything complete until it has been tested.
- Tell the user if the plan needs to change, and why.
- Keep the architecture simple and the code maintainable.
- Never ask the user to paste an API key into chat. They add keys to `.env` themselves.
- Never print, hardcode or commit secrets.
- No Claude co-author / attribution lines in commits or PRs.
- At the end of each step: say what changed, how it was tested, and what comes next.
- Never use phase or day labels ("Phase 1", "Day 2", "Sprint 3" and similar) in commit messages, documentation,
  code, comments, test names or the UI. Describe the change itself instead (e.g. "Improve Ask screen layout").
  Existing evaluation run IDs that contain "day2" are stored identifiers and stay as they are.

## 9. Environment notes (discovered during setup, 2026-11-02)

- Python 3.13.15 in `.venv` (run tools via `.venv/bin/python`). Node v26.7.0, npm 11.19.0.
- `pdfplumber` 0.11.4 (requirements-dev.txt) reads CPCB bulletin PDFs during data builds; never deployed.
- Local development installs `requirements-dev.txt` (production deps plus pytest, groq, pdfplumber, truststore).
- Docker Desktop is installed (start with `open -a Docker`); used to measure memory in a Linux container.
- **Node 26 became LTS on 28 October 2026.** Still confirm the chosen Next.js version
  officially supports Node 26 before starting the frontend.
- **DuckDB 2.0:** relations no longer have `fetchone()`. Use
  `con = duckdb.connect(); con.execute(sql).fetchone()` (or `.fetchall()` / `.df()`).
- **Sophos SSL inspection** is active on this machine. pip showed an untrusted-certificate
  retry once; `httpx` reached `api.openaq.org` fine. If HTTPS calls fail with
  `CERTIFICATE_VERIFY_FAILED`, that is the cause — do not disable SSL verification.
- `data/raw/` is gitignored; `data/processed/` (Parquet) is committed.
- Sophos also breaks TLS for some hosts more often (GitHub API, S3). macOS `/usr/bin/curl`
  and authenticated `gh` usually work; anonymous GitHub API is rate-limited on this network IP.
  Never disable verification.
