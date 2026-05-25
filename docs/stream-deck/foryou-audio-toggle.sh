#!/bin/zsh
set -euo pipefail

SQ5_LABEL="${SQ5_LAUNCHD_LABEL:-nl.foryou.sq5-control}"
SQ5_HOST="${SQ5_HOST:-192.168.1.129}"
SQ5_MIXER_PORT="${SQ5_MIXER_PORT:-51325}"
SQ5_TOOL_PORT="${SQ5_TOOL_PORT:-3105}"
SQ5_OSC_PORT="${SQ5_OSC_PORT:-53000}"
PLIST_PATH="$HOME/Library/LaunchAgents/${SQ5_LABEL}.plist"
GUI_TARGET="gui/$(id -u)"
SERVICE_TARGET="${GUI_TARGET}/${SQ5_LABEL}"
STATUS_URL="http://127.0.0.1:${SQ5_TOOL_PORT}/api/status"
PROBE_URL="http://127.0.0.1:${SQ5_TOOL_PORT}/api/probe"
ACTION="${1:-toggle}"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

json_probe_payload() {
  printf '{"host":"%s","port":%s}' "$SQ5_HOST" "$SQ5_MIXER_PORT"
}

service_loaded() {
  launchctl print "$SERVICE_TARGET" >/dev/null 2>&1
}

bridge_http_ok() {
  local body=""
  body="$(curl -fsS --max-time 1 "$STATUS_URL" 2>/dev/null || true)"
  [[ "$body" == *'"mixerHost"'* ]]
}

mixer_probe_ok() {
  local body=""
  body="$(
    curl -fsS --max-time 2 \
      -X POST \
      -H "content-type: application/json" \
      -d "$(json_probe_payload)" \
      "$PROBE_URL" 2>/dev/null || true
  )"
  [[ "$body" == *'"ok": true'* || "$body" == *'"ok":true'* ]]
}

port_pids() {
  {
    lsof -tiTCP:"${SQ5_TOOL_PORT}" -sTCP:LISTEN 2>/dev/null || true
    lsof -tiUDP:"${SQ5_OSC_PORT}" 2>/dev/null || true
  } | sort -u
}

bridge_present() {
  service_loaded || bridge_http_ok || [[ -n "$(port_pids)" ]]
}

audio_status() {
  if bridge_http_ok; then
    if mixer_probe_ok; then
      printf 'aan\n'
    else
      printf 'error\n'
    fi
    return 0
  fi

  if service_loaded || [[ -n "$(port_pids)" ]]; then
    printf 'error\n'
  else
    printf 'uit\n'
  fi
}

kill_lingering_audio_processes() {
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
    if ! bridge_http_ok && [[ -z "$(port_pids)" ]]; then
      return 0
    fi
    sleep 0.5
  done
  return 1
}

start_audio() {
  if [[ ! -f "$PLIST_PATH" ]]; then
    printf 'error\n'
    echo "LaunchAgent ontbreekt: $PLIST_PATH" >&2
    return 1
  fi

  if ! service_loaded; then
    launchctl bootstrap "$GUI_TARGET" "$PLIST_PATH" >/dev/null 2>&1 || true
  fi
  launchctl kickstart -k "$SERVICE_TARGET" >/dev/null 2>&1 || true

  for _ in {1..30}; do
    local status_now=""
    status_now="$(audio_status)"
    if [[ "$status_now" == "aan" ]]; then
      printf 'aan\n'
      return 0
    fi
    sleep 0.5
  done

  audio_status
  return 1
}

stop_audio() {
  launchctl bootout "$GUI_TARGET" "$PLIST_PATH" >/dev/null 2>&1 || \
    launchctl bootout "$SERVICE_TARGET" >/dev/null 2>&1 || true

  wait_until_down || kill_lingering_audio_processes

  if ! bridge_http_ok && [[ -z "$(port_pids)" ]]; then
    printf 'uit\n'
    return 0
  fi

  audio_status
  return 1
}

case "$ACTION" in
  status)
    audio_status
    ;;
  on|start)
    start_audio
    ;;
  off|stop)
    stop_audio
    ;;
  restart)
    stop_audio >/dev/null || true
    sleep 1
    start_audio
    ;;
  toggle)
    if bridge_present; then
      stop_audio
    else
      start_audio
    fi
    ;;
  *)
    echo "Gebruik: $0 [status|on|off|restart|toggle]" >&2
    exit 64
    ;;
esac
