"""Fetch daily weather (Open-Meteo, reanalysis) for the six cities -> data/processed/weather_daily.parquet.

  python scripts/fetch_weather.py                   # full range, six requests
  python scripts/fetch_weather.py --cache           # rebuild the full range from data/raw/weather/<city>.json
  python scripts/fetch_weather.py --append          # add only days after the stored end (six requests);
                                                    # existing rows are kept exactly as stored
"""
import argparse, sys
from datetime import date, timedelta
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import pandas as pd  # noqa: E402
from backend.pipeline import config as C, weather as W  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("--cache", action="store_true")
ap.add_argument("--append", action="store_true")
a = ap.parse_args()
today = date.today()
out = C.PROCESSED / "weather_daily.parquet"
if a.append:
    old = pd.read_parquet(out)
    start = old["local_date"].max() + timedelta(days=1)
    w, new = W.append(old, start, today - timedelta(days=1), today)
    print(f"added {len(new)} city-days ({start} onwards); kept {len(old)} existing rows unchanged")
else:
    w = W.build(date(2025, 2, 18), today - timedelta(days=1), today, use_cache=a.cache)
w.to_parquet(out, index=False, compression="zstd")
print(w.groupby("city")["local_date"].agg(["min", "max", "count"]))
