#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
APP_DIR="${FORYOU_APP_DIR:-$(cd -- "$SCRIPT_DIR/.." && pwd)}"
BASE_DIR="${FORYOU_BASE_DIR:-$(cd -- "$APP_DIR/.." && pwd)}"
WORKTREE_ROOT="${FORYOU_WORKTREE_ROOT:-$BASE_DIR/worktrees}"
LOG_DIR="${FORYOU_LOG_DIR:-$HOME/Library/Logs/ForYouApp}"
PREVIEW_PORT="${FORYOU_PREVIEW_PORT:-3311}"
PREVIEW_HOST="${FORYOU_PREVIEW_HOST:-127.0.0.1}"
ADMIN_AUTH_DISABLED="${FORYOU_ADMIN_AUTH_DISABLED:-1}"
ADMIN_BOOTSTRAP_PASSWORD="${FORYOU_PREVIEW_ADMIN_PASSWORD:-${FORYOU_ADMIN_PASSWORD:-Tijdelijk_2026!}}"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

fail() {
  echo "FOUT: $*" >&2
  exit 1
}

info() {
  echo "==> $*" >&2
}

usage() {
  cat <<USAGE
Gebruik:
  scripts/mac-studio-preview.command [branch]
  scripts/mac-studio-preview.command stop [branch]
  scripts/mac-studio-preview.command status [branch]

Voorbeelden:
  scripts/mac-studio-preview.command codex/mijn-werk
  FORYOU_PREVIEW_PORT=3312 scripts/mac-studio-preview.command codex/mijn-werk
  scripts/mac-studio-preview.command stop codex/mijn-werk

Live poort 3310 blijft gereserveerd voor main/launchd. Gebruik een previewpoort
voor branch-werk, tenzij je expliciet FORYOU_ALLOW_LIVE_PREVIEW=1 zet.
USAGE
}

safe_name() {
  local value="$1"
  value="${value//\//-}"
  value="${value//:/-}"
  value="${value// /-}"
  value="$(printf '%s' "$value" | tr -cd '[:alnum:]._-' | sed -e 's/^-*//' -e 's/-*$//')"
  [[ -n "$value" ]] || value="preview"
  echo "$value"
}

default_branch() {
  git -C "$APP_DIR" branch --show-current 2>/dev/null || echo "main"
}

pid_file_for() {
  local safe_branch="$1"
  echo "$LOG_DIR/preview-${safe_branch}.pid"
}

log_file_for() {
  local safe_branch="$1"
  echo "$LOG_DIR/preview-${safe_branch}.log"
}

preview_dir_for() {
  local safe_branch="$1"
  echo "$WORKTREE_ROOT/$safe_branch"
}

stop_preview() {
  local branch="${1:-${FORYOU_PREVIEW_BRANCH:-$(default_branch)}}"
  local safe_branch="$(safe_name "$branch")"
  local pid_file="$(pid_file_for "$safe_branch")"
  local pid=""

  if [[ -f "$pid_file" ]]; then
    pid="$(cat "$pid_file" 2>/dev/null || true)"
  fi

  if [[ -n "$pid" ]] && kill -0 "$pid" >/dev/null 2>&1; then
    info "Preview stoppen: branch=$branch pid=$pid"
    kill "$pid" >/dev/null 2>&1 || true
    sleep 1
    if kill -0 "$pid" >/dev/null 2>&1; then
      kill -9 "$pid" >/dev/null 2>&1 || true
    fi
  else
    info "Geen draaiende preview gevonden voor branch=$branch."
  fi

  rm -f "$pid_file"
}

status_preview() {
  local branch="${1:-${FORYOU_PREVIEW_BRANCH:-$(default_branch)}}"
  local safe_branch="$(safe_name "$branch")"
  local preview_dir="$(preview_dir_for "$safe_branch")"
  local pid_file="$(pid_file_for "$safe_branch")"
  local log_file="$(log_file_for "$safe_branch")"
  local pid=""

  [[ -f "$pid_file" ]] && pid="$(cat "$pid_file" 2>/dev/null || true)"
  echo "For You branch preview"
  echo "======================"
  echo "Branch:   $branch"
  echo "Worktree: $preview_dir"
  echo "Poort:    $PREVIEW_PORT"
  echo "Log:      $log_file"
  if [[ -n "$pid" ]] && kill -0 "$pid" >/dev/null 2>&1; then
    echo "Proces:   actief ($pid)"
  else
    echo "Proces:   niet actief"
  fi
  curl -fsS --max-time 1 "http://${PREVIEW_HOST}:${PREVIEW_PORT}/health" 2>/dev/null || true
  echo ""
}

ensure_preview_port_is_safe() {
  if [[ "$PREVIEW_PORT" == "3310" && "${FORYOU_ALLOW_LIVE_PREVIEW:-0}" != "1" ]]; then
    fail "Poort 3310 is de live showserver. Gebruik 3311/3312 voor previews, of zet bewust FORYOU_ALLOW_LIVE_PREVIEW=1."
  fi
}

