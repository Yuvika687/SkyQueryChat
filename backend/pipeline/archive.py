"""OpenAQ S3 archive fetcher with a local cache (data/raw/openaq_archive/).

File layout: records/csv.gz/locationid=<id>/year=<yyyy>/month=<mm>/location-<id>-<yyyymmdd>.csv.gz
A file that does not exist is cached as an empty '.missing' marker, but only for dates
older than 7 days (recent files may still arrive), so reruns do not re-request them.
"""
from __future__ import annotations

from datetime import date, timedelta
from pathlib import Path

from . import config as C
from .net import get

BASE = "https://openaq-data-archive.s3.amazonaws.com/records/csv.gz"
CACHE = C.RAW / "openaq_archive"


def _path(location_id: int, d: date) -> Path:
    return CACHE / f"locationid={location_id}" / f"location-{location_id}-{d:%Y%m%d}.csv.gz"


def fetch(location_id: int, d: date, today: date | None = None) -> Path | None:
    """Return local path of the archive file, or None if it does not exist."""
    p = _path(location_id, d)
    miss = p.with_suffix(".missing")
    if p.exists():
        return p
    if miss.exists():
        return None
    url = f"{BASE}/locationid={location_id}/year={d:%Y}/month={d:%m}/location-{location_id}-{d:%Y%m%d}.csv.gz"
    r = get(url)
    p.parent.mkdir(parents=True, exist_ok=True)
    if r.status_code in (403, 404):
        if d < (today or date.today()) - timedelta(days=7):
            miss.touch()
        return None
    r.raise_for_status()
    tmp = p.with_suffix(".part")
    tmp.write_bytes(r.content)
    tmp.rename(p)
    return p
