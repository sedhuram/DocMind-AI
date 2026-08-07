# Ollama LLM Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Ollama as a second, runtime-switchable generation provider alongside Gemini, following the design in `docs/superpowers/specs/2026-08-07-ollama-provider-design.md`.

**Architecture:** `build_contents()` becomes provider-neutral (`{"role": "user"/"assistant", "content": str}`); a new `ollama_generation_service.py` module mirrors `generation_service.py`'s public signature; `chat.py` dispatches between them based on `app.state.active_llm_provider` (in-memory, env-default, switchable via a new `/api/settings` endpoint that liveness-checks Ollama before accepting a switch); the frontend gets a header provider switcher and provider visibility in Chat/Observability.

**Tech Stack:** Same as the existing project (FastAPI, SQLAlchemy, pytest; Next.js/TypeScript) plus the official `ollama` Python SDK and `httpx` (already a test dependency, now also a runtime one for the liveness probe).

## Global Constraints

- Confirmed live Ollama instance for this project's testing: `http://localhost:11434`, with `qwen3.6:35b` actually pulled — use this as `ollama_model`'s default, not a generic placeholder, so a fresh checkout works against the environment this was built and verified in without extra setup.
- Embeddings stay Gemini-only — no embedding-provider switching in this change.
- Provider selection is in-memory (`app.state.active_llm_provider`), not persisted to SQLite — resets to `DEFAULT_LLM_PROVIDER` env var (default `"gemini"`) on every backend restart. This is a deliberate, documented trade-off, not an oversight.
- `chat_messages` gains a nullable `provider` column. Because this project has no migration framework (`Base.metadata.create_all()` only creates missing tables, never alters existing ones), any local `backend/data/docmind.db` created by earlier work on this project must be deleted before this change takes effect — this is called out explicitly in the task that adds the column.
- No new auth, no per-message provider override, no Ollama model-pull UI — Ollama errors (unreachable server, model not pulled) surface as a single friendly wrapped message, not granular pre-flight checks, matching AnythingLLM's actual behavior (they don't hard-block on "is this model pulled" either).
- Tests must never require a real Ollama or Gemini connection — mock at the SDK client boundary, exactly as the existing Gemini tests do.
- All file paths below are relative to `/Users/sedhuram/Documents/assignment` unless given as absolute.

---

## Task 1: Provider-neutral message format + config additions

**Files:**
- Modify: `backend/app/core/config.py`
- Modify: `backend/app/core/rag/prompt.py`
- Modify: `backend/app/services/generation_service.py`
- Modify: `backend/tests/core/rag/test_prompt.py`
- Modify: `backend/tests/services/test_generation_service.py`
- Modify: `backend/.env.example`
- Modify: `.env.example` (root)

**Interfaces:**
- Produces: `settings.default_llm_provider: str` (default `"gemini"`), `settings.ollama_base_url: str` (default `"http://localhost:11434"`), `settings.ollama_model: str` (default `"qwen3.6:35b"`).
- Changes: `build_contents(query, retrieval, history) -> list[dict]` now returns `{"role": "user"|"assistant", "content": str}` dicts instead of Gemini's `{"role": ..., "parts": [{"text": ...}]}`. `generation_service.stream_generate` still takes this neutral `contents` shape but now converts it to Gemini's format internally before calling the SDK.

- [ ] **Step 1: Add the three new settings fields**

In `backend/app/core/config.py`, add these fields to the `Settings` class (place after `generation_model`):

```python
    default_llm_provider: str = "gemini"
    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "qwen3.6:35b"
```

- [ ] **Step 2: Update `.env.example` in both locations**

Add to `backend/.env.example` (after `GENERATION_MODEL=gemini-3.6-flash`):
```
DEFAULT_LLM_PROVIDER=gemini
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=qwen3.6:35b
```

Add the same three lines to the root `.env.example`, after the existing `GEMINI_API_KEY` line and before `NEXT_PUBLIC_API_BASE_URL`.

- [ ] **Step 3: Write the failing tests for the new `build_contents` shape**

Read the current `backend/tests/core/rag/test_prompt.py` first, then update it so every assertion that currently reads `contents[...]["parts"][0]["text"]` instead reads `contents[...]["content"]`. Specifically:

```python
def test_build_contents_includes_context_and_question():
    retrieval = RetrievalResult(chunks=[], context_text="[Source 1: a.txt]\nsome fact", top_score=0.9, is_low_confidence=False)

    contents = build_contents("what is the fact?", retrieval, history=[])

    assert contents[-1]["role"] == "user"
    text = contents[-1]["content"]
    assert "some fact" in text
    assert "what is the fact?" in text


def test_build_contents_caps_history_to_conversation_window():
    retrieval = RetrievalResult(chunks=[], context_text="", top_score=0.0, is_low_confidence=True)
    history = [
        ChatMessage(id=str(i), role="user" if i % 2 == 0 else "assistant", content=f"turn {i}")
        for i in range(10)
    ]

    contents = build_contents("new question", retrieval, history)

    assert len(contents) == 5
    assert contents[0]["content"] == "turn 6"


def test_build_contents_handles_no_relevant_sources():
    retrieval = RetrievalResult(chunks=[], context_text="", top_score=0.0, is_low_confidence=True)

    contents = build_contents("anything", retrieval, history=[])

    assert "no relevant sources" in contents[-1]["content"].lower()
```