ensure_worktree() {
  local branch="$1"
  local safe_branch="$2"
  local preview_dir="$(preview_dir_for "$safe_branch")"

  mkdir -p "$WORKTREE_ROOT"
  [[ -d "$APP_DIR/.git" ]] || fail "Geen git clone gevonden in $APP_DIR."

  info "Git refs verversen waar mogelijk."
  git -C "$APP_DIR" fetch origin "$branch" >/dev/null 2>&1 || git -C "$APP_DIR" fetch origin >/dev/null 2>&1 || true

  if [[ -d "$preview_dir/.git" || -f "$preview_dir/.git" ]]; then
    info "Bestaande preview-worktree gebruiken: $preview_dir"
    echo "$preview_dir"
    return 0
  fi

  if git -C "$APP_DIR" show-ref --verify --quiet "refs/heads/$branch"; then
    info "Preview-worktree maken vanaf lokale branch $branch."
    git -C "$APP_DIR" worktree add "$preview_dir" "$branch"
  elif git -C "$APP_DIR" show-ref --verify --quiet "refs/remotes/origin/$branch"; then
    info "Preview-worktree maken vanaf origin/$branch."
    git -C "$APP_DIR" worktree add -b "$branch" "$preview_dir" "origin/$branch"
  elif git -C "$APP_DIR" rev-parse --verify "$branch^{commit}" >/dev/null 2>&1; then
    info "Preview-worktree maken vanaf commit/ref $branch."
    git -C "$APP_DIR" worktree add "$preview_dir" "$branch"
  else
    fail "Branch/ref '$branch' niet gevonden. Maak of fetch de branch eerst."
  fi

  echo "$preview_dir"
}

update_worktree_if_clean() {
  local preview_dir="$1"
  cd "$preview_dir"
  if [[ -n "$(git status --porcelain)" ]]; then
    info "Preview-worktree heeft lokale wijzigingen; pull wordt overgeslagen."
    return 0
  fi

  local upstream=""
  upstream="$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || true)"
  if [[ -n "$upstream" ]]; then
    info "Preview-worktree bijwerken vanaf $upstream."
    git pull --ff-only
  else
    info "Geen upstream voor deze branch; pull wordt overgeslagen."
  fi
}

wait_for_health() {
  local url="http://${PREVIEW_HOST}:${PREVIEW_PORT}/health"
  local body=""
  info "Wachten op preview health-check: $url"
  for _ in {1..40}; do
    body="$(curl -fsS --max-time 1 "$url" 2>/dev/null || true)"
    if [[ "$body" == *'"ok":true'* ]]; then
      echo "$body"
      return 0
    fi
    sleep 0.5
  done
  return 1
}

start_preview() {
  local branch="${1:-${FORYOU_PREVIEW_BRANCH:-$(default_branch)}}"
  local safe_branch="$(safe_name "$branch")"
  local preview_dir=""
  local pid_file="$(pid_file_for "$safe_branch")"
  local log_file="$(log_file_for "$safe_branch")"

  ensure_preview_port_is_safe
  mkdir -p "$LOG_DIR"
  preview_dir="$(ensure_worktree "$branch" "$safe_branch")"

  update_worktree_if_clean "$preview_dir"

  cd "$preview_dir"
  info "Dependencies controleren/installeren."
  npm install

  stop_preview "$branch"

  if lsof -nP -iTCP:"$PREVIEW_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    fail "Poort $PREVIEW_PORT is al bezet. Kies FORYOU_PREVIEW_PORT=3312 of stop het andere proces."
  fi

  info "Preview starten: branch=$branch poort=$PREVIEW_PORT"
  PORT="$PREVIEW_PORT" ADMIN_AUTH_DISABLED="$ADMIN_AUTH_DISABLED" ADMIN_PASSWORD="$ADMIN_BOOTSTRAP_PASSWORD" npm start > "$log_file" 2>&1 &
  echo "$!" > "$pid_file"

  if ! wait_for_health; then
    echo "Laatste previewlog:"
    tail -n 80 "$log_file" 2>/dev/null || true
    fail "Preview werd niet gezond op poort $PREVIEW_PORT."
  fi

  if [[ "${FORYOU_PREVIEW_SMOKE:-0}" == "1" ]]; then
    npm run smoke -- --url "http://${PREVIEW_HOST}:${PREVIEW_PORT}"
  fi

  echo ""
  echo "Preview klaar:"
  echo "  Branch:   $branch"
  echo "  Worktree: $preview_dir"
  echo "  Admin:    http://${PREVIEW_HOST}:${PREVIEW_PORT}/admin"
  echo "  App:      http://${PREVIEW_HOST}:${PREVIEW_PORT}/"
  echo "  Stop:     scripts/mac-studio-preview.command stop $branch"
}

ACTION="${1:-start}"
case "$ACTION" in
  -h|--help|help)
    usage
    ;;
  stop)
    stop_preview "${2:-${FORYOU_PREVIEW_BRANCH:-$(default_branch)}}"
    ;;
  status)
    status_preview "${2:-${FORYOU_PREVIEW_BRANCH:-$(default_branch)}}"
    ;;
  start)
    start_preview "${2:-${FORYOU_PREVIEW_BRANCH:-$(default_branch)}}"
    ;;
  *)
    start_preview "$ACTION"
    ;;
esac
