#!/bin/zsh
set -euo pipefail

APP_LABEL="${FORYOU_LAUNCHD_LABEL:-nl.foryou.app}"
APP_PORT="${FORYOU_PORT:-3310}"
PLIST_PATH="$HOME/Library/LaunchAgents/${APP_LABEL}.plist"
GUI_TARGET="gui/$(id -u)"
SERVICE_TARGET="${GUI_TARGET}/${APP_LABEL}"
HEALTH_URL="http://127.0.0.1:${APP_PORT}/health"
RESTART_WAIT_SECONDS="${FORYOU_RESTART_WAIT_SECONDS:-2}"

health_ok() {
  curl -fsS --max-time 1 "$HEALTH_URL" >/dev/null 2>&1
}

port_pids() {
  lsof -tiTCP:"${APP_PORT}" -sTCP:LISTEN 2>/dev/null | sort -u || true
}

kill_lingering_server_processes() {
  local pids=("${(@f)$(port_pids)}")
  if (( ${#pids[@]} == 0 )); then
    return 0
  fi

  kill "${pids[@]}" >/dev/null 2>&1 || true
  sleep 1

  pids=("${(@f)$(port_pids)}")
  if (( ${#pids[@]} > 0 )); then
    kill -9 "${pids[@]}" >/dev/null 2>&1 || true
  fi
}

wait_until_down() {
  for _ in {1..12}; do
    if ! health_ok && [[ -z "$(port_pids)" ]]; then
      return 0
    fi
    sleep 0.5
  done
  return 1
}

print_status() {
  if health_ok; then
    printf 'aan\n'
  else
    printf 'uit\n'
  fi
}

start_server() {
  if [[ ! -f "$PLIST_PATH" ]]; then
    printf 'uit\n'
    echo "LaunchAgent ontbreekt: $PLIST_PATH" >&2
    return 1
  fi

  if ! launchctl print "$SERVICE_TARGET" >/dev/null 2>&1; then
    launchctl bootstrap "$GUI_TARGET" "$PLIST_PATH" >/dev/null 2>&1 || true
  fi

  launchctl kickstart -k "$SERVICE_TARGET" >/dev/null 2>&1 || true

  for _ in {1..24}; do
    if health_ok; then
      printf 'aan\n'
      return 0
    fi
    sleep 0.5
  done

  printf 'uit\n'
  return 1
}

stop_server() {
  launchctl bootout "$GUI_TARGET" "$PLIST_PATH" >/dev/null 2>&1 || \
    launchctl bootout "$SERVICE_TARGET" >/dev/null 2>&1 || true

  wait_until_down && {
    printf 'uit\n'
    return 0
  }

  kill_lingering_server_processes

  if ! health_ok && [[ -z "$(port_pids)" ]]; then
    printf 'uit\n'
    return 0
  fi

  print_status
  return 1
}

restart_server() {
  stop_server >/dev/null || true
  sleep "$RESTART_WAIT_SECONDS"
  start_server
}

case "${1:-toggle}" in
  status)
    print_status
    ;;
  on|start)
    start_server
    ;;
  off|stop)
    stop_server
    ;;
  restart)
    restart_server
    ;;
  toggle)
    if health_ok; then
      stop_server
    else
      start_server
    fi
    ;;
  *)
    echo "Gebruik: $0 [status|on|off|restart|toggle]" >&2
    exit 64
    ;;
esac