Leave `test_system_instruction_requires_grounded_answers` unchanged.

- [ ] **Step 4: Run to verify failure**

```bash
cd /Users/sedhuram/Documents/assignment/backend
.venv/bin/pytest tests/core/rag/test_prompt.py -v
```
Expected: FAIL — `contents[-1]["content"]` raises `KeyError: 'content'` against the current `"parts"`-shaped implementation.

- [ ] **Step 5: Update `build_contents` to return the neutral shape**

In `backend/app/core/rag/prompt.py`, replace the function body. While you're in this file, also fix a known-stale type hint (the `history` parameter is typed `list[ChatMessage]` but the real caller in `chat.py` passes a lighter `HistoryTurn` dataclass with just `role`/`content` — document the real duck-typed contract with a `Protocol` instead of importing the ORM model):

```python
from typing import Protocol

from app.core.config import settings
from app.core.rag.retrieval import RetrievalResult

SYSTEM_INSTRUCTION = (
    "You are DocMind AI, a document question-answering assistant. "
    "Answer only using the information in the numbered sources provided below the question. "
    "Cite the sources you used inline with their bracketed number, e.g. [Source 1]. "
    "If the sources don't contain enough information to answer, say so plainly instead of guessing."
)


class HistoryTurnLike(Protocol):
    role: str
    content: str


def build_contents(query: str, retrieval: RetrievalResult, history: list[HistoryTurnLike]) -> list[dict]:
    """Provider-neutral message list: {"role": "user"|"assistant", "content": str}.
    Each generation module (Gemini, Ollama) adapts this shape to its own SDK's format."""
    contents = []
    for turn in history[-settings.conversation_window_turns :]:
        role = "user" if turn.role == "user" else "assistant"
        contents.append({"role": role, "content": turn.content})

    context = retrieval.context_text or "(no relevant sources found in the document collection)"
    contents.append({"role": "user", "content": f"Sources:\n{context}\n\nQuestion: {query}"})
    return contents
```

- [ ] **Step 6: Run tests to verify pass**

```bash
cd /Users/sedhuram/Documents/assignment/backend
.venv/bin/pytest tests/core/rag/test_prompt.py -v
```
Expected: PASS (4 tests).

- [ ] **Step 7: Update `generation_service.py` to adapt the neutral shape to Gemini's format**

Read the current `backend/app/services/generation_service.py` first. Add a small adapter function and call it inside `stream_generate`, right before `_start_stream`:

```python
def _to_gemini_contents(contents: list[dict]) -> list[dict]:
    role_map = {"assistant": "model", "user": "user"}
    return [
        {"role": role_map.get(c["role"], c["role"]), "parts": [{"text": c["content"]}]}
        for c in contents
    ]
```

In `stream_generate`, change:
```python
    stream = _start_stream(system_instruction, contents)
```
to:
```python
    stream = _start_stream(system_instruction, _to_gemini_contents(contents))
```
Everything else in the file (the `@retry`-decorated `_start_stream`, `UsageInfo`, the rest of `stream_generate`) stays as-is.

- [ ] **Step 8: Update `test_generation_service.py`'s test fixtures to the new neutral input shape**

