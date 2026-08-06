import json
from unittest.mock import patch

from app.core.rag.retrieval import RetrievalResult


def _fake_retrieval(*args, **kwargs):
    return RetrievalResult(chunks=[], context_text="[Source 1: a.txt]\nDocMind supports PDF and DOCX.", top_score=0.8, is_low_confidence=False)


def _fake_stream(system_instruction, contents, usage):
    usage.tokens_in = 10
    usage.tokens_out = 3
    yield "DocMind "
    yield "supports PDF and DOCX."


@patch("app.api.chat.stream_generate", side_effect=_fake_stream)
@patch("app.api.chat.retrieve", side_effect=_fake_retrieval)
def test_chat_streams_tokens_and_done_event(mock_retrieve, mock_stream, client):
    response = client.post("/api/chat", json={"message": "what formats are supported?"})

    assert response.status_code == 200
    body = response.text
    assert "event: token" in body
    assert "DocMind " in body
    assert "event: done" in body
    done_line = [line for line in body.splitlines() if line.startswith("data:") and "tokens_in" in line][0]
    payload = json.loads(done_line[len("data: "):])
    assert payload["tokens_in"] == 10
    assert payload["status"] == "ok"


@patch("app.api.chat.stream_generate", side_effect=RuntimeError("upstream down"))
@patch("app.api.chat.retrieve", side_effect=_fake_retrieval)
def test_chat_emits_error_event_on_generation_failure(mock_retrieve, mock_stream, client):
    response = client.post("/api/chat", json={"message": "hello"})

    assert response.status_code == 200
    assert "event: error" in response.text


@patch("app.api.chat.stream_generate", side_effect=_fake_stream)
@patch("app.api.chat.retrieve", side_effect=_fake_retrieval)
def test_chat_history_persists_across_requests(mock_retrieve, mock_stream, client):
    client.post("/api/chat", json={"message": "what formats are supported?"})

    history = client.get("/api/chat/history").json()

    assert len(history) == 2
    assert history[0]["role"] == "user"
    assert history[1]["role"] == "assistant"
    assert history[1]["content"] == "DocMind supports PDF and DOCX."


@patch("app.api.chat.stream_generate", side_effect=_fake_stream)
@patch("app.api.chat.retrieve", side_effect=_fake_retrieval)
def test_clear_history_removes_all_messages(mock_retrieve, mock_stream, client):
    client.post("/api/chat", json={"message": "hi"})

    response = client.delete("/api/chat/history")

    assert response.status_code == 204
    assert client.get("/api/chat/history").json() == []
