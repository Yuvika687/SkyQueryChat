# Deploying SkyQueryChat (Render + Vercel)

Two services: the **backend** (Python, FastAPI) on **Render**, and the **website** (Next.js) on **Vercel**. Deploy the
backend first, because the website needs its address. Fill in the blanks below as you go and keep this page private
once it holds real values. **Never commit keys to the repository**: they go only into the Render and Vercel dashboards.

```
Backend address (Render):   https://______________________________.onrender.com
Website address (Vercel):   https://______________________________.vercel.app
```

---

## 1. Put the code on GitHub

Render and Vercel both deploy from a GitHub repository.

1. Unzip the package and open the folder.
2. Create a new GitHub repository (or use the existing one) and push the folder to its `main` branch:

```bash
git init
git add .
git commit -m "SkyQueryChat"
git branch -M main
git remote add origin https://github.com/<your-account>/<your-repo>.git
git push -u origin main
```

`.env` files are listed in `.gitignore`, so keys are never pushed.

---

## 2. Backend on Render

1. Sign in at <https://render.com> and choose **New → Blueprint**.
2. Pick the GitHub repository. Render reads `render.yaml` and creates the service `skyquerychat-api`
   (free plan, Singapore, Python version from `.python-version`, start command and health check already set).
3. Render asks for the variables marked `sync: false`. Paste the values:

| Variable on Render | What to put there | Your value |
|---|---|---|
| `GEMINI_API_KEY` | Google AI Studio key (<https://aistudio.google.com/apikey>). **Required** for Ask. | `________________________` |
| `ALLOWED_ORIGINS` | The Vercel website address from step 3, no trailing slash, e.g. `https://sky-query-chat.vercel.app`. Several addresses: separate with commas. Put a placeholder first and update it after step 3. | `________________________` |
| `DEMO_ACCESS_TOKEN` | Optional. Any long random text; unlocks the owner's reserved AI quota at `/demo`. Leave empty if not needed. If set, use the same value on Vercel. | `________________________` |

These two are already set by `render.yaml` (do not change): `SKYQ_ENV=production`, `ARROW_DEFAULT_MEMORY_POOL=system`.

4. Click **Apply**. The first build takes a few minutes. When it is live, open
   `https://<your-backend>.onrender.com/api/health`. It should show `"status": "ok"` and `"ai_configured": true`.
   (The first visit after a sleep takes about a minute while the free service wakes up.)
5. Write the backend address at the top of this page.

**Not needed on Render:** `OPENAQ_API_KEY` (used only by the daily data refresh on GitHub) and `GROQ_API_KEY` (unused
in production).

---

## 3. Website on Vercel

1. Sign in at <https://vercel.com> and choose **Add New → Project**, then import the same GitHub repository.
2. Set **Root Directory** to `frontend` (important). The framework is detected as Next.js; keep the default build
   settings. The build copies the MapLibre map worker automatically.
3. Under **Environment Variables**, add:

| Variable on Vercel | What to put there | Your value |
|---|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | The Render backend address from step 2, no trailing slash. **Required.** | `________________________` |
| `DEMO_ACCESS_TOKEN` | Optional, only if you set it on Render (same value). | `________________________` |
| `BACKEND_URL` | Optional; same as `NEXT_PUBLIC_API_BASE_URL` (used only by the demo pass). | `________________________` |

4. Click **Deploy**. Write the website address at the top of this page.
5. Go back to Render → the service → **Environment**, set `ALLOWED_ORIGINS` to the website address, and save
   (Render redeploys by itself). Without this the browser is not allowed to call the backend.

---

## 4. Daily data refresh (GitHub Actions, optional but recommended)

The workflow `.github/workflows/refresh-data.yml` runs every day at 7:30 AM IST, downloads the new days (measured PM,
CPCB bulletins for the six cities and for every bulletin city, weather), checks them and commits
"Refresh data through <date>". Render and Vercel then redeploy by themselves.

1. GitHub repository → **Settings → Secrets and variables → Actions → New repository secret**.

| Secret on GitHub | What to put there | Your value |
|---|---|---|
| `OPENAQ_API_KEY` | OpenAQ API key (<https://explore.openaq.org/register>). | `________________________` |

2. GitHub repository → **Settings → Actions → General → Workflow permissions**: choose **Read and write
   permissions** (the workflow commits the refreshed data).
3. Run it once by hand: **Actions → Refresh data → Run workflow**, and check it finishes green.

---

## 5. Keep the backend awake (optional)

Render's free service sleeps after 15 minutes without visitors. A free UptimeRobot monitor that calls
`https://<your-backend>.onrender.com/api/health` every 5 minutes keeps it awake. Steps: `docs/keep-awake.md`.

---

## 6. Check that everything works

| Check | Expected |
|---|---|
| `https://<backend>/api/health` | `"status": "ok"`, `"ai_configured": true` |
| `https://<backend>/api/aqi/city/Lucknow` | Lucknow's official AQI (CPCB 4 PM bulletin) and 30 days of values |
| Website Home | six city cards; "Find your city" finds Lucknow, Pune, Bangalore |
| Website Explore | six city dots; "All CPCB cities" shows about 300 dots |
| Website Ask, "AQI in Lucknow" | an answer labelled "Official AQI (CPCB 4 PM bulletin, <date>)" with "N numbers checked" |
| Website Compare | summary strip (highest, lowest, ratio), chart and ranking |

If Ask says the AI limit is reached, the free Gemini quota for the day is used up; it resets at midnight Pacific time
(1:30 PM IST). Home, Explore, City and Compare never use AI and keep working.

## Troubleshooting

| Problem | Fix |
|---|---|
| The website loads but shows "We couldn't reach the analysis service" | `NEXT_PUBLIC_API_BASE_URL` on Vercel is wrong, or `ALLOWED_ORIGINS` on Render does not exactly match the Vercel address (https, no trailing slash). Redeploy Vercel after changing a `NEXT_PUBLIC_` variable. |
| `/api/health` shows `"ai_configured": false` | `GEMINI_API_KEY` is missing on Render. |
| Ask answers "The AI model rejected the request" | The Gemini key is invalid or revoked: create a new one in Google AI Studio and update it on Render. |
| Vercel build fails | Check that Root Directory is `frontend`. |
| First page load is slow | The free Render service was asleep (about a minute). See step 5. |
