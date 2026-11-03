"""HTTP helper: certificate verification always ON, retries for intermittent TLS
interception (Sophos), optional truststore for local development only."""
from __future__ import annotations

import time

import httpx

try:  # dev-only (requirements-dev.txt); never required in deployment
    import truststore

    truststore.inject_into_ssl()
except ImportError:  # pragma: no cover
    pass

_client = httpx.Client(timeout=60.0, follow_redirects=True)


def get(url: str, *, retries: int = 6, backoff: float = 2.0, **kw) -> httpx.Response:
    last: Exception | None = None
    for attempt in range(retries):
        try:
            r = _client.get(url, **kw)
            if r.status_code in (429, 500, 502, 503, 504):
                time.sleep(backoff * (attempt + 1) * 2)
                last = RuntimeError(f"HTTP {r.status_code}")
                continue
            return r
        except httpx.TransportError as e:  # connect/read/timeout/protocol errors
            last = e
            time.sleep(backoff * (attempt + 1))
    raise RuntimeError(f"GET failed after {retries} attempts: {url} ({last})")
