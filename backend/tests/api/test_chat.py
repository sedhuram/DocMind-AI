import json
from unittest.mock import patch

from app.core.rag.retrieval import RetrievalResult
from app.services.vector_store import RetrievedChunk


def _fake_retrieval(*args, **kwargs):
    return RetrievalResult(chunks=[], context_text="[Source 1: a.txt]\nDocMind supports PDF and DOCX.", top_score=0.8, is_low_confidence=False)


def _fake_retrieval_with_chunks(*args, **kwargs):
    chunks = [
        RetrievedChunk(
            document_id="doc-1", filename="handbook.pdf", chunk_index=3,
            page_number=5, text="DocMind supports PDF and DOCX.", score=0.8123456,
        ),
        RetrievedChunk(
            document_id="doc-2", filename="notes.txt", chunk_index=0,
            page_number=None, text="Plain text files have no page numbers.", score=0.4211111,
        ),
    ]
    return RetrievalResult(
        chunks=chunks,
        context_text="[Source 1: handbook.pdf]\nDocMind supports PDF and DOCX.",
        top_score=0.8123456,
        is_low_confidence=False,
    )


def _done_payload(sse_body: str) -> dict:
    frames = [f for f in sse_body.split("\n\n") if "event: done" in f]
    data_line = [line for line in frames[0].splitlines() if line.startswith("data: ")][0]
    return json.loads(data_line[len("data: "):])


def _fake_stream(system_instruction, contents, usage):
    usage.tokens_in = 10
    usage.tokens_out = 3
    yield "DocMind "
    yield "supports PDF and DOCX."


@patch("app.services.generation_service.stream_generate", side_effect=_fake_stream)
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


@patch("app.services.generation_service.stream_generate", side_effect=RuntimeError("upstream down"))
@patch("app.api.chat.retrieve", side_effect=_fake_retrieval)
def test_chat_emits_error_event_on_generation_failure(mock_retrieve, mock_stream, client):
    response = client.post("/api/chat", json={"message": "hello"})

    assert response.status_code == 200
    assert "event: error" in response.text


@patch("app.services.generation_service.stream_generate", side_effect=RuntimeError("upstream down"))
@patch("app.api.chat.retrieve", side_effect=_fake_retrieval)
def test_failed_turn_persists_non_empty_content(mock_retrieve, mock_stream, client):
    # A failed turn used to be saved with content="". That empty turn is replayed into
    # Gemini's `contents` on the next request (which rejects empty text parts with a 400,
    # cascading one transient failure into all later turns) and renders as a blank bubble
    # after a page reload.
    client.post("/api/chat", json={"message": "hello"})

    history = client.get("/api/chat/history").json()

    assert history[1]["role"] == "assistant"
    assert history[1]["status"] == "error"
    assert history[1]["content"].strip() != ""


@patch("app.services.generation_service.stream_generate", side_effect=_fake_stream)
@patch("app.api.chat.retrieve", side_effect=_fake_retrieval)
def test_chat_turn_emits_structured_info_log(mock_retrieve, mock_stream, client, caplog):
    # The JsonFormatter previously only ever ran from exception handlers; the happy path
    # logged nothing at all.
    with caplog.at_level("INFO", logger="app.api.chat"):
        client.post("/api/chat", json={"message": "hi"})

    records = [r for r in caplog.records if r.getMessage() == "chat_turn_completed"]
    assert len(records) == 1
    record = records[0]
    assert record.tokens_in == 10
    assert record.tokens_out == 3
    assert record.chunks_retrieved == 0
    assert record.status == "ok"
    assert isinstance(record.latency_ms, int)
    assert record.top_score == 0.8


@patch("app.services.generation_service.stream_generate", side_effect=_fake_stream)
@patch("app.api.chat.retrieve", side_effect=_fake_retrieval)
def test_chat_second_message_in_conversation_succeeds(mock_retrieve, mock_stream, client):
    # Reproduces the DetachedInstanceError bug: the first request commits a new
    # ChatMessage while `history` (queried moments earlier in the same session)
    # is still loaded. With SQLAlchemy's default expire_on_commit=True, that
    # commit expires every ORM object in the session's identity map, including
    # `history`. The second request loads that now-nonempty history and passes
    # it into build_contents() inside event_stream(), which runs after FastAPI
    # has already closed the request's db session. Accessing .role/.content on
    # the expired, detached objects previously raised DetachedInstanceError
    # and crashed the SSE stream instead of yielding a clean response.
    first = client.post("/api/chat", json={"message": "what formats are supported?"})
    assert first.status_code == 200
    assert "event: done" in first.text

    second = client.post("/api/chat", json={"message": "anything else?"})

    assert second.status_code == 200
    body = second.text
    assert "event: done" in body
    assert "event: error" not in body


