# DocMind AI — Design Spec

**Date:** 2026-08-06
**Context:** Engineering interview assignment (Forward Deployed Engineer role) — Option 1: "Chat With Your Docs" from the assignment brief. Evaluated on RAG judgment, code cleanliness, containerization, testing, observability, and README quality — explicitly *not* on feature count. Brief states: "we value a solid & well-engineered basic solution A LOT MORE than an over-engineered complex one."

## 1. Goals

- Answer questions grounded in a document collection, with visible citations back to source chunks.
- Support two ingestion paths into one unified collection: static bootstrap directory (indexed on startup) and drag-and-drop upload (indexed on demand).
- Stream answers token-by-token (SSE) with a typewriter UI.
- Make RAG internals (retrieval quality, latency, token usage) inspectable in the UI itself, not just in logs — this doubles as the "Observability" rubric answer and as the kind of internal tooling an FDE builds for clients.
- Present as a polished, single-tenant internal tool: clean UI, dark/light mode, sensible error/empty states. Not a toy chat box.

## 2. Explicit non-goals (and why)

| Cut | Reason |
|---|---|
| Multi-workspace / multi-tenant | No rubric line asks for it; adds CRUD + routing surface area for no evaluative payoff. Single default collection serves the "dual-source ingestion" requirement just as well. |
| Auth / login | Single-user local tool. Auth plumbing isn't what's being evaluated here. |
| Chat session list/switcher | One continuous thread + "Clear conversation." A session picker is UI surface area the brief's "simple interface" ask doesn't call for. |
| Normalized `citations` table | Citations are only ever read alongside their parent message — store as a JSON column on `chat_messages` instead of forcing a join. |
| Alembic / migrations framework | Schema is fixed for this project's lifetime. `Base.metadata.create_all()` on startup. Named explicitly as a production gap in the README. |
| Background task queue for ingestion | Files are small and local; synchronous ingest-on-request. Async worker + queue is called out as the first thing to add at scale. |
| `structlog` or other logging framework | Stdlib `logging` + a small custom JSON formatter gets the same structured-log outcome with one fewer dependency to look up. |
| True AST-based chunking | That's a code-documentation-assistant concept (Option 2 of the brief), not Option 1. Semantic-boundary-aware recursive splitting is the right tool here; using AST parsing on prose would be cargo-culting a technique from the wrong problem. |
| Live Gemini ping in `/api/health` | Don't burn a third-party API's quota on a health check. Health reports config presence + local component status (Chroma, SQLite) instead. |

## 3. Architecture

```
                         ┌─────────────────────────┐
                         │   Next.js 15 Frontend    │
                         │  Tabs: Chat / Documents  │
                         │  / Observability          │
                         │  Tailwind, SSE client     │
                         └───────────┬──────────────┘
                                     │ REST + SSE (typed via generated
                                     │ OpenAPI → TS client)
                         ┌───────────▼──────────────┐
                         │       FastAPI Backend      │
                         │ ┌────────┐   ┌───────────┐ │
                         │ │ api/   │   │ core/rag/ │ │
                         │ │ chat   │   │ chunking  │ │
                         │ │ docs   │   │ retrieval │ │
                         │ │ health │   │ generation│ │
                         │ │ observ.│   │ prompt    │ │
                         │ └───┬────┘   └─────┬─────┘ │
                         └─────┼──────────────┼───────┘
                        ┌──────▼───┐    ┌─────▼─────────┐
                        │ SQLite    │    │  ChromaDB      │
                        │ documents │    │  persistent,   │
                        │ chat_msgs │    │  local file mode│
                        └───────────┘    └────────────────┘
                                     ▲
                          ┌──────────┴───────────┐
                          │      Gemini API        │
                          │ gemini-embedding-001   │
                          │ (768-dim, normalized)  │
                          │ gemini-3.6-flash        │
                          │ (streaming generation) │
                          └────────────────────────┘
```

Two containers: `backend` (FastAPI + uvicorn) and `frontend` (Next.js). SQLite and Chroma are files on mounted volumes, not separate services.

## 4. Tech stack

- **Backend:** Python 3.11+, FastAPI, Pydantic v2, `google-genai` SDK, `langchain-text-splitters` (only for `RecursiveCharacterTextSplitter`), ChromaDB (persistent client), SQLAlchemy 2.0, `tenacity` (retry/backoff), `pypdf` (PDF text + page numbers), `python-docx` (DOCX text + paragraph index), stdlib `logging` with custom JSON formatter, `pytest`.
- **Frontend:** Next.js 15 (App Router, TypeScript), Tailwind CSS, Lucide icons, `react-markdown` for message rendering, native `fetch` + `ReadableStream` for SSE (no extra streaming lib needed).
- **Models:** `gemini-embedding-001` (embeddings, output_dimensionality=768, manually L2-normalized before writing to Chroma — this model does not auto-normalize truncated output, unlike `gemini-embedding-2`), `gemini-3.6-flash` (generation, streaming).
- **Storage:** ChromaDB persistent mode at `backend/vector_db/`, SQLite file at `backend/data/docmind.db`.

