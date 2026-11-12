"""Where the code is running. Production = Render (it sets RENDER) or SKYQ_ENV=production.

In production every testing override is ignored: SKYQ_MODEL_CHAIN, SKYQ_PROVIDER_LIMITS, SKYQ_QUOTA_SAFETY_MARGIN,
SKYQ_DEMO_RESERVE, and visitor limits above the production caps (backend/api/settings.py)."""
from __future__ import annotations

import os

TEST_OVERRIDES = ("SKYQ_MODEL_CHAIN", "SKYQ_PROVIDER_LIMITS", "SKYQ_QUOTA_SAFETY_MARGIN", "SKYQ_DEMO_RESERVE")


def is_production() -> bool:
    return bool(os.environ.get("RENDER")) or os.environ.get("SKYQ_ENV", "").strip().lower() == "production"


def override(name: str) -> str:
    """A testing override's value, or "" in production (where they are never applied)."""
    return "" if is_production() else os.environ.get(name, "").strip()
