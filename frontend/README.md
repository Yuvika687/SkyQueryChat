# SkyQueryChat frontend

Next.js 16 (App Router, TypeScript), Tailwind CSS 4, shadcn/ui (Base UI), Apache ECharts and Lucide icons.
Design: `../docs/ui-design-spec.md`. Only the Ask screen is built so far; Explore and Accuracy come next.

## Run locally

```bash
# backend (from the repo root)
.venv/bin/python -m uvicorn backend.api.main:app --port 8000
# frontend
cp .env.example .env.local   # NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
npm install
npm run dev                  # http://localhost:3000/ask
```

## Environment

| Variable | Where | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_API_BASE_URL` | browser | Backend URL. The browser calls it directly so per-visitor rate limits see each visitor's own IP. Not a secret. |
| `DEMO_ACCESS_TOKEN` | server only | Optional owner demo pass (`/demo`). Never give it a `NEXT_PUBLIC_` prefix. |
| `BACKEND_URL` | server only | Backend URL for the demo proxy (defaults to the public one). |

## Tests

```bash
npm test            # Vitest: SSE parsing, streaming client, timeline, charts, Ask screen states
npm run e2e         # Playwright: starts backend + frontend, desktop/tablet/mobile, screenshots to ../docs/screenshots/ask
npm run lint && npm run typecheck
```

The e2e run raises the backend's per-visitor rate limit through env (`RATE_PER_MINUTE=60`) for testing only.
One e2e test asks a live question (about 2–3 AI requests); later runs reuse the backend's answer cache.
