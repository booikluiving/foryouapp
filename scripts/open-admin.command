#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
APP_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
PORT="${PORT:-3000}"
LOG_FILE="${TMPDIR:-/tmp}/foryou-server.log"

cd "$APP_DIR"

if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Server draait al op poort $PORT."
else
  echo "Server starten op poort $PORT..."
  nohup npm start >"$LOG_FILE" 2>&1 &
  sleep 1
fi

open "http://localhost:${PORT}/admin"
