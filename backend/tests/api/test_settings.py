from unittest.mock import patch


def test_get_settings_reports_provider_reachability(client):
    with patch("app.api.settings._ollama_reachable", return_value=True):
        response = client.get("/api/settings")

    assert response.status_code == 200
    body = response.json()
    assert body["active_llm_provider"] == "gemini"
    providers = {p["id"]: p for p in body["available_providers"]}
    assert providers["gemini"]["reachable"] is True
    assert providers["ollama"]["reachable"] is True
    assert "qwen3.6:35b" in providers["ollama"]["label"] or "Ollama" in providers["ollama"]["label"]


def test_get_settings_reports_ollama_unreachable(client):
    with patch("app.api.settings._ollama_reachable", return_value=False):
        response = client.get("/api/settings")

    providers = {p["id"]: p for p in response.json()["available_providers"]}
    assert providers["ollama"]["reachable"] is False


def test_patch_settings_switches_to_reachable_provider(client):
    with patch("app.api.settings._ollama_reachable", return_value=True):
        response = client.patch("/api/settings", json={"llm_provider": "ollama"})

    assert response.status_code == 200
    assert response.json()["active_llm_provider"] == "ollama"
    client.app.state.active_llm_provider = "gemini"


def test_patch_settings_rejects_unreachable_provider(client):
    with patch("app.api.settings._ollama_reachable", return_value=False):
        response = client.patch("/api/settings", json={"llm_provider": "ollama"})

    assert response.status_code == 400
    assert "reached" in response.json()["detail"].lower()


def test_patch_settings_rejects_unknown_provider(client):
    response = client.patch("/api/settings", json={"llm_provider": "not-a-real-provider"})

    assert response.status_code == 422


def test_ollama_reachable_returns_false_on_connection_error():
    from app.api.settings import _ollama_reachable

    with patch("httpx.get", side_effect=ConnectionError("refused")):
        assert _ollama_reachable() is False


def test_patch_settings_to_gemini_never_probes_ollama(client):
    with patch("app.api.settings._ollama_reachable") as mock_reachable:
        response = client.patch("/api/settings", json={"llm_provider": "gemini"})

    assert response.status_code == 200
    mock_reachable.assert_not_called()


def test_patch_settings_to_ollama_probes_exactly_once(client):
    with patch("app.api.settings._ollama_reachable", return_value=True) as mock_reachable:
        response = client.patch("/api/settings", json={"llm_provider": "ollama"})

    assert response.status_code == 200
    mock_reachable.assert_called_once()
    client.app.state.active_llm_provider = "gemini"
