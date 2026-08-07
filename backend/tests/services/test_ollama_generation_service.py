from unittest.mock import MagicMock, patch

import pytest

from app.services.generation_service import UsageInfo
from app.services import ollama_generation_service


def _fake_chunk(content, done=False, prompt_eval_count=None, eval_count=None):
    chunk = MagicMock()
    chunk.message.content = content
    chunk.done = done
    chunk.prompt_eval_count = prompt_eval_count
    chunk.eval_count = eval_count
    return chunk


@patch("app.services.ollama_generation_service._client")
def test_stream_generate_yields_deltas_and_captures_usage(mock_client):
    mock_client.chat.return_value = iter([
        _fake_chunk("Hello "),
        _fake_chunk("world", done=True, prompt_eval_count=12, eval_count=3),
    ])
    usage = UsageInfo()

    deltas = list(ollama_generation_service.stream_generate(
        "system", [{"role": "user", "content": "hi"}], usage
    ))

    assert deltas == ["Hello ", "world"]
    assert usage.tokens_in == 12
    assert usage.tokens_out == 3


@patch("app.services.ollama_generation_service._client")
def test_stream_generate_prepends_system_message(mock_client):
    mock_client.chat.return_value = iter([_fake_chunk("ok", done=True, prompt_eval_count=1, eval_count=1)])
    usage = UsageInfo()

    list(ollama_generation_service.stream_generate("be nice", [{"role": "user", "content": "hi"}], usage))

    _, kwargs = mock_client.chat.call_args
    assert kwargs["messages"][0] == {"role": "system", "content": "be nice"}
    assert kwargs["messages"][1] == {"role": "user", "content": "hi"}
    assert kwargs["model"] == ollama_generation_service.settings.ollama_model
    assert kwargs["stream"] is True


@patch("app.services.ollama_generation_service._client")
def test_stream_generate_skips_chunks_with_no_content(mock_client):
    empty_chunk = _fake_chunk(None)
    mock_client.chat.return_value = iter([empty_chunk, _fake_chunk("ok", done=True, prompt_eval_count=1, eval_count=1)])
    usage = UsageInfo()

    deltas = list(ollama_generation_service.stream_generate("system", [], usage))

    assert deltas == ["ok"]


@patch("app.services.ollama_generation_service._client")
def test_stream_generate_wraps_connection_failure_in_friendly_error(mock_client):
    mock_client.chat.side_effect = ConnectionRefusedError("nope")
    usage = UsageInfo()

    with pytest.raises(ConnectionError, match="Ollama"):
        list(ollama_generation_service.stream_generate("system", [], usage))


@patch("app.services.ollama_generation_service._client")
def test_stream_generate_wraps_mid_stream_failure_in_friendly_error(mock_client):
    def _broken_stream():
        yield _fake_chunk("partial")
        raise TimeoutError("stalled")

    mock_client.chat.return_value = _broken_stream()
    usage = UsageInfo()

    with pytest.raises(ConnectionError, match="Ollama"):
        list(ollama_generation_service.stream_generate("system", [], usage))
