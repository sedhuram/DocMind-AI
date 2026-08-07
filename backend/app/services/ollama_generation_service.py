from collections.abc import Iterator

import ollama

from app.core.config import settings
from app.services.generation_service import UsageInfo

_client = ollama.Client(host=settings.ollama_base_url)


def stream_generate(system_instruction: str, contents: list[dict], usage: UsageInfo) -> Iterator[str]:
    """Yield text deltas from a local Ollama model. `contents` is the provider-neutral
    {"role": "user"|"assistant", "content": str} shape build_contents() produces --
    Ollama's chat API already expects exactly this per-message shape, so the only
    adaptation needed is prepending the system instruction as its own message
    (Ollama has no separate system-instruction config the way Gemini does).

    Unlike the Gemini module, there's no retry-before-start here: a local Ollama
    instance being unreachable isn't a transient rate-limit condition backoff would
    fix, it's either running or it isn't. Both the initial request and any mid-stream
    failure are wrapped in one friendly ConnectionError -- covering the two realistic
    failure modes (server down, model not pulled) with one message rather than trying
    to distinguish them, matching how AnythingLLM's own Ollama provider handles this.
    """
    messages = [{"role": "system", "content": system_instruction}, *contents]
    try:
        stream = _client.chat(model=settings.ollama_model, messages=messages, stream=True)
        for chunk in stream:
            if chunk.message.content:
                yield chunk.message.content
            if chunk.done:
                usage.tokens_in = chunk.prompt_eval_count or usage.tokens_in
                usage.tokens_out = chunk.eval_count or usage.tokens_out
    except Exception as exc:
        raise ConnectionError(
            f"Ollama request failed. Is Ollama running at {settings.ollama_base_url}, "
            f"and is the model '{settings.ollama_model}' pulled?"
        ) from exc
