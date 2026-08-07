# DocMind AI

A RAG assistant that answers questions from a document collection, with visible citations back to the exact chunk they came from. Built for a "Chat With Your Docs" take-home — Python/FastAPI backend, Next.js frontend, Gemini for embeddings and generation, everything else running locally.

This README is written the way I'd write a PR description for a senior engineer reviewing this: what I built, why, what I cut, and where I'd push back on my own decisions if I had more time.

## Quick setup

```bash
git clone <this-repo>
cd docmind-ai
cp .env.example .env
# edit .env, set GEMINI_API_KEY to a real key from https://aistudio.google.com/apikey
# optional: DEFAULT_LLM_PROVIDER (gemini|ollama, defaults to gemini), OLLAMA_BASE_URL
# (defaults to http://localhost:11434), OLLAMA_MODEL (defaults to qwen3.6:35b) — only
# needed if you want to boot with Ollama pre-selected or point at a non-default install;
# the provider is also switchable at runtime from the UI without touching .env at all
docker compose up --build
```

- Backend: `http://localhost:8000` (docs at `/docs`)
- Frontend: `http://localhost:3000`

On first boot, the backend scans `backend/data/static/` and indexes whatever's there (two seed docs about DocMind AI itself are included, so there's something to query immediately). Drop more files into that directory and restart, or just drag-and-drop into the Documents tab.

**Note on this repo's provenance:** I couldn't run Docker in the sandboxed environment I built this in, so the two Dockerfiles and `docker-compose.yml` are correct by careful static trace (port mappings, volume paths, layer ordering, build-arg wiring — all checked by hand against the actual app code) but not build-verified. Everything else — the full RAG pipeline, all 65 backend tests, both frontend dev servers — I verified for real, including one live end-to-end run against the actual Gemini API (see "What I actually verified" below). Run `docker compose up --build` locally before you trust the container path; I'd bet on it working, but "static trace" and "I watched it boot" are different confidence levels and I'm not going to blur that line here.

## Architecture

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

Not shown above to keep the box art readable: generation calls can route to a local Ollama instance (`qwen3.6:35b` by default) instead of the Gemini API box, selected at runtime via `PATCH /api/settings` rather than fixed at boot — see "RAG decisions → Ollama as a second generation provider" below. Embeddings always go through Gemini regardless of which provider is active for generation.

Two containers, no auth, single conversation thread, single document collection. That's not a minimal-viable-cop-out — it's a deliberate read of the brief. More on that in "What I deliberately didn't build."

## What I actually verified

I want to be specific about this because "I tested it" means different things depending on who's saying it.

- **65 backend pytest tests**, all passing, covering chunking boundaries, PDF/DOCX/TXT/MD parsing (with real generated fixture files, not mocked text), embedding normalization, vector store cosine-similarity math, ingestion dedup, retrieval context-budget truncation, prompt assembly, generation retry/backoff logic, upload filename sanitization, citation payload round-tripping through the JSON column, and every API route with a mocked Gemini client (so the suite runs with zero network access and zero API key requirement).
- **One real, live end-to-end run** against the actual Gemini API, not a mock: asked "What file types does DocMind AI support?" against the two seed documents, got back a real streamed answer — *"DocMind AI supports PDF, TXT, Markdown, and DOCX files [Source 1]"* — with a citation to `docmind-faq.md` at similarity score 0.7376 and a 2.9s round trip. That's the proof the retrieval → prompt → generation → citation pipeline actually works together, not just in isolation.
- **One real, live end-to-end run against a local Ollama instance** (`qwen3.6:35b`), and a real switch back to Gemini in the same session — full detail, real numbers, and the actual citation in "RAG decisions → Ollama as a second generation provider" below.
- **Both dev servers** (`uvicorn` and `next dev`) booted and served real pages, confirmed by curl and by reading the actual response bodies, not by assuming a command exited 0.
- **Docker itself: not build-verified**, for the reason above. This is the one place I'm asking you to trust careful reasoning over a green checkmark.

## RAG decisions

### Chunking: `RecursiveCharacterTextSplitter`, 1000 chars, 150 overlap