@patch("app.services.generation_service.stream_generate", side_effect=_fake_stream)
@patch("app.api.chat.retrieve", side_effect=RuntimeError("vector store unavailable"))
def test_chat_emits_error_event_on_retrieval_failure(mock_retrieve, mock_stream, client):
    # Previously, retrieve() and build_contents() ran outside the try/except
    # block in event_stream(), so a failure there propagated as a raw
    # exception and corrupted the SSE response instead of yielding a clean
    # `event: error` frame.
    response = client.post("/api/chat", json={"message": "hello"})

    assert response.status_code == 200
    assert "event: error" in response.text
    assert "event: done" in response.text


@patch("app.services.generation_service.stream_generate", side_effect=_fake_stream)
@patch("app.api.chat.retrieve", side_effect=_fake_retrieval)
def test_chat_history_persists_across_requests(mock_retrieve, mock_stream, client):
    client.post("/api/chat", json={"message": "what formats are supported?"})

    history = client.get("/api/chat/history").json()

    assert len(history) == 2
    assert history[0]["role"] == "user"
    assert history[1]["role"] == "assistant"
    assert history[1]["content"] == "DocMind supports PDF and DOCX."


@patch("app.services.generation_service.stream_generate", side_effect=_fake_stream)
@patch("app.api.chat.retrieve", side_effect=_fake_retrieval_with_chunks)
def test_chat_done_event_carries_full_citation_payload(mock_retrieve, mock_stream, client):
    # Grounded citations are the product's headline feature, but every other chat test
    # retrieves zero chunks - so the citation dict construction was never exercised.
    response = client.post("/api/chat", json={"message": "what formats are supported?"})

    assert response.status_code == 200
    payload = _done_payload(response.text)

    assert payload["chunks_retrieved"] == 2
    assert payload["citations"] == [
        {
            "document_id": "doc-1", "filename": "handbook.pdf",
            "chunk_index": 3, "page_number": 5, "score": 0.8123,
        },
        {
            "document_id": "doc-2", "filename": "notes.txt",
            "chunk_index": 0, "page_number": None, "score": 0.4211,
        },
    ]


@patch("app.services.generation_service.stream_generate", side_effect=_fake_stream)
@patch("app.api.chat.retrieve", side_effect=_fake_retrieval_with_chunks)
def test_chat_history_round_trips_citations_through_json_column(mock_retrieve, mock_stream, client):
    # `ChatMessage.citations` is a JSON *string* column: citations go through
    # json.dumps on write and json.loads in `_to_schema` on read, then through
    # Pydantic's `list[Citation]` validation. This asserts the whole round-trip,
    # including that an absent page_number survives as null rather than being
    # coerced to 0 or dropped.
    client.post("/api/chat", json={"message": "what formats are supported?"})

    history = client.get("/api/chat/history").json()

    assert len(history) == 2
    citations = history[1]["citations"]
    assert len(citations) == 2
    assert citations[0] == {
        "document_id": "doc-1", "filename": "handbook.pdf",
        "chunk_index": 3, "page_number": 5, "score": 0.8123,
    }
    assert citations[1] == {
        "document_id": "doc-2", "filename": "notes.txt",
        "chunk_index": 0, "page_number": None, "score": 0.4211,
    }
    assert citations[1]["page_number"] is None


@patch("app.services.generation_service.stream_generate", side_effect=_fake_stream)
@patch("app.api.chat.retrieve", side_effect=_fake_retrieval)
def test_clear_history_removes_all_messages(mock_retrieve, mock_stream, client):
    client.post("/api/chat", json={"message": "hi"})

    response = client.delete("/api/chat/history")

    assert response.status_code == 204
    assert client.get("/api/chat/history").json() == []


