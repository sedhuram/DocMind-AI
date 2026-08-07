# DocMind AI — Setup Instructions (for agents and humans)

This file is written so an autonomous coding agent can execute it literally,
step by step, with no guessing, and know with certainty whether the app is
actually running. If you are an agent: follow section order, run the exact
commands shown, and use section 6 ("Definition of Done") to confirm success
before reporting the task complete. Do not report success on a process
starting — report success on the verification commands passing.

## 0. The one thing only a human can give you

This app calls the Gemini API for embeddings and generation. There is no way
to run it end-to-end without a real key. **Before anything else, get:**

```
GEMINI_API_KEY
```

from https://aistudio.google.com/apikey. If you are an agent and this key is
not already present in your environment or in an existing `.env` /
`backend/.env` file, **stop and ask the user for it** — do not fabricate a
placeholder value and proceed, since every later step will fail or silently
no-op on a fake key.

Everything else below is fully automatable.

## 1. What you're setting up

Two services, three data stores, one external API:

```
Next.js frontend (:3000)  --REST/SSE-->  FastAPI backend (:8000)  --> Gemini API
                                              |         |
                                          SQLite     ChromaDB
                                       (chat/docs)  (vectors, local file mode)
```

- Backend: `backend/` — Python 3.11+ / FastAPI / uvicorn.
- Frontend: `frontend/` — Node 20+ / Next.js 15.
- No external services required besides Gemini (SQLite and ChromaDB are both
  embedded, file-based, and need no separate server or install).
- Optional: a local Ollama install, only if you want the runtime-switchable
  local-LLM generation path. Not required for the default setup — see
  section 8.

## 2. Fast path — one command

From the repo root:

```bash
GEMINI_API_KEY=<your-key> ./scripts/setup.sh
```

This auto-detects whether Docker is available and picks the right path
(section 4 or 5 below), waits for both services to actually respond to HTTP
requests (not just for processes to launch), and prints one of:

```
RESULT: SUCCESS
RESULT: FAILURE - <specific reason>
```

If it prints `SUCCESS`, jump straight to section 6 to double-check, then
you're done. If it prints `FAILURE`, the reason is specific and actionable
(missing key, port conflict, Docker not installed, dependency install
failure, health check timeout) — fix that one thing and re-run; the script
is idempotent and safe to re-run from any partial state.

Useful flags:

```bash
./scripts/setup.sh --mode docker            # force the Docker path
./scripts/setup.sh --mode local             # force the no-Docker path
./scripts/setup.sh --gemini-api-key <key>   # instead of the env var
./scripts/setup.sh --help
```

To stop everything the script started:

```bash
./scripts/stop.sh              # stop containers or local dev processes
./scripts/stop.sh --reset-db   # also wipe the local database (see section 7)
```

To re-check health at any time without re-running setup:

```bash
./scripts/verify.sh
```

The rest of this document is the manual, step-by-step version of exactly
what `setup.sh` automates — read it if the script fails and you need to
diagnose why, or if you'd rather run the steps yourself.

## 3. Prerequisites

Check what's available before picking a path:

```bash
docker compose version   # Path A (Docker) if this succeeds
python3 --version        # Path B needs 3.11+ (repo verified working on 3.11–3.13)
node --version            # Path B needs 20+ (repo built/tested on 22 and 24)
```

If `docker compose version` succeeds, prefer **Path A** — it's what the
repo's own Dockerfiles and `docker-compose.yml` were written and tuned for,
and it avoids any host-specific Python/Node version drift. If Docker isn't
available in your environment, use **Path B**; it is fully supported and is
in fact the path this repo's own test suite and dev servers were verified
against (see `README.md` → "What I actually verified").

## 4. Path A — Docker Compose

```bash
cd <repo-root>
cp .env.example .env
# edit .env: set GEMINI_API_KEY=<your real key>
docker compose up --build
```

