"""Build the model chain (Groq primary, Gemini fallback) from backend/config/models.json.

Model names live in configuration, not code. Override the chain with env SKYQ_MODEL_CHAIN, e.g.
  SKYQ_MODEL_CHAIN="groq:openai/gpt-oss-120b,google:gemini-3.5-flash-lite"
API keys are read from the environment (.env) and are never logged or returned.
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path

CONFIG = Path(__file__).resolve().parents[1] / "config" / "models.json"
KEY_ENV = {"groq": "GROQ_API_KEY", "google": "GEMINI_API_KEY"}


@dataclass
class ModelEntry:
    provider: str
    model: str
    key_env: str
    settings: dict = field(default_factory=dict)

    @property
    def label(self) -> str:
        return f"{self.provider}:{self.model}"


def load_config(path: Path = CONFIG) -> dict:
    return json.loads(path.read_text())


def model_chain(cfg: dict | None = None) -> list[ModelEntry]:
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
    return [ModelEntry(c["provider"], c["model"], c["key_env"], c.get("settings", {})) for c in cfg["chain"]]


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


def _record_fallback(exc: Exception) -> bool:
    from pydantic_ai.exceptions import ModelAPIError
    text = str(exc).lower()
    FALLBACK_LOG.append({"model": getattr(exc, "model_name", None), "error": type(exc).__name__,
                         "status": getattr(exc, "status_code", None),
                         "rate_limited": type(exc).__name__ == "ModelRateLimitError" or getattr(exc, "status_code", None) == 429,
                         "per_day": "per day" in text or "(tpd)" in text or "per_day" in text})
    del FALLBACK_LOG[:-50]
    return isinstance(exc, ModelAPIError)


def build_model(chain: list[ModelEntry] | None = None):
    """FallbackModel over every configured entry whose key is present. Raises if none."""
    from pydantic_ai.models.fallback import FallbackModel
    chain = chain if chain is not None else model_chain()
    models = [m for m in (_build_one(e) for e in chain) if m is not None]
    if not models:
        raise RuntimeError("No model available: add GROQ_API_KEY or GEMINI_API_KEY to .env")
    # Always wrap (even one model) so provider errors are recorded for quota handling.
    return FallbackModel(*models, fallback_on=_record_fallback)


def setup_network() -> None:
    """Local development behind TLS inspection: use the OS trust store if truststore is installed
    (requirements-dev.txt). Certificate verification stays ON."""
    os.environ.setdefault("PYDANTIC_AI_NO_BANNER", "1")
    try:
        import truststore
        truststore.inject_into_ssl()
    except ImportError:
        pass
