#!/usr/bin/env sh
# Prefer repo-local tools so `npm run lint:py` works without a global install (CI, sandboxes, agents).
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
if [ -x "$ROOT/.venv/bin/ruff" ] && [ -x "$ROOT/.venv/bin/black" ]; then
  "$ROOT/.venv/bin/ruff" check .
  "$ROOT/.venv/bin/black" --check .
else
  ruff check .
  black --check .
fi
