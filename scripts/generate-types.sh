#!/usr/bin/env bash
set -euo pipefail

BACKEND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../backend" && pwd)"
FRONTEND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../frontend" && pwd)"

cd "$BACKEND_DIR"
.venv/bin/python -c "
import json
from app.main import app
print(json.dumps(app.openapi()))
" > /tmp/docmind-openapi.json

cd "$FRONTEND_DIR"
npx --yes openapi-typescript /tmp/docmind-openapi.json -o lib/api-types.ts

echo "Regenerated frontend/lib/api-types.ts from the live FastAPI OpenAPI schema."
