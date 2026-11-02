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
Day 1 — project setup. Data pipeline, agent and UI not built yet.

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
