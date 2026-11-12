"""Build the processed dataset.  Examples:
  python scripts/build_dataset.py                       # full six-city build -> data/processed
  python scripts/build_dataset.py --pilot               # Delhi+Chennai pilot -> data/raw/pilot
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from dotenv import load_dotenv  # noqa: E402

load_dotenv(ROOT / ".env")
from backend.pipeline import build, config as C  # noqa: E402

ALL = ["Delhi", "Mumbai", "Kolkata", "Chennai", "Bengaluru", "Hyderabad"]

ap = argparse.ArgumentParser()
ap.add_argument("--pilot", action="store_true")
ap.add_argument("--cities", nargs="*", default=None)
ap.add_argument("--start", default=None)
ap.add_argument("--end", default=None)
ap.add_argument("--out", default=None)
ap.add_argument("--api-topup", action="store_true",
                help="fetch recent days the archive has not published from the OpenAQ API (needs OPENAQ_API_KEY)")
a = ap.parse_args()

today = date.today()
if a.pilot:
    cities = a.cities or ["Delhi", "Chennai"]
    start, end = date.fromisoformat(a.start or "2025-09-29"), date.fromisoformat(a.end or str(today - timedelta(days=1)))
    out = Path(a.out or C.RAW / "pilot")
else:
    cities = a.cities or ALL
    start, end = date.fromisoformat(a.start or str(C.GAP_END)), date.fromisoformat(a.end or str(today - timedelta(days=1)))
    out = Path(a.out or C.PROCESSED)

t = time.time()
m = build.run(out, cities, start, end, today,
              candidates_path=C.PROCESSED / "station_candidates.json",
              opencity_dir=C.RAW / "opencity",
              bulletin_path=C.RAW / "bulletins" / "aqi-bulletins.parquet", api_topup=a.api_topup)
print(json.dumps(m["rows"], indent=1))
print(f"built {cities} {start}..{end} -> {out} in {time.time()-t:.0f}s")
