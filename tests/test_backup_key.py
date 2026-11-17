"""Several Gemini keys (GEMINI_API_KEY, GEMINI_API_KEY_2, _3, ... and GEMINI_API_KEYS) and per-key quota counters."""
import pytest
from pydantic_ai.exceptions import ModelHTTPError

from backend.agent import models as M
from backend.agent.quota import QuotaManager


@pytest.fixture
def clean_keys(monkeypatch):
    import os
    for k in list(os.environ):
        if k == "GEMINI_API_KEY" or k.startswith("GEMINI_API_KEY_") or k == "GEMINI_API_KEYS":
            monkeypatch.delenv(k, raising=False)
    monkeypatch.delenv("SKYQ_MODEL_CHAIN", raising=False)
    return monkeypatch


def test_keys_are_read_in_number_order_without_duplicates(clean_keys):
    clean_keys.setenv("GEMINI_API_KEY", "k1")
    clean_keys.setenv("GEMINI_API_KEY_10", "k10")
    clean_keys.setenv("GEMINI_API_KEY_3", "k3")
    clean_keys.setenv("GEMINI_API_KEY_2", "k2")
    clean_keys.setenv("GEMINI_API_KEY_4", "k1")                 # same as the first: ignored
    clean_keys.setenv("GEMINI_API_KEYS", "k5, k2 ,k6")
    assert M.gemini_keys() == ["k1", "k2", "k3", "k10", "k5", "k6"]
    assert M.backup_gemini_key() == "k2"


def test_each_model_runs_on_every_key_before_the_next_model(clean_keys):
    for i, k in enumerate(["a", "b", "c", "d"], 1):
        clean_keys.setenv("GEMINI_API_KEY" if i == 1 else f"GEMINI_API_KEY_{i}", f"fake_{k}")
    qm = QuotaManager.from_config(M.load_config())
    model = M.build_model(M.model_chain(), qm)
    labels = [e.label for e in M.model_chain() if e.provider == "google"]
    want = [lab if i == 0 else f"{lab}@key{i + 1}" for lab in labels for i in range(4)]
    assert [m.quota_key for m in model.models] == want
    a, d = qm.get(labels[0]), qm.get(f"{labels[0]}@key4")
    assert a is not d and (a.limit.rpm, a.limit.rpd) == (d.limit.rpm, d.limit.rpd)


def test_one_key_keeps_plain_labels(clean_keys):
    clean_keys.setenv("GEMINI_API_KEY", "only")
    model = M.build_model(M.model_chain(), QuotaManager.from_config(M.load_config()))
    assert all("@" not in m.quota_key for m in model.models)


def test_any_key_alone_counts_as_configured(clean_keys):
    from backend.api.settings import Settings
    clean_keys.setenv("GEMINI_API_KEY_3", "third_fake_key")
    assert Settings().ai_configured and M.gemini_configured()


def test_provider_429_is_charged_to_the_key_that_raised_it():
    qm = QuotaManager.from_config(M.load_config())
    main = "google:gemini-3.1-flash-lite"
    qm.set_chain([main, main + "@key2", main + "@key3"])
    exc = ModelHTTPError(429, "gemini-3.1-flash-lite", "Generate content requests per day limit exceeded")
    exc.sq_quota_key = main + "@key3"
    M._record_fallback(exc, qm)
    assert qm.get(main + "@key3").can_start_question() == "provider daily limit reached"
    assert qm.get(main).can_start_question() is None and qm.get(main + "@key2").can_start_question() is None
