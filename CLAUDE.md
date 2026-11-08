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

### Agent implementation (Day 2, 2026-11-05)

- Code: `backend/agent/` (models, resolver, tools, session, verify, schemas, core); terminal:
  `scripts/ask.py`; evaluation: `evals/questions.json` + `scripts/run_eval.py`.
- Model names live in `backend/config/models.json` (override: env `SKYQ_MODEL_CHAIN`). *(Replaced: on Day 2
  Groq was primary. Current live chain: see "Phase 1 clean-up (2026-11-08)" below.)* Groq `openai/gpt-oss-120b`
  needs `groq_reasoning_effort: medium` (low made Groq reject outputs). Groq free tier for this key:
  1K requests/day, 8K tokens/min, ~200K tokens/day. Gemini free quotas are only visible in AI Studio.
- Final answer is accepted from the `final_answer` output tool OR as JSON text (gpt-oss alternates).
  Groq rejects JSON mode combined with tools.
- Every number in answer/explanation/metrics must match a tool result (after rounding); metrics must
  match their own dataset. Causal wording and prompt quotes are rejected. Up to 2 retries, then a
  clear error. Tests use FunctionModel/TestModel only (no quota).

### Day 3 part 1 decisions (2026-11-05)

- Tools return `{id, type, units, period, fields, notes}`; the model writes the answer text and picks
  cards as "dataset_id.field" and a chart dataset. CODE builds card value/label/unit/source/warnings,
  the explanation and the chart. The written answer still passes the number check.
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
  gemini-3.8-flash (last resort). *(Replaced 2026-11-08: Groq disabled; see Phase 1 clean-up.)* AI Studio limits: 3.1 Flash Lite 15 RPM / 250K TPM / 500 RPD; 3.8 Flash 5 / 250K / 20.
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
- Follow-up suggestions are templates filled only from `resolved_query`.
- Tests: `npm test` (Vitest, recorded real SSE fixtures), `npm run e2e` (Playwright, backend + frontend,
  screenshots in `docs/screenshots/ask/`).
- Known gap: the backend's city comparison chart is a bar of means, not the spec's multi-line; scatter has no
  trend line (would need a Python-calculated line).

### Phase 1 clean-up (2026-11-08)

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

### Phase 2: Ask screen polish (2026-11-08)

- **Headline:** `backend/agent/lead.py` writes the answer's lead sentence in analyst wording from what the final
  answer already holds (cards, chart points, coverage, resolved period). It must pass `check_numbers` and the causal
  check, or it is dropped and the model's text leads. Sent as `answer.headline` (live, cached and saved demo answers).
  The model's `answer` text is unchanged (evaluation still scores it); the UI shows it only as support for
  multi-dataset answers. Small counts are written as words ("six cities") so no unverified number appears.
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

- **Day 1:** Setup, API checks, station selection, data pipeline, Parquet dataset
- **Day 2:** Analysis functions, typed tools, agent loop, number verification
- **Day 3:** FastAPI streaming, chat interface, charts, execution timeline
- **Day 4:** Testing, UI polish, deployment, README, demo

Testing must include:
- Unit tests for every analysis function
- A set of test questions covering all five question types
- Tool-selection checks
- A check that answer numbers match tool outputs
- A sample comparison against official CPCB data where available

Deployment notes:
- Render free service sleeps, restarts with temporary local storage, and has limited memory.
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

## 9. Environment notes (discovered during setup, 2026-11-02)

- Python 3.13.15 in `.venv` (run tools via `.venv/bin/python`). Node v26.7.0, npm 11.19.0.
- **Node 26 became LTS on 28 October 2026.** Still confirm the chosen Next.js version
  officially supports Node 26 before starting the frontend (Day 3).
- **DuckDB 2.0:** relations no longer have `fetchone()`. Use
  `con = duckdb.connect(); con.execute(sql).fetchone()` (or `.fetchall()` / `.df()`).
- **Sophos SSL inspection** is active on this machine. pip showed an untrusted-certificate
  retry once; `httpx` reached `api.openaq.org` fine. If HTTPS calls fail with
  `CERTIFICATE_VERIFY_FAILED`, that is the cause — do not disable SSL verification.
- `data/raw/` is gitignored; `data/processed/` (Parquet) is committed.
- Sophos also breaks TLS for some hosts more often (GitHub API, S3). macOS `/usr/bin/curl`
  and authenticated `gh` usually work; anonymous GitHub API is rate-limited on this network IP.
  Never disable verification.
