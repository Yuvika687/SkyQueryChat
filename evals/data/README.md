# Frozen evaluation data

A fixed copy of the app tables (`data/app/*.parquet` and `manifest.json`) with measured PM, official AQI and weather
up to **11 Nov 2026**. Evaluations (`scripts/run_eval.py`) and their independent references (`evals/references.py`)
read this copy by default, so scores stay reproducible while the live data refreshes every day.

To freeze a newer copy later: copy `data/app/*.parquet` and `data/app/manifest.json` here in one commit, and say so
in the evaluation notes (scores measured on different data are not comparable).
