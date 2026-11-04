"""Fetch daily weather (Open-Meteo, reanalysis) for the six cities -> data/processed/weather_daily.parquet.
Six requests in total. Use --cache to rebuild from data/raw/weather/*.json without network."""
import argparse, sys
from datetime import date, timedelta
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.pipeline import config as C, weather as W  # noqa: E402

ap = argparse.ArgumentParser(); ap.add_argument("--cache", action="store_true"); a = ap.parse_args()
today = date.today()
w = W.build(date(2025, 2, 18), today - timedelta(days=1), today, use_cache=a.cache)
w.to_parquet(C.PROCESSED / "weather_daily.parquet", index=False, compression="zstd")
print(w.groupby("city")["local_date"].agg(["min", "max", "count"]))
