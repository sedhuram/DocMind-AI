from unittest.mock import MagicMock, patch

import pytest

from app.services.generation_service import stream_generate, UsageInfo, _to_gemini_contents


def _fake_chunk(text, tokens_in=None, tokens_out=None):
    chunk = MagicMock()
    chunk.text = text
    if tokens_in is not None:
        chunk.usage_metadata = MagicMock(prompt_token_count=tokens_in, candidates_token_count=tokens_out)
    else:
        chunk.usage_metadata = None
    return chunk


@patch("app.services.generation_service._start_stream")
def test_stream_generate_yields_text_deltas_and_captures_usage(mock_start_stream):
    mock_start_stream.return_value = iter([
        _fake_chunk("Hello "),
        _fake_chunk("world", tokens_in=42, tokens_out=2),
    ])
    usage = UsageInfo()

    deltas = list(stream_generate("system", [{"role": "user", "content": "hi"}], usage))

    assert deltas == ["Hello ", "world"]
    assert usage.tokens_in == 42
    assert usage.tokens_out == 2


@patch("app.services.generation_service._start_stream")
def test_stream_generate_skips_chunks_with_no_text(mock_start_stream):
    empty_chunk = _fake_chunk(None)
    mock_start_stream.return_value = iter([empty_chunk, _fake_chunk("ok")])
    usage = UsageInfo()

    deltas = list(stream_generate("system", [], usage))

    assert deltas == ["ok"]


@patch("app.services.generation_service._start_stream", side_effect=RuntimeError("upstream down"))
def test_stream_generate_propagates_unrecoverable_errors(mock_start_stream):
    usage = UsageInfo()
    with pytest.raises(RuntimeError):
        list(stream_generate("system", [], usage))


def test_to_gemini_contents_maps_assistant_to_model_role():
    result = _to_gemini_contents([{"role": "user", "content": "hi"}, {"role": "assistant", "content": "hello"}])
    assert result == [
        {"role": "user", "parts": [{"text": "hi"}]},
        {"role": "model", "parts": [{"text": "hello"}]},
    ]
