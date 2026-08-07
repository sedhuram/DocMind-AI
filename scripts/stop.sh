#!/usr/bin/env bash
# DocMind AI - stop whatever scripts/setup.sh (or a manual docker compose up)
# started. Safe to run even if nothing is running.
#
# Usage:
#   ./scripts/stop.sh              stop containers or local dev processes
#   ./scripts/stop.sh --reset-db   also wipe the database (see SETUP.md section 7)
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="$ROOT_DIR/.run"
BACKEND_DIR="$ROOT_DIR/backend"

RESET_DB=0
[[ "${1:-}" == "--reset-db" ]] && RESET_DB=1

log() { echo "[stop] $*"; }

stopped_something=0

# ---- Docker path ----
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  cd "$ROOT_DIR"
  if [[ -n "$(docker compose ps -q 2>/dev/null)" ]]; then
    if (( RESET_DB )); then
      log "Stopping containers and removing volumes (docker compose down -v)..."
      docker compose down -v
    else
      log "Stopping containers (docker compose down)..."
      docker compose down
    fi
    stopped_something=1
  fi
fi

# ---- Local path ----
for name in backend frontend; do
  pid_file="$RUN_DIR/$name.pid"
  if [[ -f "$pid_file" ]]; then
    pid="$(cat "$pid_file")"
    if kill -0 "$pid" 2>/dev/null; then
      log "Stopping local $name process (pid $pid)..."
      kill "$pid" 2>/dev/null || true
      for _ in $(seq 1 10); do
        kill -0 "$pid" 2>/dev/null || break
        sleep 0.5
      done
      kill -9 "$pid" 2>/dev/null || true
      stopped_something=1
    fi
    rm -f "$pid_file"
  fi
done

if (( RESET_DB )); then
  db_file="$BACKEND_DIR/data/docmind.db"
  if [[ -f "$db_file" ]]; then
    # Refuse to delete a file some other, untracked process still has open --
    # e.g. a backend dev server this script didn't start (no PID file for it
    # above), started manually or by another tool. Deleting out from under a
    # live SQLite connection doesn't fail loudly: the app keeps working off
    # the now-unlinked file until its next restart, then silently loses all
    # data with no error at the moment it actually happens.
    if command -v lsof >/dev/null 2>&1; then
      holders="$(lsof -t "$db_file" 2>/dev/null | sort -u | tr '\n' ' ')"
      if [[ -n "$(echo "$holders" | tr -d '[:space:]')" ]]; then
        log "ERROR: $db_file is still open by process(es): $holders"
        log "Refusing to delete it out from under a running server. Stop that process first (it may not be one this script started), then re-run --reset-db."
        exit 1
      fi
    fi
    log "Removing local database $db_file..."
    rm -f "$db_file"
  fi
fi

if (( stopped_something )); then
  log "Done."
else
  log "Nothing appeared to be running (no containers, no tracked local PIDs)."
fi
