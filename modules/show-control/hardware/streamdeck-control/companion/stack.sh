#!/bin/zsh
set -euo pipefail

ROOT_DIR="${FY_DECK_ROOT_DIR:-$HOME/ForYou}"
START_SCRIPT="$ROOT_DIR/main/scripts/v2-mac-studio-setup.command"
STOP_SCRIPT="$ROOT_DIR/main/scripts/v2-mac-studio-stop.command"
STATUS_SCRIPT="$ROOT_DIR/main/scripts/v2-mac-studio-status.command"
LOG_DIR="$HOME/Library/Logs/ForYouV2"
ACTION="${1:-toggle}"

mkdir -p "$LOG_DIR"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

health_urls=(
  "http://127.0.0.1:3020/health"
  "http://127.0.0.1:3021/health"
  "http://127.0.0.1:3022/health"
  "http://127.0.0.1:3023/health"
  "http://127.0.0.1:3024/health"
  "http://127.0.0.1:3025/health"
  "http://127.0.0.1:3026/health"
  "http://127.0.0.1:3027/health"
)

stack_status() {
  local ok_count=0
  local url=""
  for url in "${health_urls[@]}"; do
    if curl -fsS --max-time 1 "$url" >/dev/null 2>&1; then
      ok_count=$((ok_count + 1))
    fi
  done

  if (( ok_count == ${#health_urls[@]} )); then
    printf 'aan\n'
  elif (( ok_count == 0 )); then
    printf 'uit\n'
  else
    printf 'partial\n'
  fi
}

run_status_script() {
  if [[ -x "$STATUS_SCRIPT" ]]; then
    "$STATUS_SCRIPT" || true
  fi
}

case "$ACTION" in
  status)
    stack_status
    ;;
  on|start)
    "$START_SCRIPT" >"$LOG_DIR/streamdeck-v2-start.log" 2>&1
    stack_status
    ;;
  off|stop)
    "$STOP_SCRIPT" >"$LOG_DIR/streamdeck-v2-stop.log" 2>&1
    stack_status
    ;;
  restart)
    {
      "$STOP_SCRIPT" || true
      sleep 1
      "$START_SCRIPT"
    } >"$LOG_DIR/streamdeck-v2-restart.log" 2>&1
    stack_status
    ;;
  toggle)
    current="$(stack_status)"
    if [[ "$current" == "aan" || "$current" == "partial" ]]; then
      "$STOP_SCRIPT" >"$LOG_DIR/streamdeck-v2-toggle.log" 2>&1
    else
      "$START_SCRIPT" >"$LOG_DIR/streamdeck-v2-toggle.log" 2>&1
    fi
    stack_status
    ;;
  print)
    run_status_script
    ;;
  *)
    echo "Gebruik: $0 [status|on|off|restart|toggle|print]" >&2
    exit 64
    ;;
esac
