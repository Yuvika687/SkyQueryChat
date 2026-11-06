"""API settings from environment variables (no secrets here; keys stay in the backend env only)."""
from __future__ import annotations

import os
from dataclasses import dataclass, field


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


def _origins() -> list[str]:
    raw = os.environ.get("ALLOWED_ORIGINS", "http://localhost:3000")
    return [o.strip() for o in raw.split(",") if o.strip()]


@dataclass
class Settings:
    allowed_origins: list[str] = field(default_factory=_origins)
    rate_per_minute: int = field(default_factory=lambda: _int("RATE_PER_MINUTE", 4))
    rate_per_day: int = field(default_factory=lambda: _int("RATE_PER_DAY", 30))
    tokens_per_question: int = field(default_factory=lambda: _int("TOKENS_PER_QUESTION", 12_000))
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

    @property
    def demo_token(self) -> str:
        """Owner's demo pass (env DEMO_ACCESS_TOKEN) that may use the reserved daily quota. Never returned."""
        return os.environ.get("DEMO_ACCESS_TOKEN", "")

    @property
    def ai_configured(self) -> bool:
        return bool(os.environ.get("GROQ_API_KEY") or os.environ.get("GEMINI_API_KEY"))
