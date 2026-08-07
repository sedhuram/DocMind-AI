#!/usr/bin/env bash
# DocMind AI - deterministic bootstrap script.
#
# Designed to be run by an autonomous coding agent as well as a human:
# idempotent (safe to re-run from any partial state), fails loudly with a
# specific reason instead of hanging or guessing, and always ends by
# printing exactly one of:
#
#   RESULT: SUCCESS
#   RESULT: FAILURE - <specific reason>
#
# See SETUP.md for the full manual walkthrough this script automates.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="$ROOT_DIR/.run"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
BACKEND_URL="http://localhost:8000"
FRONTEND_URL="http://localhost:3000"

MODE="${MODE:-}"
GEMINI_KEY_ARG=""

usage() {
  cat <<EOF
Usage: $0 [--mode docker|local] [--gemini-api-key KEY]

  --mode                Force 'docker' or 'local'. Default: auto-detect
                         (docker if 'docker compose version' succeeds, else local).
  --gemini-api-key KEY   Gemini API key to write into the env file. Optional if
                         GEMINI_API_KEY is already exported, or already present
                         in an existing .env / backend/.env file.
  -h, --help             Show this help.

Environment variables honored: GEMINI_API_KEY, MODE
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode) MODE="$2"; shift 2 ;;
    --gemini-api-key) GEMINI_KEY_ARG="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage; exit 2 ;;
  esac
done

log() { echo "[setup] $*"; }
fail() {
  echo "[setup] ERROR: $*" >&2
  echo "RESULT: FAILURE - $*"
  exit 1
}

mkdir -p "$RUN_DIR"

# ---------- helpers ----------

# wait_for_http URL TIMEOUT_SECONDS
wait_for_http() {
  local url="$1" timeout="$2" waited=0
  while (( waited < timeout )); do
    if curl -sf -o /dev/null "$url"; then
      return 0
    fi
    sleep 2
    waited=$((waited + 2))
  done
  return 1
}

# get_env_value FILE KEY -> prints value or empty
get_env_value() {
  local file="$1" key="$2"
  [[ -f "$file" ]] || return 0
  grep -E "^${key}=" "$file" | tail -1 | cut -d= -f2- || true
}

# set_env_value FILE KEY VALUE -> upserts KEY=VALUE into FILE
set_env_value() {
  local file="$1" key="$2" value="$3" tmp
  tmp="$(mktemp)"
  if [[ -f "$file" ]]; then
    grep -vE "^${key}=" "$file" > "$tmp" || true
  fi
  printf '%s=%s\n' "$key" "$value" >> "$tmp"
  mv "$tmp" "$file"
}

port_responds() {
  curl -sf -o /dev/null --max-time 2 "$1"
}

# ---------- 1. Resolve mode ----------

if [[ -z "$MODE" ]]; then
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    MODE="docker"
  else
    MODE="local"
  fi
  log "Auto-detected mode: $MODE"
elif [[ "$MODE" != "docker" && "$MODE" != "local" ]]; then
  fail "invalid --mode '$MODE', expected 'docker' or 'local'"
fi

# ---------- 2. Resolve GEMINI_API_KEY ----------

if [[ "$MODE" == "docker" ]]; then
  ENV_FILE="$ROOT_DIR/.env"
  ENV_EXAMPLE="$ROOT_DIR/.env.example"
else
  ENV_FILE="$BACKEND_DIR/.env"
  ENV_EXAMPLE="$BACKEND_DIR/.env.example"
fi

[[ -f "$ENV_FILE" ]] || cp "$ENV_EXAMPLE" "$ENV_FILE"

RESOLVED_KEY="${GEMINI_KEY_ARG:-${GEMINI_API_KEY:-$(get_env_value "$ENV_FILE" GEMINI_API_KEY)}}"

if [[ -z "$RESOLVED_KEY" || "$RESOLVED_KEY" == "your-gemini-api-key-here" ]]; then
  fail "no GEMINI_API_KEY available. Get one from https://aistudio.google.com/apikey and re-run with GEMINI_API_KEY=<key> $0, or --gemini-api-key <key>. An agent should ask the user for this rather than fabricate a value."
fi

set_env_value "$ENV_FILE" GEMINI_API_KEY "$RESOLVED_KEY"
log "GEMINI_API_KEY resolved and written to $ENV_FILE"

# ---------- 3. Run the chosen path ----------

