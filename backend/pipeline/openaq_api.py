"""OpenAQ API top-up for recent days the S3 archive has not published yet.

Raw readings come from /v3/sensors/{id}/measurements (15-minute CPCB readings). Each reading's period END is written
as `datetime`, exactly like the archive (verified: archive datetime == API period.datetimeTo, docs Part 4), into
files with the archive's columns: data/raw/openaq_api/locationid=<id>/location-<id>-<yyyymmdd>.csv.gz (grouped by
the IST date of the interval start). The build reads them with the same reader and the same cleaning, validity,
fault-flag and gap rules. A day uses API files only where the archive has no file; on a later refresh the archive
replaces them.

The API key is read from the environment (.env) and only sent in the X-API-Key header; it is never logged.
Rate limits: 60 requests/minute and 2,000/hour (docs Part 1); this module paces itself well below both.
"""
from __future__ import annotations

import gzip
import io
import os
import time
from collections import deque
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import httpx
import pandas as pd

from . import config as C
from . import net  # noqa: F401  (installs truststore for TLS-inspecting proxies in local development)

BASE = "https://api.openaq.org/v3"
CACHE = C.RAW / "openaq_api"
COLS = ["location_id", "sensors_id", "location", "datetime", "lat", "lon", "parameter", "units", "value"]
PER_MINUTE, PER_HOUR = 45, 1500          # below the provider's 60/min and 2,000/h


class Client:
    def __init__(self):
        key = os.getenv("OPENAQ_API_KEY", "").strip()
        if not key:
            raise RuntimeError("OPENAQ_API_KEY is not set (add it to .env)")
        self._http = httpx.Client(base_url=BASE, headers={"X-API-Key": key}, timeout=30.0)
        self._sent: deque[float] = deque()
        self.requests = 0

    def _pace(self) -> None:
        now = time.monotonic()
        while self._sent and now - self._sent[0] > 3600:
            self._sent.popleft()
        recent = sum(1 for t in self._sent if now - t < 60)
        if recent >= PER_MINUTE:
            time.sleep(60 - (now - [t for t in self._sent if now - t < 60][0]) + 0.5)
        if len(self._sent) >= PER_HOUR:
            time.sleep(3600 - (now - self._sent[0]) + 1)
        self._sent.append(time.monotonic())

    def get(self, path: str, params: dict) -> dict:
        for attempt in range(6):
            self._pace()
            self.requests += 1
            try:
                r = self._http.get(path, params=params)
            except httpx.TransportError:
                time.sleep(3 * (attempt + 1))
                continue
            if r.status_code == 429:
                time.sleep(min(int(r.headers.get("retry-after") or 60), 120) + 1)
                continue
            if r.status_code in (500, 502, 503, 504):
                time.sleep(5 * (attempt + 1))
                continue
            if r.status_code == 404:
                return {"results": []}
            r.raise_for_status()
            return r.json()
        raise RuntimeError(f"OpenAQ API kept failing for {path}")


def _iso(d: date, hh: int = 0) -> str:
    return datetime(d.year, d.month, d.day, hh, tzinfo=C.IST).astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def sensor_readings(client: Client, sensor_id: int, start: date, end: date) -> list[dict]:
    """Raw readings whose interval lies in IST days start..end (period end up to end+1 00:00)."""
    out, page = [], 1
    while True:
        j = client.get(f"/sensors/{sensor_id}/measurements",
                       {"datetime_from": _iso(start), "datetime_to": _iso(end + timedelta(days=1)),
                        "limit": 1000, "page": page})
        res = j.get("results") or []
        out += res
        if len(res) < 1000:
            return out
        page += 1


def top_up(st: pd.DataFrame, start: date, end: date, progress: bool = True) -> dict:
    """Fetch API readings for every selected sensor for IST days start..end and write archive-format files.
    Returns {"files": {location_id: [(date, path)]}, "last_utc": {sensor_id: latest period end}, "requests": n}."""
    client = Client()
    files: dict[int, list[tuple[date, Path]]] = {}
    last: dict[int, pd.Timestamp] = {}
    rows_by_loc: dict[int, list[dict]] = {}
    sensors = st.drop_duplicates("sensor_id")
    for i, s in enumerate(sensors.itertuples()):
        for m in sensor_readings(client, int(s.sensor_id), start, end):
            to = (m.get("period") or {}).get("datetimeTo") or {}
            if not to.get("utc") or m.get("value") is None:
                continue
            ts = pd.Timestamp(to["utc"]).tz_convert(C.IST)
            last[int(s.sensor_id)] = max(last.get(int(s.sensor_id), ts), ts)
            rows_by_loc.setdefault(int(s.location_id), []).append({
                "location_id": int(s.location_id), "sensors_id": int(s.sensor_id), "location": s.station_name,
                "datetime": ts.isoformat(), "lat": s.lat, "lon": s.lon, "parameter": s.pollutant,
                "units": (m.get("parameter") or {}).get("units") or C.UNITS, "value": m["value"]})
        if progress and (i + 1) % 40 == 0:
            print(f"  api: {i + 1}/{len(sensors)} sensors, {client.requests} requests", flush=True)
    for lid, rows in rows_by_loc.items():
        df = pd.DataFrame(rows, columns=COLS)
        start_day = (pd.to_datetime(df["datetime"]) - pd.Timedelta(minutes=15)).dt.date
        for d, g in df.groupby(start_day):
            if not (start <= d <= end):
                continue
            p = CACHE / f"locationid={lid}" / f"location-{lid}-{d:%Y%m%d}.csv.gz"
            p.parent.mkdir(parents=True, exist_ok=True)
            buf = io.BytesIO()
            with gzip.GzipFile(fileobj=buf, mode="wb", mtime=0) as gz:
                gz.write(g.sort_values(["sensors_id", "datetime"]).to_csv(index=False).encode())
            p.write_bytes(buf.getvalue())
            files.setdefault(lid, []).append((d, p))
    if progress:
        print(f"  api: {len(sensors)} sensors, {client.requests} requests, "
              f"{sum(len(v) for v in files.values())} location-days written", flush=True)
    return {"files": files, "last_utc": last, "requests": client.requests}