Read the current file first, then change every place a test constructs `contents` from the old `{"role": ..., "parts": [{"text": ...}]}` shape to the new neutral `{"role": ..., "content": ...}` shape. For example:
```python
def test_stream_generate_yields_text_deltas_and_captures_usage(mock_start_stream):
    ...
    deltas = list(stream_generate("system", [{"role": "user", "content": "hi"}], usage))
```
Apply the same change to the other two tests in that file. The tests still mock `_start_stream` directly (unaffected by this change — they're testing the streaming/usage-capture logic, not the adapter), so no other logic changes are needed. Optionally, add one small new test confirming the adapter itself works:
```python
from app.services.generation_service import _to_gemini_contents


def test_to_gemini_contents_maps_assistant_to_model_role():
    result = _to_gemini_contents([{"role": "user", "content": "hi"}, {"role": "assistant", "content": "hello"}])
    assert result == [
        {"role": "user", "parts": [{"text": "hi"}]},
        {"role": "model", "parts": [{"text": "hello"}]},
    ]
```

- [ ] **Step 9: Run the full backend suite to confirm no regressions**

```bash
cd /Users/sedhuram/Documents/assignment/backend
.venv/bin/pytest -v
```
Expected: all tests pass (this file's changes plus the prompt.py changes together — expect ~67 tests: 65 existing + 1 new adapter test, with 3 existing prompt tests and 3 existing generation tests modified in place, not net-new).

- [ ] **Step 10: Commit**

```bash
cd /Users/sedhuram/Documents/assignment
git add backend/app/core/config.py backend/app/core/rag/prompt.py backend/app/services/generation_service.py \
  backend/tests/core/rag/test_prompt.py backend/tests/services/test_generation_service.py \
  backend/.env.example .env.example
git commit -m "backend: provider-neutral message format for generation, Ollama config fields"
```

---

## Task 2: `chat_messages.provider` column

**Files:**
- Modify: `backend/app/models/orm.py`
- Modify: `backend/app/models/schemas.py`
- Modify: `backend/tests/models/test_orm.py`

**Interfaces:**
- Produces: `ChatMessage.provider: str | None` (new nullable column), `ChatMessageOut.provider: str | None`.

- [ ] **Step 1: Delete any local dev database so the new column takes effect**

```bash
rm -f /Users/sedhuram/Documents/assignment/backend/data/docmind.db
```
This is safe — the file is gitignored, recreated automatically by `init_db()` on next backend startup, and this project deliberately has no migration framework (see Global Constraints). If this file doesn't exist, this step is a no-op.

- [ ] **Step 2: Write the failing test**

Read the current `backend/tests/models/test_orm.py` first. Add a new test near `test_chat_message_round_trip`:

```python
def test_chat_message_provider_round_trip():
    db = _memory_session()
    msg = ChatMessage(id="msg-2", role="assistant", content="hi", status="ok", provider="ollama")
    db.add(msg)
    db.commit()

    fetched = db.query(ChatMessage).filter_by(id="msg-2").one()
    assert fetched.provider == "ollama"


def test_chat_message_provider_defaults_to_none():
    db = _memory_session()
    msg = ChatMessage(id="msg-3", role="user", content="hi", status="ok")
    db.add(msg)
    db.commit()

    fetched = db.query(ChatMessage).filter_by(id="msg-3").one()
    assert fetched.provider is None
```

- [ ] **Step 3: Run to verify failure**

```bash
cd /Users/sedhuram/Documents/assignment/backend
.venv/bin/pytest tests/models/test_orm.py -v
```
Expected: FAIL — `TypeError: 'provider' is an invalid keyword argument for ChatMessage`.

- [ ] **Step 4: Add the column**

In `backend/app/models/orm.py`, add to `ChatMessage` (after the `status` column):
```python
    provider: Mapped[str | None] = mapped_column(String, nullable=True)
```

- [ ] **Step 5: Run tests to verify pass**

```bash
cd /Users/sedhuram/Documents/assignment/backend
.venv/bin/pytest tests/models/test_orm.py -v
```
Expected: PASS (all tests in this file, including the 2 new ones).

- [ ] **Step 6: Add `provider` to `ChatMessageOut`**

In `backend/app/models/schemas.py`, add `provider: str | None = None` to the `ChatMessageOut` class, placed after `status: str`.

- [ ] **Step 7: Run the full backend suite**

```bash
cd /Users/sedhuram/Documents/assignment/backend
.venv/bin/pytest -v
```
Expected: all pass, no regressions (the `_to_schema` function in `chat.py` that builds `ChatMessageOut`-shaped dicts doesn't include `provider` yet — that's fine, `ChatMessageOut.provider` defaults to `None` via Pydantic's `model_validate` when a key is absent from a plain dict only if using `.model_construct` or similar; since `_to_schema` returns a plain dict consumed by FastAPI's `response_model`, a missing `provider` key will use the schema's default `None` — this is intentional for this task; Task 4 wires the real value through).

- [ ] **Step 8: Commit**

```bash
cd /Users/sedhuram/Documents/assignment
git add backend/app/models/orm.py backend/app/models/schemas.py backend/tests/models/test_orm.py
git commit -m "backend: add provider column to chat_messages"
```

---

## Task 3: Ollama generation service

**Files:**
- Create: `backend/app/services/ollama_generation_service.py`
- Create: `backend/tests/services/test_ollama_generation_service.py`
- Modify: `backend/requirements.txt`

**Interfaces:**
- Consumes: `app.core.config.settings` (Task 1), `app.services.generation_service.UsageInfo`.
- Produces: `stream_generate(system_instruction: str, contents: list[dict], usage: UsageInfo) -> Iterator[str]` — same public signature as `generation_service.stream_generate`, so `chat.py` can call either interchangeably.

- [ ] **Step 1: Add the `ollama` package to requirements**

Add this line to `backend/requirements.txt`, after the `google-genai` line:
```
ollama==0.4.7
```

```bash
cd /Users/sedhuram/Documents/assignment/backend
.venv/bin/pip install -r requirements.txt -q
```
Expected: installs cleanly. If `ollama==0.4.7` is unavailable on PyPI at install time, install without the version pin (`.venv/bin/pip install ollama`) and update `requirements.txt` with the resolved version via `.venv/bin/pip freeze | grep ollama`.

- [ ] **Step 2: Write the failing tests**

`backend/tests/services/test_ollama_generation_service.py`:
```python
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
```

- [ ] **Step 3: Run to verify failure**

```bash
cd /Users/sedhuram/Documents/assignment/backend
.venv/bin/pytest tests/services/test_ollama_generation_service.py -v
```
Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.ollama_generation_service'`.

- [ ] **Step 4: Write `app/services/ollama_generation_service.py`**

```python
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
```

- [ ] **Step 5: Run tests to verify pass**

```bash
cd /Users/sedhuram/Documents/assignment/backend
.venv/bin/pytest tests/services/test_ollama_generation_service.py -v
```
Expected: PASS (6 tests).

- [ ] **Step 6: Run the full backend suite**

```bash
cd /Users/sedhuram/Documents/assignment/backend
.venv/bin/pytest -v
```
Expected: all pass, no regressions.

- [ ] **Step 7: Commit**

```bash
cd /Users/sedhuram/Documents/assignment
git add backend/app/services/ollama_generation_service.py backend/tests/services/test_ollama_generation_service.py backend/requirements.txt
git commit -m "backend: Ollama generation service mirroring the Gemini module's interface"
```

---

## Task 4: Provider dispatch in the chat endpoint

**Files:**
- Modify: `backend/app/main.py`
- Modify: `backend/app/api/deps.py`
- Modify: `backend/app/api/chat.py`
- Modify: `backend/tests/api/test_chat.py`
- Modify: `backend/tests/api/test_observability.py`

**Interfaces:**
- Consumes: `ollama_generation_service.stream_generate` (Task 3), `generation_service.stream_generate` (Task 1), `settings.default_llm_provider` (Task 1).
- Produces: `app.state.active_llm_provider: str` (initialized in lifespan); `get_active_provider(request) -> str` dependency; SSE `done` payload and `ChatMessageOut`/history now include `"provider"`.

- [ ] **Step 1: Initialize `app.state.active_llm_provider` in the lifespan**

Read the current `backend/app/main.py` first. In the `lifespan` function, right after `app.state.vector_store = VectorStore(settings.vector_db_dir)`, add:
```python
    app.state.active_llm_provider = settings.default_llm_provider
```

- [ ] **Step 2: Add the `get_active_provider` dependency**

In `backend/app/api/deps.py`, add:
```python
def get_active_provider(request: Request) -> str:
    return request.app.state.active_llm_provider
```
(The `Request` import already exists in this file from `get_vector_store`.)

- [ ] **Step 3: Write the failing test for provider dispatch**

Read the current `backend/tests/api/test_chat.py` first, in full — you're about to change how its existing mocks target the generation call, and need to update every existing `@patch("app.api.chat.stream_generate", ...)` to `@patch("app.services.generation_service.stream_generate", ...)` (the patch target changes because `chat.py` will now reference `generation_service.stream_generate` via module attribute access at call time, not a name imported directly into `chat.py`'s namespace — see Step 5). Apply that patch-target rename to all four existing tests in the file, then add one new test:

```python
@patch("app.services.ollama_generation_service.stream_generate", side_effect=_fake_stream)
@patch("app.api.chat.retrieve", side_effect=_fake_retrieval)
def test_chat_dispatches_to_ollama_when_active_provider_is_ollama(mock_retrieve, mock_stream, client):
    client.app.state.active_llm_provider = "ollama"
    try:
        response = client.post("/api/chat", json={"message": "what formats are supported?"})

        assert response.status_code == 200
        done_line = [line for line in response.text.splitlines() if line.startswith("data:") and "provider" in line][0]
        payload = json.loads(done_line[len("data: "):])
        assert payload["provider"] == "ollama"

        history = client.get("/api/chat/history").json()
        assert history[-1]["provider"] == "ollama"
    finally:
        client.app.state.active_llm_provider = "gemini"
```

Also add a test confirming the existing default (Gemini) path now reports its provider too:
```python
@patch("app.services.generation_service.stream_generate", side_effect=_fake_stream)
@patch("app.api.chat.retrieve", side_effect=_fake_retrieval)
def test_chat_reports_gemini_provider_by_default(mock_retrieve, mock_stream, client):
    response = client.post("/api/chat", json={"message": "hi"})

    done_line = [line for line in response.text.splitlines() if line.startswith("data:") and "provider" in line][0]
    payload = json.loads(done_line[len("data: "):])
    assert payload["provider"] == "gemini"
```

- [ ] **Step 4: Run to verify failure**

```bash
cd /Users/sedhuram/Documents/assignment/backend
.venv/bin/pytest tests/api/test_chat.py -v
```
Expected: FAIL — the renamed patch targets don't match anything yet (chat.py still imports `stream_generate` directly), and `"provider"` isn't in the SSE payload yet.

- [ ] **Step 5: Update `chat.py` to dispatch by provider and report it**

Read the current `backend/app/api/chat.py` in full first. Make these changes:

1. Change the import from:
   ```python
   from app.services.generation_service import UsageInfo, stream_generate
   ```
   to:
   ```python
   from app.services import generation_service, ollama_generation_service
   from app.services.generation_service import UsageInfo
   ```

2. Add `provider: str = Depends(get_active_provider)` as a parameter to the `chat()` route function, and add `from app.api.deps import get_active_provider` to the existing `from app.api.deps import get_vector_store` import line (combine into one import).

3. Inside `event_stream()`, before the `try:` block that calls the generator, add:
   ```python
       generate_fn = ollama_generation_service.stream_generate if provider == "ollama" else generation_service.stream_generate
   ```
   Then change `for delta in stream_generate(SYSTEM_INSTRUCTION, contents, usage):` to `for delta in generate_fn(SYSTEM_INSTRUCTION, contents, usage):`.

4. Add `provider=provider` to the `ChatMessage(...)` constructor call that persists the assistant message (alongside the existing `status=status` etc.).

5. Add `"provider": provider,` to the `done_payload` dict that gets yielded as the final SSE frame.

6. In `_to_schema`, add `"provider": message.provider,` to the returned dict.

- [ ] **Step 6: Run tests to verify pass**

```bash
cd /Users/sedhuram/Documents/assignment/backend
.venv/bin/pytest tests/api/test_chat.py -v
```
Expected: PASS (6 tests: 4 renamed + 2 new).

- [ ] **Step 7: Update `test_observability.py`'s patch targets the same way**

Read the current `backend/tests/api/test_observability.py` — it also patches `app.api.chat.stream_generate`, which needs the same rename to `app.services.generation_service.stream_generate` per Step 3's reasoning. Apply that rename.

- [ ] **Step 8: Run the full backend suite**

```bash
cd /Users/sedhuram/Documents/assignment/backend
.venv/bin/pytest -v
```
Expected: all pass, no regressions.

- [ ] **Step 9: Commit**

```bash
cd /Users/sedhuram/Documents/assignment
git add backend/app/main.py backend/app/api/deps.py backend/app/api/chat.py backend/tests/api/test_chat.py backend/tests/api/test_observability.py
git commit -m "backend: dispatch chat generation between Gemini and Ollama by active provider"
```

---

## Task 5: Settings API (`GET`/`PATCH /api/settings`)

**Files:**
- Create: `backend/app/api/settings.py`
- Create: `backend/tests/api/test_settings.py`
- Modify: `backend/app/main.py`
- Modify: `backend/requirements.txt`

**Interfaces:**
- Consumes: `settings.ollama_base_url`, `settings.ollama_model`, `settings.gemini_api_key` (Task 1).
- Produces: `GET /api/settings`, `PATCH /api/settings`, both returning `SettingsOut { active_llm_provider: str, available_providers: list[ProviderInfo] }`.

- [ ] **Step 1: Add `httpx` as a runtime dependency**

`httpx` is currently only in `backend/requirements-dev.txt` (pulled in as a transitive test dependency for FastAPI's `TestClient`). This task uses it at runtime too (the Ollama liveness probe), so add it directly to `backend/requirements.txt`, after the `python-multipart` line:
```
httpx==0.28.1
```

```bash
cd /Users/sedhuram/Documents/assignment/backend
.venv/bin/pip install -r requirements.txt -q
```

- [ ] **Step 2: Write the failing tests**

`backend/tests/api/test_settings.py`:
```python
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
```

- [ ] **Step 3: Run to verify failure**

```bash
cd /Users/sedhuram/Documents/assignment/backend
.venv/bin/pytest tests/api/test_settings.py -v
```
Expected: FAIL with 404s (router doesn't exist yet).

- [ ] **Step 4: Write `app/api/settings.py`**

```python
import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.core.config import settings

router = APIRouter(prefix="/settings", tags=["settings"])

_KNOWN_PROVIDERS = {"gemini", "ollama"}


class ProviderInfo(BaseModel):
    id: str
    label: str
    reachable: bool


class SettingsOut(BaseModel):
    active_llm_provider: str
    available_providers: list[ProviderInfo]


class SettingsUpdate(BaseModel):
    llm_provider: str


def _ollama_reachable() -> bool:
    try:
        response = httpx.get(f"{settings.ollama_base_url}/api/tags", timeout=2.0)
        return response.status_code == 200
    except Exception:
        return False


def _build_settings_out(active_provider: str) -> SettingsOut:
    return SettingsOut(
        active_llm_provider=active_provider,
        available_providers=[
            ProviderInfo(id="gemini", label="Gemini", reachable=bool(settings.gemini_api_key)),
            ProviderInfo(id="ollama", label=f"Ollama ({settings.ollama_model})", reachable=_ollama_reachable()),
        ],
    )


@router.get("", response_model=SettingsOut)
def get_settings(request: Request) -> SettingsOut:
    return _build_settings_out(request.app.state.active_llm_provider)


@router.patch("", response_model=SettingsOut)
def update_settings(payload: SettingsUpdate, request: Request) -> SettingsOut:
    if payload.llm_provider not in _KNOWN_PROVIDERS:
        raise HTTPException(status_code=422, detail=f"Unknown provider: {payload.llm_provider}")

    candidate = _build_settings_out(request.app.state.active_llm_provider)
    target = next(p for p in candidate.available_providers if p.id == payload.llm_provider)
    if not target.reachable:
        raise HTTPException(
            status_code=400,
            detail=f"{target.label} could not be reached. Is it running and configured correctly?",
        )

    request.app.state.active_llm_provider = payload.llm_provider
    return _build_settings_out(payload.llm_provider)
```

- [ ] **Step 5: Register the router in `app/main.py`**

Note the naming collision risk: `main.py` already does `from app.core.config import settings` (the settings *singleton*). Import the new router module with an alias to avoid shadowing it:
```python
from app.api import settings as settings_router
```
Add alongside the other router imports, and register with:
```python
app.include_router(settings_router.router, prefix="/api")
```

- [ ] **Step 6: Run tests to verify pass**

```bash
cd /Users/sedhuram/Documents/assignment/backend
.venv/bin/pytest tests/api/test_settings.py -v
```
Expected: PASS (6 tests).

- [ ] **Step 7: Run the full backend suite**

```bash
cd /Users/sedhuram/Documents/assignment/backend
.venv/bin/pytest -v
```
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
cd /Users/sedhuram/Documents/assignment
git add backend/app/api/settings.py backend/tests/api/test_settings.py backend/app/main.py backend/requirements.txt
git commit -m "backend: /api/settings endpoint for runtime LLM provider switching"
```

---

## Task 6: Frontend API client additions

**Files:**
- Modify: `frontend/lib/api-client.ts`

**Interfaces:**
- Produces: `ProviderInfo`, `SettingsOut` types; `apiClient.getSettings()`, `apiClient.updateSettings(provider)`.
- Modifies: `ChatMessageOut` gains `provider: string | null`; `ChatDoneEvent` gains `provider: string`; `ObservabilityRow` gains `provider: string | null`.

- [ ] **Step 1: Add the new types and client methods**

Read the current `frontend/lib/api-client.ts` first. Add these interfaces near the top, after `ObservabilityRow`:
```typescript
export interface ProviderInfo {
  id: string;
  label: string;
  reachable: boolean;
}

export interface SettingsOut {
  active_llm_provider: string;
  available_providers: ProviderInfo[];
}
```

Add `provider: string | null;` as a field to `ChatMessageOut` (after `status`) and to `ObservabilityRow` (after `status`). Add `provider: string;` to `ChatDoneEvent` (after `status`).

Add two methods to the `apiClient` object, after `getObservabilityRequests`:
```typescript
  getSettings: () => request<SettingsOut>("/api/settings"),

  updateSettings: (provider: string) =>
    request<SettingsOut>("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ llm_provider: provider }),
    }),
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/sedhuram/Documents/assignment/frontend
npx tsc --noEmit
```
Expected: clean. (No consumers of the new fields exist yet — later tasks add them — so this step only confirms the type additions themselves are syntactically valid and don't conflict with existing usages of the modified interfaces.)

- [ ] **Step 3: Commit**

```bash
cd /Users/sedhuram/Documents/assignment
git add frontend/lib/api-client.ts
git commit -m "frontend: add settings API client and provider fields to existing types"
```

---

## Task 7: Provider switcher UI

**Files:**
- Create: `frontend/components/ProviderSwitcher.tsx`
- Modify: `frontend/components/TabShell.tsx`
- Modify: `frontend/app/page.tsx`

**Interfaces:**
- Consumes: `apiClient.getSettings`, `apiClient.updateSettings` (Task 6).
- Produces: `ProviderSwitcher` component; `TabShell` gains a `providerSwitcher` prop rendered in the header.

- [ ] **Step 1: Write `components/ProviderSwitcher.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { apiClient, type SettingsOut } from "@/lib/api-client";

export function ProviderSwitcher() {
  const [settingsState, setSettingsState] = useState<SettingsOut | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiClient
      .getSettings()
      .then(setSettingsState)
      .catch(() => setError("Couldn't load provider settings."));
  }, []);

  async function handleSelect(providerId: string) {
    if (!settingsState || settingsState.active_llm_provider === providerId) return;
    setError(null);
    try {
      const updated = await apiClient.updateSettings(providerId);
      setSettingsState(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't switch provider.");
    }
  }

  if (!settingsState) return null;

  return (
    <div className="flex items-center gap-1.5">
      <div className="flex items-center gap-1 rounded-md border border-[var(--border)] p-0.5">
        {settingsState.available_providers.map((p) => (
          <button
            key={p.id}
            onClick={() => handleSelect(p.id)}
            disabled={!p.reachable}
            title={p.reachable ? p.label : `${p.label} is unreachable`}
            className={`rounded px-2 py-1 text-xs transition-colors ${
              settingsState.active_llm_provider === p.id
                ? "bg-[var(--accent)] text-white"
                : "text-[var(--foreground)]/70 hover:bg-[var(--border)]/40"
            } ${!p.reachable ? "cursor-not-allowed opacity-40" : ""}`}
          >
            {p.label}
          </button>
        ))}
      </div>
      {error && <span className="text-xs text-red-500">{error}</span>}
    </div>
  );
}
```

- [ ] **Step 2: Add a `providerSwitcher` prop to `TabShell`**

Read the current `frontend/components/TabShell.tsx` first. Add `providerSwitcher: ReactNode` to the props type (alongside the existing `statusDot: ReactNode`), and render it in the header next to `statusDot` — e.g. change:
```tsx
        <div className="flex items-center gap-3">
          <span className="text-lg font-semibold">DocMind AI</span>
          {statusDot}
        </div>
```
to:
```tsx
        <div className="flex items-center gap-3">
          <span className="text-lg font-semibold">DocMind AI</span>
          {statusDot}
        </div>
        {providerSwitcher}
```
(placed as a sibling between the title block and the `<nav>` tabs, so it sits in the middle of the header — adjust the flex layout if needed so it doesn't crowd the tab buttons on narrow viewports; a `flex-1 justify-center` wrapper or similar is fine, use your judgment for a clean header layout.)

- [ ] **Step 3: Wire `ProviderSwitcher` into `app/page.tsx`**

Read the current file first, then add the import and pass the new prop:
```tsx
import { ProviderSwitcher } from "@/components/ProviderSwitcher";
```
```tsx
    <TabShell
      statusDot={<StatusDot />}
      providerSwitcher={<ProviderSwitcher />}
      chat={<ChatTab />}
      documents={<DocumentsTab />}
      observability={<ObservabilityTab />}
    />
```

- [ ] **Step 4: Verify build**

```bash
cd /Users/sedhuram/Documents/assignment/frontend
npx tsc --noEmit && npx next build
```
Expected: both clean.

- [ ] **Step 5: Manual smoke test against the real backend + real local Ollama**

```bash
cd /Users/sedhuram/Documents/assignment/backend && .venv/bin/uvicorn app.main:app --port 8000 &
cd /Users/sedhuram/Documents/assignment/frontend && npm run dev &
sleep 4
curl -s http://localhost:8000/api/settings
```
Expected: JSON showing `"active_llm_provider": "gemini"` and BOTH providers with `"reachable": true` — Gemini because `backend/.env` has a real key, Ollama because the real local instance at `http://localhost:11434` with `qwen3.6:35b` pulled is genuinely reachable. This is the first real (non-mocked) proof the Ollama integration talks to something real. Stop both servers when done (`kill %1 %2` or equivalent).

- [ ] **Step 6: Commit**

```bash
cd /Users/sedhuram/Documents/assignment
git add frontend/components/ProviderSwitcher.tsx frontend/components/TabShell.tsx frontend/app/page.tsx
git commit -m "frontend: provider switcher in header, wired to /api/settings"
```

---

## Task 8: Provider visibility in Chat and Observability

**Files:**
- Modify: `frontend/components/chat/MessageBubble.tsx`
- Modify: `frontend/components/chat/ChatTab.tsx`
- Modify: `frontend/components/observability/ObservabilityTab.tsx`

**Interfaces:**
- Consumes: `provider` field on `ChatMessageOut`/`ChatDoneEvent`/`ObservabilityRow` (Task 6).

- [ ] **Step 1: Add `provider` to `DisplayMessage` and render a badge in `MessageBubble`**

Read the current `frontend/components/chat/MessageBubble.tsx` first. Add `provider: string | null;` to the `DisplayMessage` interface. In the render, near the existing latency/token footer (`{!isUser && message.latencyMs !== null && (...)}`), add:
```tsx
        {!isUser && message.provider && (
          <p className="mt-0.5 text-xs text-[var(--foreground)]/40">via {message.provider}</p>
        )}
```

- [ ] **Step 2: Populate `provider` in `ChatTab`**

Read the current `frontend/components/chat/ChatTab.tsx` first. In the `useEffect` that maps loaded history into `DisplayMessage`, add `provider: m.provider,` to the mapped object. In `handleSend`'s initial `assistantMessage` object, add `provider: null,` (unknown until the stream completes). In the `onDone` handler's `setMessages` update, add `provider: payload.provider,` to the spread update.

- [ ] **Step 3: Add a Provider column to `ObservabilityTab`**

Read the current `frontend/components/observability/ObservabilityTab.tsx` first. Add a `<th>Provider</th>` header (after the existing `<th>Status</th>` or wherever fits the existing column order) and a corresponding `<td>{row.provider ?? "-"}</td>` in the row mapping.

- [ ] **Step 4: Verify build**

```bash
cd /Users/sedhuram/Documents/assignment/frontend
npx tsc --noEmit && npx next build
```
Expected: both clean.

- [ ] **Step 5: Commit**

```bash
cd /Users/sedhuram/Documents/assignment
git add frontend/components/chat/MessageBubble.tsx frontend/components/chat/ChatTab.tsx frontend/components/observability/ObservabilityTab.tsx
git commit -m "frontend: show which provider answered each message, in chat and observability"
```

---

## Task 9: Real end-to-end verification against the live Ollama instance

**Files:**
- None (verification only, plus README updates).
- Modify: `README.md`

**Interfaces:**
- None — this task proves Tasks 1-8 work together against the real local Ollama server, the same way the original project's Task 20 proved the Gemini path end-to-end.

- [ ] **Step 1: Confirm the local dev DB reflects the new schema**

```bash
ls /Users/sedhuram/Documents/assignment/backend/data/docmind.db 2>&1
```
If this file exists (recreated by an uvicorn run during Task 7's smoke test), and it predates Task 2's column addition, delete it again to be safe:
```bash
rm -f /Users/sedhuram/Documents/assignment/backend/data/docmind.db
```

- [ ] **Step 2: Start both servers and confirm the full stack boots**

```bash
cd /Users/sedhuram/Documents/assignment/backend && .venv/bin/uvicorn app.main:app --port 8000 &
sleep 3
cd /Users/sedhuram/Documents/assignment/frontend && npm run dev &
sleep 4
curl -s http://localhost:8000/api/health
```
Expected: `chroma_document_count` > 0 (static seed docs re-ingested), `gemini_configured: true`.

- [ ] **Step 3: Switch to Ollama via the real API and confirm it takes**

```bash
curl -s -X PATCH http://localhost:8000/api/settings -H "Content-Type: application/json" -d '{"llm_provider": "ollama"}'
```
Expected: `200`, `"active_llm_provider": "ollama"`.

- [ ] **Step 4: Send a real chat message and confirm Ollama actually answers**

```bash
curl -N -X POST http://localhost:8000/api/chat -H "Content-Type: application/json" -d '{"message": "What embedding model does DocMind AI use?"}'
```
Expected: a stream of `event: token` frames producing a real answer from `qwen3.6:35b` (not Gemini — verify the response content style/tone is plausibly different, and that generation genuinely came from the local model, not a cached/mocked value), grounded in the seed doc (`docmind-overview.md` mentions `gemini-embedding-001`), followed by `event: done` with `"provider": "ollama"` and a non-empty `citations` array. This is the real proof: local model, real retrieval, real citation.

- [ ] **Step 5: Confirm `/api/chat/history` and `/api/observability/requests` both show `"provider": "ollama"` for that turn**

```bash
curl -s http://localhost:8000/api/chat/history | python3 -c "import json,sys; d=json.load(sys.stdin); print(d[-1]['provider'])"
curl -s http://localhost:8000/api/observability/requests | python3 -c "import json,sys; d=json.load(sys.stdin); print(d[0]['provider'])"
```
Expected: both print `ollama`.

- [ ] **Step 6: Switch back to Gemini and confirm the default path still works**

```bash
curl -s -X PATCH http://localhost:8000/api/settings -H "Content-Type: application/json" -d '{"llm_provider": "gemini"}'
curl -N -X POST http://localhost:8000/api/chat -H "Content-Type: application/json" -d '{"message": "What vector database does DocMind AI use?"}'
```
Expected: a real Gemini-generated answer (mentioning ChromaDB), `"provider": "gemini"` in the `done` frame — confirming the switch is genuinely bidirectional, not a one-way migration.

- [ ] **Step 7: Stop both servers**

```bash
kill %1 %2 2>/dev/null || true
```

- [ ] **Step 8: Update README.md**

Add a new subsection under "RAG decisions" (after the "Generation" subsection), written in the same first-person, specific voice as the rest of the document — not a generic feature announcement. Cover: why Ollama as a second provider is worth having (local/offline capability, no per-token cost, data never leaves the machine — genuine trade-offs, not marketing), that it's runtime-switchable (not just env-var, unlike the rest of this project's config surface) and why that one exception was worth the extra surface area, that the switch is connectivity-checked before accepting (mirroring AnythingLLM's liveness-check pattern, which is explicitly where this design was drawn from), that embeddings deliberately stay Gemini-only (dimension-compatibility reasoning, same as the design spec), and that provider selection is in-memory/non-persisted by design (documented trade-off, not an oversight). Reference the real verification you just ran (a real `qwen3.6:35b` answer, grounded and cited, confirmed via the actual commands above) the same way the existing README cites the real Gemini end-to-end run — this is the same caliber of evidence, not a downgrade. Update the "Quick setup" section's env var list to mention the three new optional vars. Update the architecture ASCII diagram's Gemini box if there's a clean way to show Ollama as an alternate arrow without cluttering it — if it doesn't fit cleanly, a one-line note under the diagram is fine instead of forcing it into the box art.

- [ ] **Step 9: Final full-suite check**

```bash
cd /Users/sedhuram/Documents/assignment/backend && .venv/bin/pytest -v
cd /Users/sedhuram/Documents/assignment/frontend && npx tsc --noEmit && npx next build
```
Expected: both clean.

- [ ] **Step 10: Commit**

```bash
cd /Users/sedhuram/Documents/assignment
git add README.md
git commit -m "docs: document the Ollama provider, verified against a real local instance"
```

---

## Self-Review Notes

- **Spec coverage:** All 8 numbered sections of the design spec map to tasks: §2-3 → Task 1, §3 (Ollama module) → Task 3, §4 (config) → Task 1, §5 (dispatch) → Task 4, §6 (provider column) → Task 2, §7 (settings endpoint) → Task 5, §8 (frontend) → Tasks 6-8, §9 (testing) → covered inline in every task, §10 (non-goals) → held throughout (no embedding switch, no persistence, no per-message override anywhere in the plan).
- **Placeholder scan:** none found.
- **Type consistency:** `stream_generate(system_instruction, contents, usage)` signature is identical across `generation_service.py` and `ollama_generation_service.py` (Tasks 1 and 3), verified by Task 4's dispatch code calling either interchangeably through the same `generate_fn` variable. `SettingsOut`/`ProviderInfo` (Task 5, Python) and `SettingsOut`/`ProviderInfo` (Task 6, TypeScript) field names match exactly. `provider` field name is consistent across the ORM column (Task 2), the Pydantic schema (Task 2), the SSE payload (Task 4), and every frontend type/consumer (Tasks 6-8).
- **Real-instance grounding:** the plan's default `ollama_model` value (`qwen3.6:35b`) and Task 9's verification steps are checked against the actual live Ollama instance this was built against, not a generic placeholder — avoiding a first-run failure the way the original project's Gemini model names were checked against reality rather than assumed from training data.
