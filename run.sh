#!/usr/bin/env bash
# Easy Tibetan Copy : start script.
# Creates/uses a local virtualenv, installs deps once, then runs the server.
set -euo pipefail
cd "$(dirname "$0")"

VENV=.venv
PORT="${PORT:-8000}"
HOST="${HOST:-127.0.0.1}"

if [ ! -d "$VENV" ]; then
  echo "→ Creating virtualenv…"
  python3 -m venv "$VENV"
fi
# shellcheck disable=SC1091
source "$VENV/bin/activate"

if [ ! -f "$VENV/.deps-installed" ]; then
  echo "→ Installing dependencies (first run only)…"
  pip install --upgrade pip >/dev/null
  pip install -r requirements.txt
  touch "$VENV/.deps-installed"
fi

echo "→ Easy Tibetan Copy running at http://$HOST:$PORT"
exec uvicorn app.main:app --host "$HOST" --port "$PORT"
