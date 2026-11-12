"""API settings from environment variables (no secrets here; keys stay in the backend env only)."""
from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass, field
from pathlib import Path

from backend.runtime import is_production

log = logging.getLogger("skyquery.api")
MODELS_JSON = Path(__file__).resolve().parents[1] / "config" / "models.json"

# Production per-visitor limits. Local tests may raise them through env (Playwright uses 60/min, 1000/day),
# but in production (Render sets RENDER; or SKYQ_ENV=production) values above these are ignored.
PROD_RATE_PER_MINUTE = 4
PROD_RATE_PER_DAY = 30




def question_token_cap() -> int:
    """The one per-question token cap: limits.max_tokens_per_question in models.json."""
    return int(json.loads(MODELS_JSON.read_text())["limits"]["max_tokens_per_question"])


def _tokens_per_question() -> int:
    cap = question_token_cap()
    v = _int("TOKENS_PER_QUESTION", cap)
    if v > cap or v <= 0:
        log.warning("TOKENS_PER_QUESTION=%s ignored: it may only lower the cap of %s", v, cap)
        return cap
    return v


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


def _origins() -> list[str]:
    """Comma-separated exact origins (e.g. https://skyquerychat.vercel.app). In production there is no localhost
    default and "*" or non-https origins are dropped, so only the deployed frontend can call the API from a browser."""
    prod = is_production()
    raw = os.environ.get("ALLOWED_ORIGINS", "" if prod else "http://localhost:3000")
    out = [o.strip().rstrip("/") for o in raw.split(",") if o.strip()]
    if prod:
        bad = [o for o in out if o == "*" or not o.startswith("https://")]
        if bad:
            log.warning("ALLOWED_ORIGINS entries ignored in production: %s", bad)
        out = [o for o in out if o not in bad]
        if not out:
            log.warning("ALLOWED_ORIGINS is empty: browsers on other sites cannot call this API")
    return out


@dataclass
class Settings:
    allowed_origins: list[str] = field(default_factory=_origins)
    rate_per_minute: int = field(default_factory=lambda: _int("RATE_PER_MINUTE", PROD_RATE_PER_MINUTE))
    rate_per_day: int = field(default_factory=lambda: _int("RATE_PER_DAY", PROD_RATE_PER_DAY))
    tokens_per_question: int = field(default_factory=_tokens_per_question)
    question_timeout_s: int = field(default_factory=lambda: _int("QUESTION_TIMEOUT_S", 60))
    session_ttl_s: int = field(default_factory=lambda: _int("SESSION_TTL_S", 1800))
    max_sessions: int = field(default_factory=lambda: _int("MAX_SESSIONS", 300))
    cache_ttl_s: int = field(default_factory=lambda: _int("CACHE_TTL_S", 6 * 3600))
    cache_max: int = field(default_factory=lambda: _int("CACHE_MAX", 200))
    # Header(s) holding the real client IP, set by the platform proxy (Render runs behind Cloudflare,
    # which sets True-Client-IP / CF-Connecting-IP). X-Forwarded-For and X-Visitor-Id are NOT trusted:
    # clients can send their own. Empty -> use the socket address (local runs).
    client_ip_headers: list[str] = field(default_factory=lambda: [h.strip().lower() for h in os.environ.get(
        "CLIENT_IP_HEADERS", "true-client-ip,cf-connecting-ip").split(",") if h.strip()])
    max_question_chars: int = 500
    heartbeat_s: float = 15.0

    def __post_init__(self):
        if is_production():
            for attr, cap in (("rate_per_minute", PROD_RATE_PER_MINUTE), ("rate_per_day", PROD_RATE_PER_DAY)):
                if getattr(self, attr) > cap:
                    log.warning("%s=%s is above the production limit; using %s", attr.upper(), getattr(self, attr), cap)
                    setattr(self, attr, cap)

    @property
    def demo_token(self) -> str:
        """Owner's demo pass (env DEMO_ACCESS_TOKEN) that may use the reserved daily quota. Never returned."""
        return os.environ.get("DEMO_ACCESS_TOKEN", "")

    @property
    def ai_configured(self) -> bool:
        return bool(os.environ.get("GEMINI_API_KEY"))      # the live chain is Gemini only (Groq disabled)
