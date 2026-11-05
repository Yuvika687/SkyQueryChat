# SkyQueryChat

An agentic, conversational air-quality analytics app for six Indian cities
(Delhi, Mumbai, Kolkata, Chennai, Bengaluru, Hyderabad), covering PM2.5 and PM10.

Ask questions in plain English: trends, city comparisons, Diwali impact, unusual
pollution days and weather associations. Every answer is computed in Python from
real data (OpenAQ measurements, Open-Meteo models) and shows its source, data type
(measured vs modelled) and coverage.

## Stack
- **Frontend:** Next.js, TypeScript, Tailwind CSS, shadcn/ui, Apache ECharts (Vercel)
- **Backend:** Python, FastAPI, Server-Sent Events (Render)
- **Agent:** Pydantic AI — Groq primary, Gemini fallback
- **Data:** OpenAQ, Open-Meteo, pandas, Parquet, DuckDB

## Status
Day 1 complete: data pipeline and processed dataset (`data/processed/`, Parquet).
Day 2: weather, app tables (`data/app/`), analysis functions (`backend/analysis/`) and the
terminal agent (`backend/agent/`). Day 3 (part 1): FastAPI with SSE streaming (`backend/api/`).
Frontend not built yet. Evidence and rules: `docs/data-source-check.md`.

## Rebuild the dataset
```bash
pip install -r requirements-dev.txt     # dev only: adds truststore for TLS-inspecting proxies
python scripts/build_dataset.py         # downloads/caches raw data, rebuilds data/processed
python scripts/fetch_weather.py         # Open-Meteo daily weather (6 requests)
python scripts/derive_app_tables.py     # compact app tables in data/app (deploy only these)
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
Endpoints: `POST /api/chat` (SSE), `GET /api/health`, `/api/meta`, `/api/limits`, `/api/stations`,
`/api/cities`, `/api/cities/{city}/summary`, `/api/trends`, `/api/coverage`, `/api/diwali/{city}`,
`/api/accuracy`. Docs at `/api/docs`. Environment: `ALLOWED_ORIGINS`, `RATE_PER_MINUTE`,
`RATE_PER_DAY`, `DAILY_TOKEN_BUDGET`, `TOKENS_PER_QUESTION`, `QUESTION_TIMEOUT_S` (keys stay in the
backend `.env`; the frontend never sees them).

## Local setup
```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # then add your own keys to .env
```

## Data attribution
Air quality data from [OpenAQ](https://openaq.org). Modelled air quality and
weather data from [Open-Meteo](https://open-meteo.com) (CC BY 4.0).
