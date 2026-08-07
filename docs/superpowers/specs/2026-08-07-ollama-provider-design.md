# Ollama LLM Provider — Design Spec

**Date:** 2026-08-07
**Context:** DocMind AI currently hardcodes Gemini for generation. This adds Ollama as a second, runtime-switchable generation provider, following AnythingLLM's provider strategy (separate provider modules, factory selection, env-driven config, connectivity-aware switching) adapted to this codebase's existing function-module idiom rather than AnythingLLM's per-provider class hierarchy.

## 1. Scope

- **Generation only.** Embeddings stay on `gemini-embedding-001` — switching embedding models changes vector dimensionality and would silently corrupt the existing Chroma collection; out of scope by explicit decision.
- **Runtime-switchable via UI**, not just env var. Selection lives in `app.state`, initialized from `DEFAULT_LLM_PROVIDER` env var (default `gemini`) at startup, mutable via `PATCH /api/settings`. **Not persisted to SQLite** — resets to the env default on restart. This is deliberate: one mutable in-memory field doesn't justify a settings table.
- No auth around the switch (the whole app has none), no per-message provider override, no multi-provider fan-out/comparison.

## 2. Provider-neutral message format

`build_contents()` (`backend/app/core/rag/prompt.py`, currently Gemini-specific: `{"role": "user"/"model", "parts": [{"text": ...}]}`) changes to return neutral dicts: `{"role": "user"/"assistant", "content": str}`. Each generation module adapts this to its own SDK's shape:

- **Gemini** (`generation_service.py`): `content` → `parts: [{"text": content}]`, `"assistant"` → `"model"`.
- **Ollama** (new `ollama_generation_service.py`): near-identical to the neutral format already — `{"role": "user"/"assistant", "content": ...}` is literally what Ollama's `client.chat()` expects. System instruction becomes a prepended `{"role": "system", "content": SYSTEM_INSTRUCTION}` message rather than Gemini's separate `system_instruction` config param.

`SYSTEM_INSTRUCTION` stays a plain string in `prompt.py`; each provider module decides how to inject it (config param vs. message).

## 3. New module: `app/services/ollama_generation_service.py`

Same public signature as the existing Gemini module, so callers don't care which is active:

```python
def stream_generate(system_instruction: str, contents: list[dict], usage: UsageInfo) -> Iterator[str]
```

