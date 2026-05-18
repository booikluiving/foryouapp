#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
APP_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
REPO_DIR="$(cd -- "$APP_DIR" && git rev-parse --show-toplevel 2>/dev/null || true)"
APP_LABEL="${FORYOU_LAUNCHD_LABEL:-nl.foryou.app}"
APP_PORT="${FORYOU_PORT:-3310}"
APP_BRANCH="${FORYOU_BRANCH:-main}"
ALLOW_LIVE_BRANCH="${FORYOU_ALLOW_LIVE_BRANCH:-0}"
PLIST_PATH="$HOME/Library/LaunchAgents/${APP_LABEL}.plist"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

fail() {
  echo "FOUT: $*" >&2
  exit 1
}

info() {
  echo "==> $*"
}

[[ -n "$REPO_DIR" ]] || fail "Geen git clone gevonden rond $APP_DIR."
[[ -f "$PLIST_PATH" ]] || fail "LaunchAgent ontbreekt. Run eerst scripts/mac-studio-setup.command."

if [[ "$APP_PORT" == "3310" && "$APP_BRANCH" != "main" && "$ALLOW_LIVE_BRANCH" != "1" ]]; then
  fail "Live update op poort 3310 mag standaard alleen vanaf main. Gebruik scripts/mac-studio-preview.command ${APP_BRANCH} voor branch-preview, of zet bewust FORYOU_ALLOW_LIVE_BRANCH=1."
fi

cd "$REPO_DIR"
if [[ -n "$(git status --porcelain)" ]]; then
  fail "Werkmap heeft lokale wijzigingen. Commit/stash die eerst, zodat update geen showcode overschrijft."
fi

info "Laatste code ophalen van origin/${APP_BRANCH}."
git fetch origin "$APP_BRANCH"
git checkout "$APP_BRANCH"
git pull --ff-only origin "$APP_BRANCH"

info "Dependencies bijwerken."
cd "$APP_DIR"
npm install

info "Service herstarten."
launchctl kickstart -k "gui/$(id -u)/$APP_LABEL" >/dev/null 2>&1 || {
  launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH"
}

info "Wachten op server."
for _ in {1..40}; do
  body="$(curl -fsS --max-time 1 "http://127.0.0.1:${APP_PORT}/health" 2>/dev/null || true)"
  if [[ "$body" == *'"ok":true'* && "$body" == *'"buildLabel"'* ]]; then
    npm run smoke -- --url "http://127.0.0.1:${APP_PORT}"
    echo ""
    echo "Update klaar: http://127.0.0.1:${APP_PORT}/admin"
    exit 0
  fi
  sleep 0.5
done

fail "Server werd niet gezond na update."
