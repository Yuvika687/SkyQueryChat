"""Minimal OpenAQ v3 client for probing: key from .env, header-only, rate-limit aware.

Never prints the API key. Logs each request with UTC + IST timestamps.
"""
from __future__ import annotations

import os
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path

import httpx
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")
BASE = "https://api.openaq.org/v3"
IST = timezone(timedelta(hours=5, minutes=30))


def now_stamp() -> str:
    u = datetime.now(timezone.utc)
    return f"{u:%Y-%m-%d %H:%M:%S} UTC / {u.astimezone(IST):%H:%M:%S} IST"


class OpenAQ:
    def __init__(self, timeout: float = 60.0):
        key = os.getenv("OPENAQ_API_KEY", "").strip()
        if not key:
            raise RuntimeError("OPENAQ_API_KEY missing from .env")
        self._client = httpx.Client(base_url=BASE, headers={"X-API-Key": key}, timeout=timeout)
        self.log: list[dict] = []

    def get(self, path: str, params: dict | None = None, max_retries: int = 3) -> httpx.Response:
        for attempt in range(max_retries + 1):
            t0 = time.perf_counter()
            stamp = now_stamp()
            try:
                r = self._client.get(path, params=params)
            except httpx.TimeoutException as e:
                self.log.append({"at": stamp, "path": path, "params": params, "status": "TIMEOUT",
                                 "secs": round(time.perf_counter() - t0, 1)})
                raise
            secs = round(time.perf_counter() - t0, 2)
            rl = {k: v for k, v in r.headers.items() if "ratelimit" in k.lower() or k.lower() == "retry-after"}
            self.log.append({"at": stamp, "path": path, "params": params, "status": r.status_code,
                             "secs": secs, "ratelimit": rl})
            if r.status_code == 429 and attempt < max_retries:
                wait = int(r.headers.get("retry-after") or r.headers.get("x-ratelimit-reset") or 60)
                time.sleep(min(wait, 120) + 1)
                continue
            # Be polite: if remaining budget is low, pause until reset.
            remaining = r.headers.get("x-ratelimit-remaining")
            if remaining is not None and remaining.isdigit() and int(remaining) <= 2:
                time.sleep(int(r.headers.get("x-ratelimit-reset", 60)) + 1)
            return r
        return r