Wait for the backend healthcheck to pass — it has a 30s grace period because
the backend indexes the two seed documents in `backend/data/static/` against
the live Gemini API during startup, before `/api/health` can respond.
`docker compose up` (foreground) will show `backend ... healthy` in its
status output; if running detached (`-d`), poll with:

```bash
docker compose ps                       # look for "healthy"
curl -sf http://localhost:8000/api/health
```

**Known gotchas, already solved in this repo's config — don't "fix" them:**

- `NEXT_PUBLIC_API_BASE_URL` is baked into the frontend's JS bundle at
  **build** time (Next.js inlines it), not read at container runtime.
  `docker-compose.yml` passes it as a build arg for exactly this reason. If
  you change it, you must `docker compose build frontend` again, not just
  restart the container.
- If a database from a previous, older checkout already exists, the backend
  can fail on `no such column: chat_messages.provider`. There's no migration
  framework by design (see `README.md`). Fix: `docker compose down -v` (the
  `-v` is required — it's a named volume, so a plain `down` leaves it) then
  `docker compose up --build` again. `./scripts/stop.sh --reset-db` does
  this for you.
- Ollama is **not** needed for the default config (`DEFAULT_LLM_PROVIDER`
  defaults to `gemini`). Only read section 8 if you specifically want the
  local-LLM path.

## 5. Path B — Local dev, no Docker

### 5.1 Backend

```bash
cd backend
python3 -m venv .venv                 # skip if .venv already exists
.venv/bin/pip install -r requirements.txt
cp .env.example .env                  # skip if backend/.env already exists
# edit backend/.env: set GEMINI_API_KEY=<your real key>
mkdir -p data/static data/uploads vector_db
.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Run that last command in the background (or a separate terminal/session) —
it's a long-running server. `Settings` reads `backend/.env` relative to the
process's working directory, so the command must be run with `backend/` as
the cwd, exactly as above.

### 5.2 Frontend

In a second terminal:

```bash
cd frontend
npm ci                                # or `npm install` if package-lock.json is absent
cp .env.local.example .env.local      # skip if frontend/.env.local already exists
npm run dev
```

`NEXT_PUBLIC_API_BASE_URL` (from `.env.local`) must already point at wherever
the backend is actually reachable *before* `npm run dev` starts — Next.js
reads `.env.local` once at server start, not per-request.

## 6. Definition of Done — verify, don't assume

A process starting is not success. Confirm both of these return real,
successful responses:

```bash
curl -sf http://localhost:8000/api/health
```

Expected (fields will vary slightly, but `status` must be `"ok"` and
`gemini_configured` must be `true` — if it's `false`, the key didn't load):

```json
{"status":"ok","gemini_configured":true,"chroma_document_count":2,"sqlite_ok":true,"uptime_seconds":5}
```

```bash
curl -sfo /dev/null -w '%{http_code}\n' http://localhost:3000
```

Expected: `200`.

`chroma_document_count` should be `>= 2` once startup finishes — that's the
two seed documents in `backend/data/static/` getting indexed. If it reads
`0` right after boot, startup may still be running the indexing pass; retry
after a few seconds. `./scripts/verify.sh` runs both checks with retries and
prints a single pass/fail result.

Optional deeper check — confirm the full RAG pipeline, not just liveness:

```bash
curl -s http://localhost:8000/docs -o /dev/null -w '%{http_code}\n'   # Swagger UI, expect 200
```

Then open `http://localhost:3000` in a browser, go to the Chat tab, and ask
"What file types does DocMind AI support?" — it should stream back an answer
with a citation badge referencing one of the two seed docs.

## 7. Stopping and resetting

```bash
./scripts/stop.sh              # docker compose down, or kill local dev PIDs
./scripts/stop.sh --reset-db   # + docker compose down -v, or rm backend/data/docmind.db
```

Manual equivalents:

```bash
# Docker
docker compose down          # stop
docker compose down -v       # stop + wipe the named sqlite volume

# Local
rm backend/data/docmind.db   # wipe local sqlite db (backend must be stopped first)
```

Wiping `backend/vector_db/` is not needed for the schema-mismatch scenario
above — only the sqlite file has migrations to worry about. Deleting it
would just force re-indexing of the static docs on next boot (harmless, just
slower).

## 8. Optional: Ollama as a local LLM provider

Skip this section unless you specifically want generation to run on a local
model instead of Gemini. Embeddings always use Gemini regardless — this only
affects the `PATCH /api/settings` runtime provider switch and
`DEFAULT_LLM_PROVIDER`.

1. Install Ollama and pull the model: `ollama pull qwen3.6:35b` (or set
   `OLLAMA_MODEL` to whatever you pulled instead).
2. Ollama must listen on more than `127.0.0.1` for the Docker path to reach
   it: `OLLAMA_HOST=0.0.0.0 ollama serve`.
3. Leave `OLLAMA_BASE_URL` **commented out** in `.env`/`backend/.env` if
   running via Docker — `docker-compose.yml` already defaults it to
   `http://host.docker.internal:11434`, which is the correct address for
   "Ollama on the host, backend in a container." Setting it to `localhost`
   yourself would silently break this, since `localhost` inside the
   container means the container. Only set it explicitly if running the
   backend directly on the host (Path B), where `http://localhost:11434` is
   correct, or if Ollama lives somewhere else entirely.
4. Switch providers at runtime from the frontend's provider switcher, or via
   `PATCH /api/settings {"default_llm_provider": "ollama"}` — the backend
   liveness-checks the target before accepting the switch and returns 400 if
   it isn't actually reachable, so a successful response means it's real.

## 9. Running the test suite (extra confidence signal)

Not required to run the app, but the fastest way for an agent to confirm the
backend logic itself is intact before or after making changes:

```bash
cd backend
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/pytest
```

All 90+ tests run with zero network access and zero API key requirement —
the Gemini client is mocked at every test boundary. A failure here means a
real code problem, not an environment/config problem.

## 10. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `/api/health` returns `gemini_configured: false` | Key not in the `.env` file the backend actually reads, or `.env` wasn't picked up | Docker: confirm root `.env` has the real key and re-run `docker compose up --build`. Local: confirm `backend/.env` (not root `.env`) has it, and that uvicorn was started with `backend/` as cwd. |
| Backend container never reports healthy | Startup is indexing seed docs against Gemini — can legitimately take up to ~30s, longer on a slow network | Wait past the 30s `start_period`; if it still fails after ~2 min, check `docker compose logs backend` for a Gemini auth/quota error. |
| `no such column: chat_messages.provider` | Stale SQLite DB from an older checkout, no migration framework by design | `./scripts/stop.sh --reset-db`, then set up again. Fresh clones are unaffected. |
| Backend can't reach Ollama from inside Docker | `OLLAMA_BASE_URL` set to `localhost`, or Ollama bound to `127.0.0.1` only | Leave `OLLAMA_BASE_URL` unset under Docker (see section 8) and start Ollama with `OLLAMA_HOST=0.0.0.0`. |
| Frontend loads but API calls fail from the browser (CORS or connection refused) | `NEXT_PUBLIC_API_BASE_URL` wrong, or set *after* the frontend was already built/started | It's baked in at build/dev-start time — fix `.env.local` (local) or the compose build arg (Docker) and rebuild/restart the frontend, not just the backend. |
| `Address already in use` on port 8000 or 3000 | Another process (maybe a previous run of this same app) is already bound | `./scripts/stop.sh` to clean up a previous run, or check `lsof -i :8000` / `lsof -i :3000` for what's holding it. `./scripts/setup.sh` detects an already-healthy instance on these ports and reuses it instead of failing. |
| `pip install` fails on `chromadb` or `numpy` | Missing system build toolchain for a native dependency | Use Path A (Docker) instead — `python:3.11-slim` in the Dockerfile is a known-good build environment; this is the main reason Docker is the recommended path. |
