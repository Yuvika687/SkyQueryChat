"""Build only the all-cities official AQI table (CPCB daily bulletin, every city), without a full data refresh.

  python scripts/build_city_aqi_all.py [--until YYYY-MM-DD] [--no-download]

Reads data/raw/bulletins/aqi-bulletins.parquet (UrbanEmissions; download it as in .github/workflows/refresh-data.yml)
and CPCB's own bulletin PDFs for later dates (cached in data/raw/bulletins/cpcb_pdfs/), then writes
data/processed/city_aqi_all.parquet and data/app/city_aqi_all.parquet. The daily refresh builds the same table
(backend/pipeline/build.py, load_all_bulletins).
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.pipeline import build as B, config as C  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--until", type=date.fromisoformat, default=None,
                    help="last bulletin date to read from CPCB PDFs (default: yesterday, IST)")
    ap.add_argument("--no-download", action="store_true", help="use cached PDFs only")
    a = ap.parse_args()
    until = a.until or (datetime.now(timezone(timedelta(hours=5, minutes=30))).date())
    t, dropped = B.load_all_bulletins(C.RAW / "bulletins" / "aqi-bulletins.parquet", pdf_until=until,
                                      download=not a.no_download)
    for out in (C.PROCESSED / "city_aqi_all.parquet", ROOT / "data" / "app" / "city_aqi_all.parquet"):
        out.parent.mkdir(parents=True, exist_ok=True)
        t.to_parquet(out, index=False, compression="zstd")
        print(f"wrote {out.relative_to(ROOT)}: {out.stat().st_size / 1024:.0f} KB")
    print(json.dumps({"cities": int(t["city"].nunique()), "rows": len(t),
                      "start": str(t["bulletin_date"].min()), "end": str(t["bulletin_date"].max()),
                      "dropped_duplicate_city_days": dropped}, indent=1))


if __name__ == "__main__":
    main()
