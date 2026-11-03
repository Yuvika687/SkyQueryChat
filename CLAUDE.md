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
- **Agent:** Pydantic AI — Groq primary, Gemini fallback
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
- OpenCity Delhi files: timestamps say `+0000` but are **IST** (verified identical to OpenAQ).

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