## 5. Data model (SQLite)

**`documents`**
`id (uuid pk), filename, source_type (static|upload), file_hash (sha256, unique), status (indexed|processing|failed), status_detail (text, nullable — error message on failure), chunk_count (int), size_bytes (int), created_at, indexed_at (nullable)`

**`chat_messages`**
`id (uuid pk), role (user|assistant), content (text), citations (JSON, nullable — array of {document_id, filename, chunk_index, page_number (nullable), score}), latency_ms (int, nullable), tokens_in (int, nullable), tokens_out (int, nullable), chunks_retrieved (int, nullable), top_score (float, nullable), status (ok|low_confidence|error), created_at`

One row per turn (user and assistant messages both stored) — this table backs both the Chat tab's history and the Observability tab's request log directly; no separate log table.

## 6. Ingestion pipeline

Single `IngestionService.ingest(file_path, source_type)` used by both entry points:

1. **Static bootstrap** — FastAPI lifespan hook scans `backend/data/static/` on startup. Each file is hashed (SHA256); if the hash already exists in `documents` with `status=indexed`, skip (avoids re-embedding cost on every container restart). New/changed files are queued through the same ingestion call.
2. **Dynamic upload** — `POST /api/documents/upload` (multipart) saves to `backend/data/uploads/{uuid}_{filename}`, creates a `documents` row (`status=processing`), then ingests synchronously and returns the final status. Rejected up front (422) if file type isn't in `{pdf, txt, md, docx}` or exceeds a configured size cap.
3. **Parse → chunk → embed → store**, per file, wrapped in try/except: parse failures set `status=failed` with `status_detail` and move on — one bad file doesn't abort a batch.
   - Parsing: `pypdf` for PDF (captures page number per extracted block), `python-docx` for DOCX (paragraph index in place of page number, documented as a known limitation — Word has no fixed pagination without rendering), plain read for TXT/MD.
   - Chunking: `RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=150)`, default separator cascade (paragraph → sentence → word → char) so splits favor semantic boundaries over hard character cuts.
   - Embedding: batched calls to `gemini-embedding-001`, `output_dimensionality=768`, L2-normalized client-side.
   - Storage: Chroma collection explicitly configured with `hnsw:space="cosine"` (Chroma's default is L2, which would silently mismatch the similarity-threshold logic below). `add()` with id `{document_id}_{chunk_index}`, metadata `{document_id, filename, source_type, chunk_index, page_number}`.
4. On success, `documents.status=indexed`, `chunk_count` set, `indexed_at` set.

## 7. Retrieval & generation

- Query embedded the same way as ingestion (`gemini-embedding-001`, 768-dim, normalized).
- Chroma similarity search, `k=5` (configurable via env). Chroma returns cosine *distance*; the vector store wrapper converts to similarity as `1 - distance` before it's used anywhere else in the pipeline, so every downstream consumer (threshold check, UI badge, observability log) deals in one consistent "higher is better" score.
- **Quality control:** if the top result's similarity score is below a configured threshold (default 0.3), the retrieved context is still passed but the prompt explicitly instructs the model to say it doesn't have enough information rather than guess — and the response is tagged `status=low_confidence` in `chat_messages` for visibility in the Observability tab.
- **Context management:** retrieved chunks deduplicated if they overlap the same document region, then concatenated up to a ~6000-character budget (roughly 1500 tokens) — capping cost and keeping the prompt within a predictable window regardless of how many large chunks match.
- **Conversation memory:** last 4 turns (2 exchanges) included verbatim in the prompt for continuity. No summarization of older turns — dropped instead, a stated trade-off (documented in README) rather than unbounded prompt growth.
- **Prompt template** (system instruction): answer only from the provided context; cite using inline markers matching the numbered sources; if the context doesn't contain the answer, say so plainly instead of speculating.
- **Generation:** `gemini-3.6-flash`, `stream=True` via `google-genai`. Backend re-emits tokens as SSE `event: token` frames; final `event: done` frame carries citations array, `tokens_in/out`, `latency_ms`, `chunks_retrieved`, `top_score`.
- **Guardrail:** Gemini calls wrapped in `tenacity` retry with exponential backoff on 429/503; after retries exhausted, a graceful error message is streamed to the client instead of a raw exception, and the turn is recorded with `status=error`.

## 8. API surface

- `POST /api/chat` — SSE stream; body `{message: string}`. Appends to the single running conversation.
- `GET /api/chat/history` — full message list for page load.
- `DELETE /api/chat/history` — clear conversation.
- `GET /api/documents` — list all documents with status/metadata.
- `POST /api/documents/upload` — multipart upload + synchronous ingest.
- `DELETE /api/documents/{id}` — remove an uploaded document (Chroma chunks + SQLite row + file). Static-sourced documents are not deletable via API (they'd reappear on next restart since the static directory is re-scanned) — the UI disables delete for `source_type=static` and explains why on hover.
- `GET /api/documents/{id}/chunks/{chunk_index}` — fetch one chunk's text, for the citation preview drawer.
- `GET /api/observability/requests` — paginated recent `chat_messages` rows (assistant turns only) with latency/token/retrieval metadata.
- `GET /api/health` — `{status, gemini_configured, chroma_document_count, sqlite_ok, uptime_seconds}`.

OpenAPI schema auto-generated by FastAPI; `scripts/generate-types.sh` runs `openapi-typescript` against it to produce `frontend/lib/api-types.ts`, committed to the repo (avoids requiring a live backend during `docker build` just to generate types).

## 9. Frontend

Three tabs in a single-page app shell (no routing complexity beyond tab state):

- **Chat** — message list (markdown-rendered), typewriter streaming via SSE, citation badges under each assistant message that open a side drawer with the exact chunk text (highlighted) and its source file/page — lets a reviewer verify grounding themselves instead of trusting a claim. Per-message footer: latency, token count, sources used. "Clear conversation" action.
- **Documents** — table of all ingested documents (source badge, status, chunk count, size, timestamp), drag-and-drop upload zone with per-file progress, delete action (disabled + explained for static-sourced docs).
- **Observability** — table of recent requests: query (truncated), latency, tokens in/out, chunks retrieved, top similarity score, status badge (ok/low-confidence/error). This is the working proof of the "Observability" rubric line, not just a README claim.

Cross-cutting: dark/light theme toggle, header status dot backed by `/api/health`, graceful empty states (no docs yet → prompts to upload or drop into `data/static/`), graceful error toasts (upload rejected, rate-limited, etc).

## 10. Testing

Backend pytest, scoped to the logic that's actually risky to get wrong:
- Chunking: boundary behavior, overlap correctness, empty-input handling.
- Prompt assembly: context truncation at the character budget, conversation window capping at 4 turns.
- Citation formatting: chunk metadata → badge payload shape.
- Ingestion dedup: same file hash is skipped on a second bootstrap scan.
- One API-level test for `/api/chat` with a mocked Gemini client (streaming + citation shape), and one for the low-confidence path.

No frontend test suite — stated plainly in the README as a time-boxed cut, not hidden.

## 11. Docker Compose & config

Two services (`backend`, `frontend`), backend volumes for `data/static`, `data/uploads`, `vector_db/`, and the SQLite file — all bind-mounted so state survives container recreation. All secrets/config via `.env` read through `pydantic-settings`; `.env.example` checked in with placeholder values, real `.env` gitignored. Required var: `GEMINI_API_KEY`. Optional tunables exposed as env vars: `RETRIEVAL_TOP_K`, `CONTEXT_CHAR_BUDGET`, `LOW_CONFIDENCE_THRESHOLD`, `MAX_UPLOAD_SIZE_MB`.

## 12. Monorepo layout

```
docmind-ai/  (repo root, this directory)
  backend/
    app/
      api/            # routers: chat, documents, health, observability
      core/
        rag/           # chunking, embedding, retrieval, generation, prompt templates
        config.py       # pydantic-settings
        logging.py       # stdlib logging + JSON formatter
      models/           # Pydantic schemas + SQLAlchemy ORM
      services/          # IngestionService, GeminiClient wrapper, VectorStore wrapper
      db/                 # SQLAlchemy session/engine
      main.py
    data/
      static/
      uploads/
    vector_db/            # gitignored, created at runtime
    tests/
    Dockerfile
    pyproject.toml
    .env.example
  frontend/
    app/                  # Next.js 15 app router
    components/
    lib/                  # api client, generated api-types.ts
    Dockerfile
    package.json
  scripts/
    generate-types.sh
  docker-compose.yml
  README.md
```

## 13. Deferred items (for README "what's next")

Async ingestion via task queue (Celery/RQ + Redis) for large batch uploads; Redis caching for repeat queries; migration path to a clustered vector DB (Qdrant) for multi-node scale; multi-workspace/tenant support; auth; conversation summarization memory instead of hard truncation; reranking stage (cross-encoder) before generation; Alembic migrations once schema needs to evolve post-launch.
