from app.core.config import Settings


def test_settings_load_defaults_from_env(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "abc123")
    settings = Settings(_env_file=None)
    assert settings.gemini_api_key == "abc123"
    assert settings.embedding_model == "gemini-embedding-001"
    assert settings.embedding_dimensions == 768
    assert settings.generation_model == "gemini-3.6-flash"
    assert settings.chunk_size == 1000
    assert settings.chunk_overlap == 150
    assert settings.low_confidence_threshold == 0.3


def test_settings_requires_gemini_api_key(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    try:
        Settings(_env_file=None)
        assert False, "expected a validation error without GEMINI_API_KEY"
    except Exception as exc:
        assert "gemini_api_key" in str(exc).lower()