if [[ "$MODE" == "docker" ]]; then
  command -v docker >/dev/null 2>&1 || fail "docker not found on PATH but --mode docker was requested"
  docker compose version >/dev/null 2>&1 || fail "'docker compose' not available (is Docker Desktop/daemon running?)"

  cd "$ROOT_DIR"
  log "Building and starting containers (this can take a few minutes on first run)..."
  if ! docker compose up --build -d; then
    fail "'docker compose up --build' failed - see output above"
  fi

  log "Waiting for backend health check (startup indexes seed docs against Gemini, can take ~30s)..."
  if ! wait_for_http "$BACKEND_URL/api/health" 120; then
    docker compose logs backend --tail 50 >&2 || true
    fail "backend did not become healthy within 120s - see 'docker compose logs backend' above"
  fi

  log "Waiting for frontend..."
  if ! wait_for_http "$FRONTEND_URL" 60; then
    docker compose logs frontend --tail 50 >&2 || true
    fail "frontend did not respond within 60s - see 'docker compose logs frontend' above"
  fi

else
  # ----- local mode -----

  # Backend
  if port_responds "$BACKEND_URL/api/health"; then
    log "Backend already responding on :8000, reusing it."
  else
    if lsof -i :8000 >/dev/null 2>&1; then
      fail "port 8000 is in use but not answering /api/health - run ./scripts/stop.sh or free the port and retry"
    fi

    [[ -x "$BACKEND_DIR/.venv/bin/python" ]] || {
      log "Creating backend virtualenv..."
      python3 -m venv "$BACKEND_DIR/.venv" || fail "python3 -m venv failed - is python3 (3.11+) installed?"
    }

    log "Installing backend dependencies..."
    "$BACKEND_DIR/.venv/bin/pip" install --quiet --disable-pip-version-check -r "$BACKEND_DIR/requirements.txt" \
      || fail "pip install -r backend/requirements.txt failed - see output above. Consider --mode docker instead if this is a native-build toolchain issue (e.g. chromadb/numpy)."

    mkdir -p "$BACKEND_DIR/data/static" "$BACKEND_DIR/data/uploads" "$BACKEND_DIR/vector_db"

    log "Starting backend (uvicorn) in the background..."
    (
      cd "$BACKEND_DIR"
      nohup .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000 \
        > "$RUN_DIR/backend.log" 2>&1 &
      echo $! > "$RUN_DIR/backend.pid"
    )

    log "Waiting for backend health check (startup indexes seed docs against Gemini, can take ~30s)..."
    if ! wait_for_http "$BACKEND_URL/api/health" 120; then
      tail -n 50 "$RUN_DIR/backend.log" >&2 || true
      fail "backend did not become healthy within 120s - see $RUN_DIR/backend.log above"
    fi
  fi

  # Frontend
  if port_responds "$FRONTEND_URL"; then
    log "Frontend already responding on :3000, reusing it."
  else
    if lsof -i :3000 >/dev/null 2>&1; then
      fail "port 3000 is in use but not answering - run ./scripts/stop.sh or free the port and retry"
    fi

    [[ -f "$FRONTEND_DIR/.env.local" ]] || cp "$FRONTEND_DIR/.env.local.example" "$FRONTEND_DIR/.env.local"

    if [[ ! -d "$FRONTEND_DIR/node_modules" ]]; then
      log "Installing frontend dependencies..."
      (cd "$FRONTEND_DIR" && npm ci) || (cd "$FRONTEND_DIR" && npm install) \
        || fail "npm install failed - is node (20+) and npm installed?"
    fi

    log "Starting frontend (next dev) in the background..."
    (
      cd "$FRONTEND_DIR"
      nohup npm run dev > "$RUN_DIR/frontend.log" 2>&1 &
      echo $! > "$RUN_DIR/frontend.pid"
    )

    log "Waiting for frontend..."
    if ! wait_for_http "$FRONTEND_URL" 60; then
      tail -n 50 "$RUN_DIR/frontend.log" >&2 || true
      fail "frontend did not respond within 60s - see $RUN_DIR/frontend.log above"
    fi
  fi
fi

# ---------- 4. Final verification ----------

HEALTH_JSON="$(curl -sf "$BACKEND_URL/api/health")" || fail "final health check request failed"
echo "$HEALTH_JSON" | grep -q '"status":"ok"' || fail "backend /api/health did not report status ok: $HEALTH_JSON"
echo "$HEALTH_JSON" | grep -q '"gemini_configured":true' || fail "backend reports gemini_configured=false - the API key did not load: $HEALTH_JSON"

log "Backend:  $BACKEND_URL (docs at $BACKEND_URL/docs)"
log "Frontend: $FRONTEND_URL"
log "Health:   $HEALTH_JSON"
echo "RESULT: SUCCESS"
