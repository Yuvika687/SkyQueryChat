"""Backup Gemini key (GEMINI_API_KEY_2) and per-question cards."""
from pydantic_ai.exceptions import ModelHTTPError

from backend.agent import models as M
from backend.agent.quota import QuotaManager


def test_backup_key_appends_gemini_models_with_own_counters(monkeypatch):
    monkeypatch.delenv("SKYQ_MODEL_CHAIN", raising=False)
    monkeypatch.setenv("GEMINI_API_KEY", "main_fake_key")
    monkeypatch.setenv("GEMINI_API_KEY_2", "backup_fake_key")
    qm = QuotaManager.from_config(M.load_config())
    model = M.build_model(M.model_chain(), qm)
    keys = [m.quota_key for m in model.models]
    main = [e.label for e in M.model_chain()]
    assert keys == main + [k + M.BACKUP_SUFFIX for k in main]
    a, b = qm.get(main[0]), qm.get(main[0] + M.BACKUP_SUFFIX)
    assert a is not b and (a.limit.rpm, a.limit.rpd) == (b.limit.rpm, b.limit.rpd)


def test_no_backup_when_unset_or_same_as_main(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "same")
    monkeypatch.delenv("GEMINI_API_KEY_BACKUP", raising=False)
    monkeypatch.setenv("GEMINI_API_KEY_2", "same")
    assert M.backup_gemini_key() is None
    monkeypatch.delenv("GEMINI_API_KEY_2")
    assert M.backup_gemini_key() is None


def test_backup_key_alone_counts_as_configured(monkeypatch):
    from backend.api.settings import Settings
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.setenv("GEMINI_API_KEY_2", "backup_fake_key")
    assert Settings().ai_configured


def test_provider_429_is_charged_to_the_key_that_raised_it():
    qm = QuotaManager.from_config(M.load_config())
    main = "google:gemini-3.1-flash-lite"
    qm.set_chain([main, main + M.BACKUP_SUFFIX])
    exc = ModelHTTPError(429, "gemini-3.1-flash-lite", "Generate content requests per day limit exceeded")
    exc.sq_quota_key = main + M.BACKUP_SUFFIX
    M._record_fallback(exc, qm)
    assert qm.get(main + M.BACKUP_SUFFIX).can_start_question() == "provider daily limit reached"
    assert qm.get(main).can_start_question() is None
