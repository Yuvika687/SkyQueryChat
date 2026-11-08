"""Build the live model chain from backend/config/models.json.

Live order: gemini-3.5-flash-lite -> gemini-3.1-flash-lite -> gemini-3.8-flash. Entries marked
"enabled": false (Groq gpt-oss-120b, kept for later testing) are skipped. Model names live in
configuration, not code. Local tests may replace the chain with env SKYQ_MODEL_CHAIN, e.g.
  SKYQ_MODEL_CHAIN="google:gemini-3.5-flash-lite,google:gemini-3.1-flash-lite"
API keys are read from the environment (.env) and are never logged or returned.
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path

from .quota import LimitedModel, ModelTimeout, QuotaExceeded, QuotaManager

CONFIG = Path(__file__).resolve().parents[1] / "config" / "models.json"
KEY_ENV = {"groq": "GROQ_API_KEY", "google": "GEMINI_API_KEY"}


@dataclass
class ModelEntry:
    provider: str
    model: str
    key_env: str
    settings: dict = field(default_factory=dict)
    enabled: bool = True

    @property
    def label(self) -> str:
        return f"{self.provider}:{self.model}"


def load_config(path: Path = CONFIG) -> dict:
    return json.loads(path.read_text())


def model_chain(cfg: dict | None = None, include_disabled: bool = False) -> list[ModelEntry]:
    """The live chain: enabled entries in order (env SKYQ_MODEL_CHAIN replaces it for local tests).
    include_disabled=True also returns disabled entries, for tests such as the Groq set."""
    cfg = cfg or load_config()
    env = os.environ.get("SKYQ_MODEL_CHAIN", "").strip()
    if env:
        out = []
        for item in env.split(","):
            prov, _, name = item.strip().partition(":")
            if prov not in KEY_ENV or not name:
                raise ValueError("SKYQ_MODEL_CHAIN entries must look like 'groq:<model>' or 'google:<model>'")
            base = next((c.get("settings", {}) for c in cfg["chain"] if c["provider"] == prov), {})
            out.append(ModelEntry(prov, name, KEY_ENV[prov], dict(base)))
        return out
    entries = [ModelEntry(c["provider"], c["model"], c["key_env"], c.get("settings", {}), c.get("enabled", True))
               for c in cfg["chain"]]
    return entries if include_disabled else [e for e in entries if e.enabled]


def live_labels(cfg: dict | None = None) -> list[str]:
    """Labels of the enabled chain models, for status pages before the agent is built."""
    return [e.label for e in model_chain(cfg)]


def _build_one(e: ModelEntry):
    key = os.environ.get(e.key_env)
    if not key:
        return None
    if e.provider == "groq":
        from groq import AsyncGroq
        from pydantic_ai.models.groq import GroqModel
        from pydantic_ai.providers.groq import GroqProvider
        # Groq SDK retries 429/5xx and honours retry-after
        provider = GroqProvider(groq_client=AsyncGroq(api_key=key, max_retries=3))
        return GroqModel(e.model, provider=provider, settings=e.settings or None)
    if e.provider == "google":
        from google.genai.types import HttpRetryOptions
        from pydantic_ai.models.google import GoogleModel
        from pydantic_ai.providers.google import GoogleProvider
        provider = GoogleProvider(api_key=key, retry_options=HttpRetryOptions(attempts=3))
        return GoogleModel(e.model, provider=provider, settings=e.settings or None)
    raise ValueError(f"unknown provider {e.provider!r}")


FALLBACK_LOG: list[dict] = []     # why the chain moved on (error class + HTTP status only; no bodies)
QUOTA = QuotaManager.from_config(load_config(), configured=live_labels())   # shared by every visitor


def _record_fallback(exc: Exception, quota: QuotaManager | None = None) -> bool:
    from pydantic_ai.exceptions import ModelAPIError
    text = str(exc).lower()
    local = isinstance(exc, QuotaExceeded)
    timed_out = isinstance(exc, ModelTimeout)
    rate_limited = local or type(exc).__name__ == "ModelRateLimitError" or getattr(exc, "status_code", None) == 429
    per_day = (local and exc.scope == "day") or "per day" in text or "(tpd)" in text or "per_day" in text
    FALLBACK_LOG.append({"model": getattr(exc, "model_name", None), "error": type(exc).__name__,
                         "status": getattr(exc, "status_code", None), "rate_limited": rate_limited,
                         "per_day": per_day, "local_limit": local, "timeout": timed_out,
                         "reason": exc.reason if local else None})
    del FALLBACK_LOG[:-50]
    if rate_limited and not local:            # a real provider 429: tell the shared limiter
        pq = (quota or QUOTA).by_model_name(getattr(exc, "model_name", None))
        if pq:
            pq.on_provider_error(per_day=per_day, rate_limited=True)
    return isinstance(exc, ModelAPIError)


def limited_chain(pairs: list[tuple[str, object]], quota: QuotaManager | None = None,
                  timeout_s: float | None = None):
    """FallbackModel over (quota_key, model) pairs, each behind the shared quota limiter and a per-request
    timeout (limits.model_request_timeout_s unless timeout_s is given)."""
    from pydantic_ai.models.fallback import FallbackModel
    quota = quota or QUOTA
    quota.set_chain([k for k, _ in pairs])
    timeout = timeout_s if timeout_s is not None else load_config()["limits"].get("model_request_timeout_s")
    # Always wrap (even one model) so provider errors are recorded for quota handling.
    return FallbackModel(*[LimitedModel(m, k, quota, timeout_s=timeout) for k, m in pairs],
                         fallback_on=lambda e: _record_fallback(e, quota))


def build_model(chain: list[ModelEntry] | None = None, quota: QuotaManager | None = None):
    """FallbackModel over every configured entry whose key is present. Raises if none."""
    chain = chain if chain is not None else model_chain()
    pairs = [(e.label, m) for e, m in ((e, _build_one(e)) for e in chain) if m is not None]
    if not pairs:
        raise RuntimeError("No model available: add GEMINI_API_KEY to .env")
    return limited_chain(pairs, quota)


def setup_network() -> None:
    """Local development behind TLS inspection: use the OS trust store if truststore is installed
    (requirements-dev.txt). Certificate verification stays ON."""
    os.environ.setdefault("PYDANTIC_AI_NO_BANNER", "1")
    try:
        import truststore
        truststore.inject_into_ssl()
    except ImportError:
        pass