- Uses the official `ollama` Python SDK (`ollama.Client(host=settings.ollama_base_url)`), matching AnythingLLM's choice of official SDK over raw HTTP/LangChain.
- `client.chat(model=settings.ollama_model, messages=[...], stream=True)` — messages list is `[{"role": "system", "content": system_instruction}] + contents` (with the neutral `content` field, `role` values already compatible — Ollama accepts `system`/`user`/`assistant`).
- Streaming: `for chunk in stream: yield chunk["message"]["content"]` (skip empty deltas, same pattern as the Gemini module).
- Usage: Ollama's final chunk carries `prompt_eval_count` (tokens in) and `eval_count` (tokens out) — mutate `usage.tokens_in`/`usage.tokens_out` from those, mirroring how the Gemini module reads `usage_metadata`.
- Connectivity error handling, matching AnythingLLM's pattern: catch connection-refused-style errors and re-raise with a friendly message — `"Ollama service could not be reached. Is Ollama running at {base_url}?"` — rather than letting a raw `ConnectionError` propagate. This flows into the same `event: error` SSE path `chat.py` already has.
- No `tenacity` retry-before-start the way Gemini has one (that guards against 429/5xx from a cloud API with transient rate limits; a local Ollama instance being down isn't something backoff fixes) — a single attempt, clean error on failure.

## 4. Config additions (`app/core/config.py`)

```python
default_llm_provider: str = "gemini"   # "gemini" | "ollama", read once at startup into app.state
ollama_base_url: str = "http://localhost:11434"
ollama_model: str = "llama3.2"
```

Added to `.env.example` (both root and `backend/`) with the same commented-optional style as other tunables.

## 5. Provider dispatch in `chat.py`

`event_stream()` currently calls `stream_generate` from the Gemini module directly. Changes to read `request.app.state.active_llm_provider` and dispatch:

```python
generate_fn = ollama_generation_service.stream_generate if provider == "ollama" else generation_service.stream_generate
```

The `done` SSE payload and the persisted `ChatMessage` row both gain a `provider` field (see §6).

## 6. `chat_messages.provider` column

New nullable `String` column, `provider`, on `ChatMessage` (`backend/app/models/orm.py`), populated at write time with the provider that generated that turn (`"gemini"` or `"ollama"`). One real consequence of having no migration framework (an accepted, documented trade-off from the original design): `Base.metadata.create_all()` only creates tables that don't exist yet — it does **not** add new columns to a table that's already on disk. Any local `backend/data/docmind.db` created by an earlier run of this project must be deleted before this change takes effect (a fresh clone/first run is unaffected, since the file doesn't exist yet). The implementation plan includes deleting the sandbox's existing dev DB as an explicit step. Surfaced in:
- `ChatMessageOut`/`ObservabilityRow` Pydantic schemas.
- The Observability tab's table (new "Provider" column).
- A small badge on each Chat message next to the existing latency/token footer.

## 7. New endpoint: `GET /api/settings` and `PATCH /api/settings`

```python
class ProviderInfo(BaseModel):
    id: str            # "gemini" | "ollama"
    label: str          # "Gemini" | "Ollama (llama3.2)"
    reachable: bool

class SettingsOut(BaseModel):
    active_llm_provider: str
    available_providers: list[ProviderInfo]

class SettingsUpdate(BaseModel):
    llm_provider: str
```

- `GET`: returns current state. `reachable` for Gemini is `settings.gemini_configured` (already computed for `/api/health`); for Ollama it's a live `GET {ollama_base_url}/api/tags` probe with a short timeout (~2s), caught and turned into `False` on any failure — never raises.
- `PATCH`: validates `llm_provider` is one of the two known values (422 otherwise), re-checks reachability for the target provider, rejects with a clear error if unreachable (`400`, same "Ollama service could not be reached..." message), otherwise updates `app.state.active_llm_provider` and returns the new `SettingsOut`.

## 8. Frontend

- `frontend/lib/api-client.ts`: `getSettings()`, `updateSettings(provider)`, `SettingsOut`/`ProviderInfo` types (hand-written, no backend `response_model` change needed beyond adding the route — could derive from generated types like the rest of the client does, following the pattern already established).
- New `frontend/components/ProviderSwitcher.tsx`: compact control in the `TabShell` header next to `StatusDot` — two options (Gemini / Ollama), disabled+tooltipped when a provider's `reachable` is `false`, calls `updateSettings` on change, shows an inline error banner (same pattern as `ChatTab`'s `loadError`) if the switch is rejected.
- `MessageBubble.tsx`: small provider badge (e.g. "via Ollama") next to the existing latency/token footer, sourced from the `done` SSE payload / history response.
- `ObservabilityTab.tsx`: new "Provider" column in the table.

## 9. Testing

- `ollama_generation_service.py`: same test shape as the Gemini module's — mock the SDK client, verify streaming yields deltas, usage capture, and the friendly-error-on-connection-failure path (no real Ollama server required for tests, matching the "zero network access" test constraint already established project-wide).
- `chat.py` provider dispatch: test that `app.state.active_llm_provider = "ollama"` routes to the Ollama module (mocked) instead of Gemini's, and that the persisted/streamed `provider` field matches.
- `/api/settings` endpoint: `GET` returns correct reachability shape (mock the Ollama liveness probe); `PATCH` accepts a reachable provider, rejects an unreachable one and an invalid provider id.
- Frontend: no new test suite (consistent with the rest of the project — TypeScript strict + build checks only, disclosed limitation carried forward).

## 10. Explicit non-goals for this addition

- No embedding-provider switching.
- No persistence of the active provider across restarts.
- No per-message/per-workspace provider override.
- No Ollama model-pull UI (matching AnythingLLM's actual behavior — they don't hard-block on "is this model pulled," they let the real chat-call error surface, wrapped in a friendly message; same approach here).