@patch("app.services.ollama_generation_service.stream_generate", side_effect=_fake_stream)
@patch("app.api.chat.retrieve", side_effect=_fake_retrieval)
def test_chat_dispatches_to_ollama_when_active_provider_is_ollama(mock_retrieve, mock_stream, client):
    client.app.state.active_llm_provider = "ollama"
    try:
        response = client.post("/api/chat", json={"message": "what formats are supported?"})

        assert response.status_code == 200
        # `provider` in the done frame and in history both come from the request-scoped
        # active-provider dependency, so they'd read "ollama" even if dispatch were
        # inverted and the real Gemini path ran and failed. These three assertions are
        # what actually pin the dispatch: the Ollama mock was invoked, its text reached
        # the stream, and the turn did not fall into the error handler.
        mock_stream.assert_called_once()
        # _fake_stream yields the answer as two deltas, so they arrive as two separate
        # `event: token` frames rather than one concatenated string.
        assert "DocMind " in response.text
        assert "supports PDF and DOCX." in response.text
        assert "event: error" not in response.text

        done_line = [line for line in response.text.splitlines() if line.startswith("data:") and "provider" in line][0]
        payload = json.loads(done_line[len("data: "):])
        assert payload["provider"] == "ollama"
        assert payload["status"] == "ok"
        assert payload["tokens_in"] == 10
        assert payload["tokens_out"] == 3

        history = client.get("/api/chat/history").json()
        assert history[-1]["provider"] == "ollama"
        assert history[-1]["content"] == "DocMind supports PDF and DOCX."
    finally:
        client.app.state.active_llm_provider = "gemini"


_OLLAMA_DOWN = "Ollama request failed. Is Ollama running at http://localhost:11434, and is the model 'qwen3.6:35b' pulled?"


@patch("app.services.ollama_generation_service.stream_generate", side_effect=ConnectionError(_OLLAMA_DOWN))
@patch("app.api.chat.retrieve", side_effect=_fake_retrieval)
def test_chat_surfaces_ollama_connection_error_message(mock_retrieve, mock_stream, client):
    # ollama_generation_service builds an actionable ConnectionError ("is Ollama running,
    # is the model pulled?"). The chat handler used to discard it and always emit the
    # generic "temporarily unavailable" string, leaving a user with a stopped Ollama or an
    # un-pulled model no reason to do anything but retry forever.
    client.app.state.active_llm_provider = "ollama"
    try:
        response = client.post("/api/chat", json={"message": "hello"})

        assert response.status_code == 200
        error_frame = [f for f in response.text.split("\n\n") if "event: error" in f][0]
        data_line = [line for line in error_frame.splitlines() if line.startswith("data: ")][0]
        assert json.loads(data_line[len("data: "):])["message"] == _OLLAMA_DOWN

        # The persisted turn must match what was shown live, or a page reload would
        # silently swap the actionable message for the generic one.
        history = client.get("/api/chat/history").json()
        assert history[-1]["status"] == "error"
        assert history[-1]["content"] == _OLLAMA_DOWN
    finally:
        client.app.state.active_llm_provider = "gemini"


@patch("app.services.generation_service.stream_generate", side_effect=RuntimeError("500 INTERNAL: internal upstream detail"))
@patch("app.api.chat.retrieve", side_effect=_fake_retrieval)
def test_chat_falls_back_to_generic_message_for_non_connection_errors(mock_retrieve, mock_stream, client):
    # The Gemini path propagates raw google-genai exceptions, whose text can carry request
    # internals; only a deliberately user-facing ConnectionError is passed through.
    response = client.post("/api/chat", json={"message": "hello"})

    error_frame = [f for f in response.text.split("\n\n") if "event: error" in f][0]
    data_line = [line for line in error_frame.splitlines() if line.startswith("data: ")][0]
    assert json.loads(data_line[len("data: "):])["message"] == "The model is temporarily unavailable. Please try again."
    assert "internal upstream detail" not in response.text


@patch("app.services.generation_service.stream_generate", side_effect=_fake_stream)
@patch("app.api.chat.retrieve", side_effect=_fake_retrieval)
def test_chat_reports_gemini_provider_by_default(mock_retrieve, mock_stream, client):
    response = client.post("/api/chat", json={"message": "hi"})

    done_line = [line for line in response.text.splitlines() if line.startswith("data:") and "provider" in line][0]
    payload = json.loads(done_line[len("data: "):])
    assert payload["provider"] == "gemini"
