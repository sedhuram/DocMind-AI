def test_health_returns_ok_status(client):
    response = client.get("/api/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["gemini_configured"] is True
    assert body["chroma_document_count"] == 0
    assert body["sqlite_ok"] is True
    assert body["uptime_seconds"] >= 0
