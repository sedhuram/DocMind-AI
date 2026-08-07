#!/usr/bin/env bash
# DocMind AI - health verification, independent of how the app was started
# (docker compose or scripts/setup.sh --mode local). Safe to run any time.
#
# Prints one of:
#   RESULT: SUCCESS
#   RESULT: FAILURE - <specific reason>
set -uo pipefail

BACKEND_URL="http://localhost:8000"
FRONTEND_URL="http://localhost:3000"
RETRIES=15
SLEEP_SECONDS=2

fail() {
  echo "RESULT: FAILURE - $*"
  exit 1
}

attempt=0
HEALTH_JSON=""
until [[ -n "$HEALTH_JSON" ]] || (( attempt >= RETRIES )); do
  HEALTH_JSON="$(curl -sf "$BACKEND_URL/api/health" 2>/dev/null)" || true
  [[ -n "$HEALTH_JSON" ]] && break
  attempt=$((attempt + 1))
  sleep "$SLEEP_SECONDS"
done

[[ -n "$HEALTH_JSON" ]] || fail "backend not reachable at $BACKEND_URL/api/health after $((RETRIES * SLEEP_SECONDS))s"

echo "$HEALTH_JSON" | grep -q '"status":"ok"' \
  || fail "backend responded but status is not ok: $HEALTH_JSON"
echo "$HEALTH_JSON" | grep -q '"gemini_configured":true' \
  || fail "backend responded but gemini_configured is false (API key not loaded): $HEALTH_JSON"
echo "$HEALTH_JSON" | grep -q '"sqlite_ok":true' \
  || fail "backend responded but sqlite_ok is false: $HEALTH_JSON"

FRONTEND_CODE="$(curl -sfo /dev/null -w '%{http_code}' "$FRONTEND_URL" 2>/dev/null)" \
  || fail "frontend not reachable at $FRONTEND_URL"
[[ "$FRONTEND_CODE" == "200" ]] || fail "frontend at $FRONTEND_URL returned HTTP $FRONTEND_CODE, expected 200"

echo "[verify] backend:  $HEALTH_JSON"
echo "[verify] frontend: HTTP $FRONTEND_CODE"
echo "RESULT: SUCCESS"
