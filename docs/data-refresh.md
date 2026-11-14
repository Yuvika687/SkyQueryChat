# Daily data refresh

`.github/workflows/refresh-data.yml` keeps the site's data current without manual work.

## What it does

- **When:** every day at 02:00 UTC (7:30 AM IST). You can also start it by hand: GitHub → **Actions** →
  **Refresh data** → **Run workflow**.
- **How:** `python scripts/refresh_data.py` runs the existing pipeline, unchanged:
  1. `scripts/build_dataset.py --api-topup`: OpenAQ station data (S3 archive, plus the OpenAQ API for days the archive
     has not published yet) and the CPCB daily bulletins (UrbanEmissions table, then CPCB's own PDFs), with every
     cleaning, validity, fault-flag and gap rule. Output: `data/processed`.
  2. `scripts/fetch_weather.py --append`: Open-Meteo weather for the new days only.
  3. `scripts/derive_app_tables.py`: rebuilds `data/app`.
  4. `scripts/crosscheck_bulletins.py`: refreshes the CPCB cross-check figures.
- **Checks before publishing:** data end dates never move backwards; already published values do not change (city PM
  up to the previous archive end, every earlier AQI bulletin and weather day); `data/app` stays under 8 MB; then the
  whole backend test suite runs.
- **Publishing:** only if the data changed and every check and test passed, it commits **"Refresh data through
  <date>"** to `main` and pushes. Render (backend) and Vercel (frontend) redeploy from that push.
- **On failure:** nothing is committed, the run shows a red ✗ in the Actions tab (GitHub emails you), and the site
  keeps the last good data.

## Secret to add (one-time)

The workflow needs one secret: your OpenAQ API key (the same value as `OPENAQ_API_KEY` in your local `.env`).

1. Open the repository on GitHub.
2. **Settings** → **Secrets and variables** → **Actions**.
3. Click **New repository secret**.
4. Name: `OPENAQ_API_KEY`
5. Secret: paste your OpenAQ key, then click **Add secret**.

No other secret is needed: the OpenAQ archive, CPCB bulletins, UrbanEmissions and Open-Meteo are public. The key is only
passed to the refresh step as an environment variable; the scripts never print it, and GitHub masks it in logs.

Also check **Settings** → **Actions** → **General** → **Workflow permissions** allows **Read and write permissions**
(the workflow also asks for `contents: write` itself). If `main` has branch protection that blocks pushes from
GitHub Actions, allow `github-actions[bot]` or the data commit cannot be pushed.

## Good to know

- **First run is slow** (up to a few hours): GitHub's runner downloads the whole OpenAQ archive history once. Later runs
  restore it from the Actions cache and take minutes. The cache expires after 7 days without a run, so the daily
  schedule keeps it warm.
- **Delhi OpenCity files** (2024–2025, supporting Diwali context) never change, but they are 417 MB and their site blocks
  automated downloads. The pipeline step that reads them stores its output in `data/processed/opencity_cache/`; the
  refresh uses that cache when the raw files are absent. Running a build locally with the raw files rewrites it.
- **Size:** `data/app` is about 3.3 MB and grows about 2 KB a day, so no rolling window is needed for years. The refresh
  stops with a clear message above 8 MB, so a decision is made before Render's 512 MB memory limit is at risk.
- **Evaluation scores stay reproducible:** evaluations read a frozen copy of the tables in `evals/data/` (data to
  11 Nov 2026), never the refreshed `data/app`.
- **Saved demo answers** with no fixed period (for example "last 30 days", or no period at all) show a notice naming the
  data end they used once newer data exists.
