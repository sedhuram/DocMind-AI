from collections.abc import Iterator
from dataclasses import dataclass

from google import genai
from google.genai import types
from tenacity import retry, retry_if_exception, stop_after_attempt, wait_exponential

from app.core.config import settings

_client = genai.Client(api_key=settings.gemini_api_key)
_RETRYABLE_CODES = {429, 500, 502, 503, 504}


@dataclass
class UsageInfo:
    tokens_in: int = 0
    tokens_out: int = 0


def _is_retryable(exc: BaseException) -> bool:
    return getattr(exc, "code", None) in _RETRYABLE_CODES


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=1, max=8),
    retry=retry_if_exception(_is_retryable),
    reraise=True,
)
def _start_stream(system_instruction: str, contents: list[dict]):
    config = types.GenerateContentConfig(system_instruction=system_instruction)
    return _client.models.generate_content_stream(
        model=settings.generation_model,
        contents=contents,
        config=config,
    )


def _to_gemini_contents(contents: list[dict]) -> list[dict]:
    role_map = {"assistant": "model", "user": "user"}
    return [
        {"role": role_map.get(c["role"], c["role"]), "parts": [{"text": c["content"]}]}
        for c in contents
    ]


def stream_generate(system_instruction: str, contents: list[dict], usage: UsageInfo) -> Iterator[str]:
    """Yield text deltas from Gemini. Token usage is written into `usage` as it arrives —
    a mutable out-parameter because a generator's return value isn't accessible until
    the caller has fully exhausted it, and callers need usage before that point (SSE 'done' frame).

    Retry/backoff only covers *starting* the stream: once tokens have been sent to a client
    over SSE, a mid-stream failure can't be retried without re-sending duplicate text, so it
    propagates and the caller is expected to end the response with an error event instead.
    """
    stream = _start_stream(system_instruction, _to_gemini_contents(contents))
    for chunk in stream:
        if chunk.usage_metadata:
            usage.tokens_in = chunk.usage_metadata.prompt_token_count or usage.tokens_in
            usage.tokens_out = chunk.usage_metadata.candidates_token_count or usage.tokens_out
        if chunk.text:
            yield chunk.text