I chunk per-page, not per-document — each `ParsedPage` (a PDF page, or the whole text for TXT/MD/DOCX which don't have real pages) gets split independently, and every resulting chunk inherits that page's page number. This means a chunk never straddles a page boundary, which matters for citation accuracy: when I show "page 4" on a badge, the text really is from page 4, not spliced across 3 and 4.

I explicitly did *not* do AST-based chunking. That's the right tool for Option 2 of this assignment (code documentation), not Option 1 (document Q&A) — using it here would be reaching for a technique because it sounds sophisticated, not because it fits the problem. Recursive character splitting with a paragraph→sentence→word separator cascade is the boring, correct choice for prose.

### Embedding: `gemini-embedding-001`, 768 dimensions, manually normalized

This is the one place where my training knowledge was stale enough to matter, and it's worth explaining because it's the clearest example of "don't trust an AI assistant's memory of an API surface without checking." The original ask was `text-embedding-004`. I checked, and that model was deprecated and shut down on January 14, 2026 — building against it would have meant a broken app on day one, discovered only when someone actually ran it. The replacement, `gemini-embedding-001`, supports truncatable output dimensions (3072/1536/768/256 via Matryoshka representation), and Google's own guidance is that 768 gets near-peak retrieval quality at a quarter of the storage and compute cost of the full 3072. For a local Chroma instance with no reason to max out vector size, 768 was the obvious pick.

One catch that would have silently broken retrieval if I'd missed it: `gemini-embedding-001` doesn't auto-normalize truncated output the way the newer `gemini-embedding-2` does. So `embedding_service.py` L2-normalizes every vector client-side before it touches Chroma — without that, cosine similarity scores would be meaningless and the low-confidence threshold would fire (or not fire) essentially at random.

### Generation: `gemini-3.6-flash`, streamed

Same story — the original spec said `gemini-2.5-flash`, and by the time I was building this, `gemini-3.6-flash` had shipped (July 2026, GA). Flash over Pro because this is a retrieval-grounded task, not an open-ended reasoning task — the model's job is to synthesize an answer from provided context and cite it, not to derive novel insight. That's squarely in Flash's wheelhouse and Pro would just be slower and more expensive for no accuracy gain I'd notice in this use case.

### Ollama as a second generation provider, switchable at runtime

Everything else in this project is configured through `.env` and fixed for the life of the process — that's a deliberate pattern (see "No Alembic migrations," "Single conversation thread" elsewhere in this README: fewer moving parts, less to get wrong). Runtime provider switching is the one place I broke that pattern on purpose, and it's worth explaining why.

The case for Ollama isn't "more options are always better" — it's three specific, real trade-offs against Gemini: it runs entirely on the machine it's installed on, with no network dependency once the model is pulled; it costs nothing per token, because no API call leaves the box; and the document content and the question never leave the machine, which matters if this were ever pointed at anything sensitive. The real cost, which I'm not going to paper over: `qwen3.6:35b` is slow. My live verification run (below) took 20.7 seconds for a 336-token answer on local hardware; the equivalent Gemini call for a comparable question took 2.9 seconds. That's the actual trade-off — privacy and zero marginal cost, in exchange for roughly 7x the latency on this hardware. Anyone picking Ollama needs to know that going in, not discover it mid-demo.

Because that trade-off is real and situational rather than "Ollama is strictly better," the choice belongs at request time, not baked into a fixed deployment. That's why `PATCH /api/settings` exists as the one runtime-mutable piece of config in an otherwise env-var-only project — the extra surface area (a settings endpoint, an in-memory `app.state.active_llm_provider`, a frontend switcher) is worth it specifically because the two providers genuinely trade off against each other rather than one obsoleting the other. This is the same reasoning AnythingLLM uses for its own provider switcher, which is where I drew the pattern from directly rather than reinventing it.

The switch is connectivity-checked before it's accepted, also mirroring AnythingLLM's liveness-check pattern: `PATCH /api/settings` probes `GET {OLLAMA_BASE_URL}/api/tags` with a 2-second timeout before flipping `active_llm_provider`, and rejects the switch with a 400 if the target isn't actually reachable — so "switched to Ollama" always means Ollama was actually there when you switched, not "I set a string and we'll find out on the next chat message." A deliberate part of that design: the `reachable` field for the *other*, non-target provider in a `PATCH` response isn't re-probed on that call (skipped on purpose, to avoid paying Ollama's network round-trip on a request that's switching to Gemini), so a client that trusted that field directly, without ever re-fetching, would show it as stale. That's exactly what `ProviderSwitcher.tsx` did until a review pass caught it: it set its UI state straight from the `PATCH` response and never refetched, so the just-left provider stayed pinned at "unreachable" until a manual page reload — not a few seconds of staleness, indefinite. The fix is entirely on the frontend, not the backend: `handleSelect` now follows a successful `PATCH` with one `GET /api/settings` call (which always re-probes both providers) and renders from that response, falling back to the `PATCH` response only if the follow-up `GET` itself fails. `PATCH /api/settings` still only probes the switch target — that optimization is correct and unchanged. With the fix, the non-target field's staleness window is bounded to the round trip of that one extra `GET`, not indefinite-until-reload.

Embeddings deliberately do *not* have an Ollama option, even though Ollama can serve embedding models too. This isn't an oversight — it's the same dimension-compatibility reasoning as the embedding model choice above: every vector already in Chroma is a 768-dim `gemini-embedding-001` vector, and cosine similarity between vectors from two different embedding models — different dimensions, different semantic space — is meaningless. You'd either have to re-embed the entire store on every switch or silently corrupt retrieval. Generation is stateless per request, so switching it costs nothing; embeddings are load-bearing state, so switching them would be a migration, not a toggle. The design spec calls this out explicitly as a non-goal, and I held it throughout.

Provider selection lives in `app.state.active_llm_provider` — an in-memory variable, not a database row or a `.env` value — and resets to `DEFAULT_LLM_PROVIDER` on every backend restart. That's a documented trade-off, not something I forgot to wire up: persisting it would mean either a settings table (more schema, more migration surface, for a project that already deliberately skips Alembic) or writing back to `.env` at runtime (fragile, and wrong for a containerized deployment where `.env` is often read-only). For a single-process local tool, "restart returns you to the configured default" is honest and cheap. A multi-user or multi-replica deployment would need this in a real store — I'd add it the same day auth got added, for the same reason: both are "this now has per-user state" problems.

**What I actually verified, for real:** with the backend running against my live local Ollama instance (`qwen3.6:35b` at `http://localhost:11434`), I `PATCH`ed the provider to `ollama` and got back `"active_llm_provider": "ollama"` with both providers reported reachable. I then asked "What embedding model does DocMind AI use?" through the real `/api/chat` endpoint. The model answered, streamed token-by-token over 20.7 seconds: *"DocMind AI uses the `gemini-embedding-001` model via Google's Gemini API for generating embeddings [Source 1]."* — grounded in the actual seed doc, with a real citation to `docmind-overview.md` at similarity score 0.7624, `"provider": "ollama"` in the `done` frame, tokens_in 835 / tokens_out 336. That turn showed up with `"provider": "ollama"` in both `/api/chat/history` and `/api/observability/requests`. I then switched back to `gemini` and asked a different question ("What vector database does DocMind AI use?") through the same endpoint — got a real Gemini answer (*"DocMind AI uses ChromaDB (in persistent file mode)... [Source 3]"*) in 2.9 seconds with `"provider": "gemini"`, confirming the switch is genuinely bidirectional, not a one-way migration. Same caliber of proof as the Gemini-only end-to-end run described above — a real model, a real question, a real citation, not a mock.

### Vector store: ChromaDB, persistent local mode, cosine space

Zero-cost, zero-ops, embeds directly in the container as a file. The one thing I want to flag because it bit a reviewer during a code-review pass on this project: Chroma's *default* distance metric is L2, not cosine. If you create a collection without explicitly passing `metadata={"hnsw:space": "cosine"}`, everything downstream that assumes `similarity = 1 - distance` silently computes garbage — and worse, it doesn't error, it just returns wrong-but-plausible-looking numbers. This is exactly the kind of bug that passes a lazy test (query an identical vector against itself — L2 and cosine both give distance 0, so the bug is invisible) and fails in production. The real test in this repo stores non-unit vectors specifically so cosine and L2 diverge, and asserts the score that only cosine would produce.

### Orchestration: hand-rolled, not LangChain/LlamaIndex end-to-end

I use `langchain-text-splitters` for exactly one thing — the recursive character splitter — and nothing else from either framework. Retrieval, prompt assembly, and generation are direct calls to the `google-genai` SDK, wrapped in small, single-purpose modules (`core/rag/retrieval.py`, `core/rag/prompt.py`, `services/generation_service.py`). For a single retrieval strategy like this one, a thin custom pipeline is more debuggable and more honest about what it's doing than adopting a framework's abstractions for logic this simple. If this needed multi-step agentic reasoning, tool use, or a swappable retriever, I'd reach for LlamaIndex. It doesn't, so I didn't.

### Context management

Retrieved chunks get deduped by `(document_id, chunk_index)`, then concatenated up to a 6000-character budget — with one deliberate exception: the first chunk is always included even if it alone exceeds the budget, so a single huge relevant chunk never gets silently dropped to zero context. Conversation memory is the last 4 messages (2 exchanges), included verbatim — no summarization. That's a real trade-off, not an oversight: summarization would let the model "forget" precise details from turn 1 by turn 6, but it costs an extra LLM call and adds a failure mode (summarization drift) I didn't think was worth it for a demo-scale conversation. If this needed to support genuinely long conversations, summarization or a sliding-window-plus-summary hybrid would be the next thing I'd build.

### Quality control and guardrails

Two separate things, on purpose:

- **Guardrail** = the system prompt instructs the model to answer only from the provided sources and to say plainly when it doesn't know, rather than guess. This is a behavioral constraint on the model.
- **Quality control** = a similarity-score threshold (0.3 default) computed *before* the model ever sees the query. If the top retrieved chunk scores below that, the turn is tagged `low_confidence` and surfaced as an amber warning in the UI — this is a measurable signal about the *retrieval*, independent of what the model says. I kept these separate because they fail differently: a guardrail failure is the model ignoring instructions; a quality-control failure is the retrieval not finding anything relevant in the first place. Conflating them into "the model said something wrong" loses the ability to debug which stage actually broke.

Gemini calls are wrapped in `tenacity` retry with exponential backoff on 429/500/502/503/504 — but only around *starting* the stream, not around iterating it. Once tokens have started reaching an SSE client, retrying a failed generation would mean re-sending duplicate or garbled text; there's no clean way to resume a partially-streamed response, so a mid-stream failure propagates to an `event: error` frame instead. That's a real, disclosed limitation: a network blip 2 seconds into a long answer currently means "start over," not "resume." I'd fix this with idempotent client-side resume logic if this were going to production, but it's not a gap I'm going to pretend doesn't exist.

### Observability

Structured JSON logs (stdlib `logging` + a ~15-line custom formatter — I skipped `structlog` deliberately; same output shape, one fewer dependency for a reviewer to look up). Every chat turn records latency, tokens in/out, chunks retrieved, and top similarity score directly on the `chat_messages` row. The Observability tab in the frontend reads that same data back — this was the highest-leverage design choice in the whole UI, because it turns "we have structured logging" from a README claim into something you can click through and watch update live while you use the Chat tab. That's also just what a forward-deployed engineer's job actually looks like day to day: building the internal tool that lets a client (or a teammate) see what a system is doing without reading log files.

## Key technical decisions and why

| Decision | Why | Alternative considered |
|---|---|---|
| Citations store denormalized JSON on `chat_messages`, not a normalized `citations` table | Citations are only ever read alongside their parent message — a join buys nothing here | Normalized table with FKs — added complexity for zero query flexibility gained |
| No Alembic migrations | Schema is fixed for this project's lifetime; `Base.metadata.create_all()` is honest about that | Alembic — correct for a schema that evolves post-launch, premature here |
| Synchronous ingestion, no task queue | Files are small and local; a queue is infra weight with no payoff at this scale | Celery/RQ + Redis — the first thing I'd add for concurrent large-batch uploads |
| Single conversation thread, no session list | "Simple interface" is explicit in the brief; a session picker is UI surface area with no rubric payoff | Multi-session chat like a typical LLM product — deliberately cut |
| `expire_on_commit` snapshot before use in the SSE generator | SQLAlchemy expires ORM objects on commit by default; the chat endpoint commits the user message *then* needs to read prior history inside a generator that runs after the request-scoped session is closed — using the live ORM objects there throws `DetachedInstanceError` | Discovered this the hard way (see below) — worth calling out because it's a real, non-obvious SQLAlchemy + FastAPI + generator interaction |

That `DetachedInstanceError` is worth a specific mention because it's the best example in this codebase of "code that passes its own test suite and still breaks in the exact scenario it was built for." The chat endpoint's first version fetched conversation history, committed the new user message, then read that history again inside the streaming generator — which by then was running after FastAPI had already closed the request's DB session. It worked fine for the first message of any conversation (no history to read) and crashed on the second. None of the initial tests exercised two sequential messages in one conversation, because the endpoint's own literal spec didn't call it out as a scenario. It only surfaced during a structured code-review pass that specifically asked "does this actually work for a multi-turn conversation, which is the whole point of a chat feature?" — a good reminder that a green test suite tells you what you tested, not what you built.

## Engineering standards followed (and some I skipped)

**Followed:**
- TDD for every backend module — chunking, parsers, embedding, vector store, ingestion, retrieval, prompt, generation, and every API route were written test-first, with the failing state actually run and captured before the implementation existed.
- Structured logging and per-request metrics from day one, not bolted on later.
- Type safety across the stack boundary — the frontend's TypeScript types are generated from FastAPI's live OpenAPI schema (`scripts/generate-types.sh` → `frontend/lib/api-types.ts`), not hand-guessed and left to drift. `lib/api-client.ts` derives every response type from that generated file, so renaming a backend field breaks the frontend build instead of failing silently at runtime. The one deliberate exception: a few `str` fields (document `status`, message `status`) are re-narrowed to literal unions in the client, because the backend produces those values in code rather than via an Enum, so OpenAPI can only describe them as `string`.
- Zero hardcoded secrets — every config value flows through `pydantic-settings` reading `.env`, with `.env.example` committed and `.env` gitignored.
- Every mocked test boundary is the actual I/O edge (Gemini API calls), never the logic under test — the vector store tests hit a real ephemeral ChromaDB instance, the ingestion tests hit real SQLite, because mocking those would mean testing my mocks instead of my code.

**Skipped, on purpose:**
- No frontend test suite. I said this plainly rather than padding coverage with shallow snapshot tests that verify nothing. If I had another day, this is the first thing I'd add — React Testing Library on the three tab components, focused on the state machines (streaming, upload-busy-guard, citation-drawer-reset) rather than markup snapshots.
- No auth. Single-user local tool; building a login system for an assignment that explicitly asks for a "simple interface" would be effort spent on the wrong thing.
- No CI pipeline (GitHub Actions, etc.). The test suite exists and passes locally; wiring it into CI is mechanical and I'd rather spend the time budget on the parts of this that required actual judgment.
- Docker build itself is unverified in this repo's current state, for the environment reason explained above — flagged loudly rather than claimed.

## Productionizing this

If this needed to survive real traffic on AWS, GCP, or Azure, here's the order I'd actually do it in, not just a wishlist:

1. **Async ingestion queue.** Right now, uploading a large PDF blocks the HTTP request until embedding finishes. First thing to fix at scale: move ingestion to a background worker (Celery or RQ + Redis, or GCP Cloud Tasks / AWS SQS + Lambda if going fully managed), return `202 Accepted` immediately, and let the Documents tab's existing "processing" status do what it's already built to do.
2. **Redis for hot-query caching.** If the same questions get asked repeatedly (very likely for a doc-support use case), cache the embedding of a query and the retrieval result for some TTL — cuts Gemini embedding calls and Chroma query latency for the common case without touching correctness.
3. **Vector store migration path: Chroma → Qdrant (or a managed pgvector).** Chroma's local persistent mode doesn't cluster. The moment this needs more than one backend replica, Qdrant (self-hosted or Qdrant Cloud) is the natural next step — same metadata-filtering and cosine-similarity semantics I'm already relying on, just distributed. This is *not* a rewrite: `services/vector_store.py` is already the single seam where that swap happens; nothing above it (retrieval, ingestion) knows or cares which vector DB is behind it.
4. **Deployment topology.** My default pick would be **Cloud Run** (GCP) for both services — scale-to-zero fits a demo/internal-tool traffic pattern, and the existing Dockerfiles need zero changes to deploy there. If this were an AWS shop instead, **ECS Fargate** behind an ALB is the equivalent — same container images, more infra to hand-configure (task definitions, target groups) for the same outcome. I'd pick Cloud Run over ECS by default for anything this size purely because there's less YAML between "container that works locally" and "container that works in prod."
5. **Postgres instead of SQLite** once there's more than one backend replica — SQLite's single-writer model is fine for one container, not for horizontal scaling. The SQLAlchemy layer is already abstracted enough that this is a connection-string change plus an Alembic migration setup, not a rewrite.
6. **Auth**, if this stops being single-user — most likely an identity-aware proxy in front of Cloud Run (GCP IAP) or ECS + Cognito, rather than building auth into the app itself, unless per-user document isolation becomes a requirement (at which point it's a real schema change: documents and chat history need an owner column and every query needs a `WHERE owner = current_user` clause added, everywhere, correctly).
7. **A reranking stage** between retrieval and generation (a cross-encoder over the top-k candidates before truncation) if retrieval precision ever becomes the bottleneck — I didn't build this because with a small document collection, plain cosine similarity is already precise enough that I couldn't justify the added latency and complexity, but it's the standard next lever for RAG quality at scale.

## What I deliberately didn't build (and why that's not laziness)

The brief is explicit: *"we value a solid & well-engineered basic solution A LOT MORE than an over-engineered complex one."* I took that as an actual constraint, not a throwaway line, and cut things I initially drafted into the design before catching myself:

- **Multi-workspace / multi-tenant document collections** — one unified collection does everything the "dual-source ingestion" requirement asks for (static + uploaded documents merging into one searchable store) without the CRUD and routing surface area a workspace switcher would add.
- **A chat session list/switcher** — one continuous thread with "Clear conversation" is the actual simple interface asked for; a session picker is a feature nobody asked for grafted onto a take-home.
- **A normalized citations table, Alembic migrations, a background task queue** — all covered above, all the kind of infrastructure that's correct at 100x this scale and premature at this one.

I'd rather hand over a smaller system I can defend every line of than a bigger one where half the code is there because it "seemed thorough."

## AI-assisted development: what I did and didn't hand off

I used Claude Code for this build, and I want to be specific about the shape of that, because "I used an AI coding assistant" covers a huge range of actual practices and the brief specifically asks me to judge where AI output was and wasn't appropriate.

**What I let it own:** mechanical implementation against a spec I'd already reviewed and approved — writing a chunking function to a signature I'd specified, writing SQLAlchemy models to a schema I'd designed, writing React components to an interface I'd already decided on. This is the highest-leverage use of an AI coding assistant: it's fast at typing correct code once the *decisions* are made, and slow (or wrong) at making the decisions.

**What I did myself first, every time:** the design. Before any code got written, I went through a structured design pass — chunking strategy, embedding/LLM selection, retrieval approach, what to cut and why — and only after that was settled did implementation start. I also caught it when the model's *training knowledge* was stale in a way that mattered: the original spec called for `text-embedding-004` and `gemini-2.5-flash`, both of which had been superseded (one outright deprecated) by the time this was actually built. An AI assistant's confident, fluent description of "the Gemini API" is a description of training data, not of the live API — I verified both model names against current docs before writing a single line of code that depended on them, because shipping against a dead API isn't a hypothetical risk, it's the kind of bug that only shows up when someone actually runs the thing.

**Where I made the assistant show its work rather than trust its output:** every task in this build went through a structured review before I accepted it — spec compliance (did it build what was asked, nothing more) and code quality (is it actually correct, not just plausible-looking) as two separate questions. This caught real bugs, not style nits: a `DetachedInstanceError` that would have crashed every second message of every real conversation, a file-deletion bug where deleting one uploaded document could silently destroy a different document's file on disk if they shared a filename, a Docker `COPY` instruction using shell syntax that instruction doesn't support, and a Next.js build-time-vs-runtime environment variable bug that would have silently broken any deployment that changed the backend's port. None of these were things I asked the assistant to "double-check" — they came from treating "the tests pass" and "this is correct" as different claims, and verifying the second one separately, every time.

**My honest do's and don'ts, after actually doing this:**
- **Do** make the AI verify facts that have a shelf life — model names, API surfaces, library versions — against a live source instead of trusting what it "remembers." It will sound equally confident either way.
- **Do** separate "does this match spec" from "is this good code" as two explicit questions. An AI assistant (and a human, honestly) will happily ship code that technically satisfies a spec while being subtly wrong in ways the spec didn't anticipate.
- **Don't** let it design the system. It's genuinely good at "here are 3 ways to do X, with trade-offs" when asked — but the choice, and owning the reasoning for it, has to be mine, because that reasoning is the actual thing being evaluated here.
- **Don't** accept "the tests pass" as equivalent to "this works." The `DetachedInstanceError` bug above passed its own test suite. It failed on the exact scenario — a real multi-turn conversation — that the feature exists for, and nobody had written a test for that scenario because it wasn't explicitly called out.
- **Do** make it disclose what it *didn't* verify, as loudly as what it did. This README says outright that Docker itself is untested here. That's a more useful sentence than a confident "everything works" would have been.

## What I'd do differently with more time

In roughly the order I'd tackle them:

1. **Frontend test coverage** — React Testing Library on the streaming/upload/citation state machines, the one place I have zero automated coverage.
2. **Reranking** — a cross-encoder pass between retrieval and generation, once I had a large enough test document set to actually measure whether it improves precision.
3. **Async ingestion** — move upload processing off the request path before it becomes a real bottleneck, not after.
4. **Resumable streaming** — fix the honest gap where a mid-stream Gemini failure currently means "start the answer over" instead of "resume from where it broke."
5. **A small eval set** — a fixed list of question/expected-citation pairs run against the seed documents, checked into the repo, so a future change to chunking or retrieval parameters has a regression signal beyond "it still returns something."
6. **Static document reconciliation** — editing or deleting a file in `data/static/` doesn't clean up its old indexed version. The bootstrap only *adds* new-or-changed files (keyed by content hash), so an edited file produces a second `Document` row and a second set of vectors under the same filename while the stale ones stay queryable forever, and a deleted file's vectors are unreachable via the API (`DELETE` is intentionally blocked for `source_type=static`). For a real deployment I'd add a diff-and-prune pass to the bootstrap: any indexed static-sourced document whose file no longer exists — or whose content hash no longer matches — gets its vectors and DB row removed before the new ones are added.

### Known limitations worth stating plainly

- **Citation badges show what was *retrieved*, not what was *cited*.** Every chunk handed to the model as context gets a badge and counts toward the "N sources retrieved" footer, even if the model grounded its answer in only one of them. The UI labels this honestly rather than implying verified attribution; deriving true citations would mean parsing the `[Source N]` markers back out of the completed answer.
- **Static documents are add-only** — see item 6 above.

## Screenshots

Not included in this submission draft — I'd add these (Chat tab mid-stream with citation badges, the citation drawer open, Documents tab with mixed static/uploaded sources, Observability tab showing real request metadata, dark mode) as the last step before actually submitting, once Docker is confirmed running on a machine that has it.
