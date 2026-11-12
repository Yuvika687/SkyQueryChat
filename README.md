# SkyQueryChat

An agentic, conversational air-quality analytics app for six Indian cities
(Delhi, Mumbai, Kolkata, Chennai, Bengaluru, Hyderabad), covering PM2.5 and PM10.

Ask questions in plain English: trends, city comparisons, Diwali impact, unusual
pollution days and weather associations. Every answer is computed in Python from
real data (OpenAQ measurements, Open-Meteo models) and shows its source, data type
(measured vs modelled) and coverage. The AI model writes the answer, explanation and follow-up questions; every
number it writes is checked against the calculated results before the answer is shown.

## Stack
- **Frontend:** Next.js, TypeScript, Tailwind CSS, shadcn/ui, Apache ECharts (Vercel)
- **Backend:** Python, FastAPI, Server-Sent Events (Render)
- **Agent:** Pydantic AI — Gemini 3.5 Flash-Lite primary; Gemini 3.1 Flash Lite and Gemini 3.8 Flash as fallbacks.
  Groq gpt-oss-120b is configured but disabled (kept for testing).
- **Data:** OpenAQ, Open-Meteo, pandas, Parquet, DuckDB

## Status
- Done: data pipeline and processed dataset (`data/processed/`), weather, app tables (`data/app/`),
  analysis functions (`backend/analysis/`), the agent (`backend/agent/`) and FastAPI with SSE streaming
  (`backend/api/`).
- Frontend (`frontend/`): app shell and the **Ask** screen are built (chat, agent timeline, cards, charts,
  evidence bar). **Explore** and **Accuracy** are not built yet.
- Data: measured PM and official AQI to 11 Nov 2026 (includes Diwali 2026); weather to 11 Nov 2026.
- Deployment settings are ready (`render.yaml`, see "Deploy"); not deployed yet. Evidence and rules: `docs/data-source-check.md`; UI spec: `docs/ui-design-spec.md`.

## Rebuild the dataset
```bash
pip install -r requirements-dev.txt     # dev only: adds truststore for TLS-inspecting proxies
python scripts/build_dataset.py         # downloads/caches raw data, rebuilds data/processed
python scripts/fetch_weather.py         # Open-Meteo daily weather (6 requests)
python scripts/derive_app_tables.py     # compact app tables in data/app (deploy only these)
# refresh with new days only (cached archive; API for days the archive has not published; bulletin PDFs after
# UrbanEmissions' last date; weather appended without changing stored rows):
python scripts/build_dataset.py --api-topup && python scripts/fetch_weather.py --append && python scripts/derive_app_tables.py
pytest                                  # pipeline, analysis and real-data tests
```

## Ask questions in the terminal
```bash
python scripts/ask.py                                   # interactive, follow-ups keep context
python scripts/ask.py "Delhi PM2.5 in November 2025?"   # one question (add --json for the typed answer)
python scripts/run_eval.py                              # live evaluation, paced for free tiers
```
Models are configured in `backend/config/models.json` (override with `SKYQ_MODEL_CHAIN`).

## Run the API
```bash
uvicorn backend.api.main:app --port 8000
curl -N -X POST localhost:8000/api/chat -H 'Content-Type: application/json' \
     -d '{"message":"How bad was Delhi'"'"'s air on Diwali 2025?"}'      # Server-Sent Events
```
Endpoints: `POST /api/chat` (SSE), `GET /api/health`, `/api/meta`, `/api/visitor`, `/api/quota`,
`/api/limits`, `/api/stations`, `/api/cities`, `/api/cities/{city}/summary`, `/api/trends`, `/api/coverage`,
`/api/diwali/{city}`, `/api/accuracy`. Docs at `/api/docs`. Environment: `ALLOWED_ORIGINS`, `RATE_PER_MINUTE`,
`RATE_PER_DAY` (production ignores values above 4/min and 30/day; production is `RENDER` set or `SKYQ_ENV=production`), `TOKENS_PER_QUESTION` (may only lower the
12,000 cap in `models.json`), `QUESTION_TIMEOUT_S`, `CLIENT_IP_HEADERS`, `DEMO_ACCESS_TOKEN` (optional owner pass
that may use the reserved daily quota, sent as `X-Demo-Token`), `SKYQ_PROVIDER_LIMITS`,
`SKYQ_QUOTA_SAFETY_MARGIN`, `SKYQ_DEMO_RESERVE`, `SKYQ_MODEL_CHAIN` (the last four are for local testing and are
ignored in production) (keys stay in the backend `.env`; the frontend never
sees them).

Shared AI quota: every model request from every visitor goes through one limiter per model
(`backend/agent/quota.py`, limits in `backend/config/models.json` → `quota`). Caps are the provider
limits × 0.8; public visitors stop at 85% of the daily caps, the rest is kept for the demo. Minute limits
wait in a shared queue (up to 20 s), daily limits skip to the next model, and when no model has room the
chat says so and still serves saved answers. `python scripts/measure_requests.py` measures requests per
question from saved evaluation runs.

Each model request times out after 20 s (`limits.model_request_timeout_s`) and the next model is tried.

## Run the frontend
```bash
cd frontend
cp .env.example .env.local      # NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
npm install
npm run dev                     # http://localhost:3000/ask
npm test                        # Vitest (recorded SSE fixtures, no AI quota)
npm run e2e                     # Playwright: starts backend + frontend, screenshots in docs/screenshots/ask/
```

## Deploy
- **Backend (Render, free web service):** New → Blueprint → this repository; `render.yaml` sets the build and start
  commands, Python 3.13.15 (`.python-version`), the health check `/api/health` and the variables. Add
  `GEMINI_API_KEY`, `ALLOWED_ORIGINS` (the Vercel address) and optionally `DEMO_ACCESS_TOKEN` in the dashboard.
- **Frontend (Vercel, Hobby):** import the repository with root directory `frontend`; set
  `NEXT_PUBLIC_API_BASE_URL` to the Render address (and optionally `DEMO_ACCESS_TOKEN`, the same value as on Render).
- Production ignores testing overrides and caps visitors at 4 questions a minute and 30 a day. The free backend
  sleeps after 15 idle minutes; the app shows "Starting the analysis service" while it wakes.

## Local setup
```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt   # production deps (requirements.txt) plus local tools and tests
cp .env.example .env   # then add your own keys to .env
```

## Data attribution
Air quality data from [OpenAQ](https://openaq.org). Modelled air quality and
weather data from [Open-Meteo](https://open-meteo.com) (CC BY 4.0).
