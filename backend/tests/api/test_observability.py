from unittest.mock import patch

from app.core.rag.retrieval import RetrievalResult


def _fake_retrieval(*args, **kwargs):
    return RetrievalResult(chunks=[], context_text="ctx", top_score=0.7, is_low_confidence=False)


def _fake_stream(system_instruction, contents, usage):
    usage.tokens_in = 5
    usage.tokens_out = 2
    yield "answer"


@patch("app.services.generation_service.stream_generate", side_effect=_fake_stream)
@patch("app.api.chat.retrieve", side_effect=_fake_retrieval)
def test_observability_lists_recent_assistant_turns(mock_retrieve, mock_stream, client):
    client.post("/api/chat", json={"message": "question one"})

    response = client.get("/api/observability/requests")

    assert response.status_code == 200
    rows = response.json()
    assert len(rows) == 1
    assert rows[0]["query"] == "question one"
    assert rows[0]["tokens_in"] == 5
    assert rows[0]["status"] == "ok"


def test_observability_empty_when_no_requests_made(client):
    response = client.get("/api/observability/requests")

    assert response.status_code == 200
    assert response.json() == []
