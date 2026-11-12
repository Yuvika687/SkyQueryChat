"""CPCB daily AQI bulletin PDFs read directly (cpcb.gov.in), for dates the UrbanEmissions dataset does not cover yet.

Each PDF ("Air Quality Index on <Mon DD, YYYY> @ 4 PM (Average of past 24 hours)") holds one table row per city:
S.No, City, Air Quality (category), Index Value (AQI), Prominent Pollutant, "participated/total" stations.
UrbanEmissions parses the same PDFs; our parser is checked against their values on overlapping dates
(docs/data-source-check.md Part 13) before any PDF-only date is used.

PDFs are cached in data/raw/bulletins/cpcb_pdfs/ (never committed). Needs pdfplumber (local development only).
"""
from __future__ import annotations

import base64
import re
from datetime import date, datetime, timedelta
from pathlib import Path

import pandas as pd

from . import config as C
from .net import get

CACHE = C.RAW / "bulletins" / "cpcb_pdfs"
SOURCE = "CPCB daily AQI bulletin PDF (cpcb.gov.in)"
CATEGORIES = {"Good", "Satisfactory", "Moderate", "Poor", "Very Poor", "Severe"}
TITLE = re.compile(r"Air Quality Index on ([A-Z][a-z]{2} \d{2}, \d{4}) @ 4 PM")


def url_for(d: date) -> str:
    name = f"Downloads/AQI_Bulletin_{d:%Y%m%d}.pdf"
    return "https://cpcb.gov.in/displaypdf.php?id=" + base64.b64encode(name.encode()).decode()


def fetch(d: date) -> Path | None:
    """Cached PDF for bulletin date d, or None when CPCB has not published it (non-PDF reply)."""
    p = CACHE / f"AQI_Bulletin_{d:%Y%m%d}.pdf"
    if p.exists():
        return p
    r = get(url_for(d))
    if r.status_code != 200 or r.content[:4] != b"%PDF":
        return None
    CACHE.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".part")
    tmp.write_bytes(r.content)
    tmp.rename(p)
    return p


def _pollutants(cell: str) -> str:
    """'PM , PM\\n2.5 10' -> 'PM2.5, PM10' (sub-scripts sit on the next line in the PDF)."""
    lines = (cell or "").split("\n")
    names = [x.strip() for x in lines[0].split(",") if x.strip()]
    subs = lines[1].split() if len(lines) > 1 else []
    out, i = [], 0
    for n in names:
        if n in ("PM", "NO", "SO", "NH", "O") and i < len(subs):
            out.append(n + subs[i]); i += 1
        else:
            out.append(n)
    return ", ".join(sorted(out))           # same order as UrbanEmissions ("O3, PM10, PM2.5")


def parse(path: Path, cities: list[str] | None = None) -> pd.DataFrame:
    """Rows for the given cities (all cities when None). Fails loudly on anything unexpected."""
    import pdfplumber                     # local development only (requirements-dev.txt)
    rows, title_date = [], None
    with pdfplumber.open(path) as pdf:
        m = TITLE.search(pdf.pages[0].extract_text() or "")
        if not m:
            raise ValueError(f"{path.name}: bulletin title not found")
        title_date = datetime.strptime(m.group(1), "%b %d, %Y").date()
        for page in pdf.pages:
            for table in page.extract_tables():
                for r in table:
                    if not r or len(r) < 6 or not (r[0] or "").strip().isdigit():
                        continue
                    city = re.sub(r"\s+", " ", r[1] or "").strip()
                    if cities and city not in cities:
                        continue
                    cat = re.sub(r"\s+", " ", r[2] or "").strip()
                    aqi = (r[3] or "").strip()
                    st = re.fullmatch(r"\s*(\d+)\s*/\s*(\d+)\s*", r[5] or "")
                    if cat not in CATEGORIES or not aqi.isdigit() or not st:
                        raise ValueError(f"{path.name}: unreadable row for {city}: {r}")
                    rows.append({"date": title_date, "city": city, "aqi": float(aqi), "aqi_category": cat,
                                 "prominent_pollutant": _pollutants(r[4]), "no_stations": int(st.group(1)),
                                 "total_stations": int(st.group(2))})
    out = pd.DataFrame(rows)
    if path.stem.endswith(f"{title_date:%Y%m%d}") is False:
        raise ValueError(f"{path.name}: title date {title_date} does not match the file name")
    if not out.empty and out.duplicated(["date", "city"]).any():
        raise ValueError(f"{path.name}: duplicate city rows")
    return out


def load(start: date, end: date, cities: list[str], download: bool = True) -> pd.DataFrame:
    """Parsed rows for bulletin dates start..end (missing PDFs are skipped; the caller checks coverage)."""
    parts = []
    d = start
    while d <= end:
        p = fetch(d) if download else (CACHE / f"AQI_Bulletin_{d:%Y%m%d}.pdf")
        if p is not None and p.exists():
            parts.append(parse(p, cities))
        d += timedelta(days=1)
    cols = ["date", "city", "aqi", "aqi_category", "prominent_pollutant", "no_stations", "total_stations"]
    return pd.concat(parts, ignore_index=True) if parts else pd.DataFrame(columns=cols)
