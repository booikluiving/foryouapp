#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
APP_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
REPO_DIR="$(cd -- "$APP_DIR" && git rev-parse --show-toplevel 2>/dev/null || true)"
SQ5_LABEL="${SQ5_LAUNCHD_LABEL:-nl.foryou.sq5-control}"
SQ5_HOST="${SQ5_HOST:-192.168.1.129}"
SQ5_MIXER_PORT="${SQ5_MIXER_PORT:-51325}"
SQ5_TOOL_HOST="${SQ5_TOOL_HOST:-127.0.0.1}"
SQ5_TOOL_PORT="${SQ5_TOOL_PORT:-3105}"
SQ5_OSC_LISTEN_ADDRESS="${SQ5_OSC_LISTEN_ADDRESS:-127.0.0.1}"
SQ5_OSC_PORT="${SQ5_OSC_PORT:-53000}"
SQ5_STATUS_POLL_MS="${SQ5_STATUS_POLL_MS:-1500}"
SQ5_STREAMDECK_POLL_MS="${SQ5_STREAMDECK_POLL_MS:-500}"
SQ5_MIDI_CHANNEL="${SQ5_MIDI_CHANNEL:-1}"
SQ5_FADER_LAW="${SQ5_FADER_LAW:-linear}"
PLIST_PATH="$HOME/Library/LaunchAgents/${SQ5_LABEL}.plist"
LOG_DIR="$HOME/Library/Logs/ForYouApp"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

fail() {
  echo "FOUT: $*" >&2
  exit 1
}

info() {
  echo "==> $*"
}

xml_escape() {
  printf '%s' "$1" \
    | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'
}

resolve_node() {
  if [[ -n "${SQ5_NODE_BIN:-}" && -x "${SQ5_NODE_BIN:-}" ]]; then
    printf '%s\n' "$SQ5_NODE_BIN"
    return 0
  fi
  if [[ -x /opt/homebrew/bin/node ]]; then
    printf '%s\n' /opt/homebrew/bin/node
    return 0
  fi
  command -v node 2>/dev/null || return 1
}

json_probe_payload() {
  printf '{"host":"%s","port":%s}' "$SQ5_HOST" "$SQ5_MIXER_PORT"
}

port_pids() {
  {
    lsof -tiTCP:"${SQ5_TOOL_PORT}" -sTCP:LISTEN 2>/dev/null || true
    lsof -tiUDP:"${SQ5_OSC_PORT}" 2>/dev/null || true
  } | sort -u
}

kill_lingering_sq5_processes() {
  local pids=("${(@f)$(port_pids)}")
  if (( ${#pids[@]} == 0 )); then
    return 0
  fi

  info "Oude SQ5 listeners stoppen: ${pids[*]}"
  kill "${pids[@]}" >/dev/null 2>&1 || true
  sleep 1

  pids=("${(@f)$(port_pids)}")
  if (( ${#pids[@]} > 0 )); then
    kill -9 "${pids[@]}" >/dev/null 2>&1 || true
  fi
}

stop_existing_service() {
  launchctl bootout "gui/$(id -u)" "$PLIST_PATH" >/dev/null 2>&1 || \
    launchctl bootout "gui/$(id -u)/$SQ5_LABEL" >/dev/null 2>&1 || true
}

write_launch_agent() {
  local node_bin="$1"
  mkdir -p "$(dirname "$PLIST_PATH")" "$LOG_DIR"

  local escaped_label escaped_repo_dir escaped_node escaped_stdout escaped_stderr
  escaped_label="$(xml_escape "$SQ5_LABEL")"
  escaped_repo_dir="$(xml_escape "$REPO_DIR")"
  escaped_node="$(xml_escape "$node_bin")"
  escaped_stdout="$(xml_escape "$LOG_DIR/sq5-control.out.log")"
  escaped_stderr="$(xml_escape "$LOG_DIR/sq5-control.err.log")"

  info "SQ5 LaunchAgent schrijven: $PLIST_PATH"
  cat > "$PLIST_PATH" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escaped_label}</string>
  <key>WorkingDirectory</key>
  <string>${escaped_repo_dir}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escaped_node}</string>
    <string>app/sq5-control/server.js</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>SQ5_HOST</key>
    <string>$(xml_escape "$SQ5_HOST")</string>
    <key>SQ5_MIXER_PORT</key>
    <string>$(xml_escape "$SQ5_MIXER_PORT")</string>
    <key>SQ5_TOOL_HOST</key>
    <string>$(xml_escape "$SQ5_TOOL_HOST")</string>
    <key>SQ5_TOOL_PORT</key>
    <string>$(xml_escape "$SQ5_TOOL_PORT")</string>
    <key>SQ5_OSC_LISTEN_ADDRESS</key>
    <string>$(xml_escape "$SQ5_OSC_LISTEN_ADDRESS")</string>
    <key>SQ5_OSC_PORT</key>
    <string>$(xml_escape "$SQ5_OSC_PORT")</string>
    <key>SQ5_STATUS_POLL_MS</key>
    <string>$(xml_escape "$SQ5_STATUS_POLL_MS")</string>
    <key>SQ5_STREAMDECK_POLL_MS</key>
    <string>$(xml_escape "$SQ5_STREAMDECK_POLL_MS")</string>
    <key>SQ5_MIDI_CHANNEL</key>
    <string>$(xml_escape "$SQ5_MIDI_CHANNEL")</string>
    <key>SQ5_FADER_LAW</key>
    <string>$(xml_escape "$SQ5_FADER_LAW")</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${escaped_stdout}</string>
  <key>StandardErrorPath</key>
  <string>${escaped_stderr}</string>
</dict>
</plist>
PLIST
}

start_service() {
  info "SQ5 Control starten."
  launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH" >/dev/null 2>&1 || true
  launchctl kickstart -k "gui/$(id -u)/$SQ5_LABEL" >/dev/null 2>&1 || true
}

wait_for_bridge() {
  local url="http://127.0.0.1:${SQ5_TOOL_PORT}/api/status"
  local body=""
  info "Wachten op SQ5 bridge: $url"
  for _ in {1..30}; do
    body="$(curl -fsS --max-time 1 "$url" 2>/dev/null || true)"
    if [[ "$body" == *'"mixerHost"'* && "$body" == *"$SQ5_HOST"* ]]; then
      return 0
    fi
    sleep 0.5
  done
  echo "Laatste SQ5 error log:"
  tail -n 80 "$LOG_DIR/sq5-control.err.log" 2>/dev/null || true
  fail "SQ5 bridge werd niet gezond op poort $SQ5_TOOL_PORT."
}

probe_mixer() {
  local body=""
  body="$(
    curl -fsS --max-time 3 \
      -X POST \
      -H "content-type: application/json" \
      -d "$(json_probe_payload)" \
      "http://127.0.0.1:${SQ5_TOOL_PORT}/api/probe" 2>/dev/null || true
  )"
  if [[ "$body" == *'"ok": true'* || "$body" == *'"ok":true'* ]]; then
    return 0
  fi
  echo "$body"
  return 1
}

main() {
  [[ -n "$REPO_DIR" ]] || fail "Geen git clone gevonden rond $APP_DIR."
  [[ -f "$REPO_DIR/app/sq5-control/server.js" ]] || fail "SQ5 server ontbreekt in $REPO_DIR."

  local node_bin=""
  node_bin="$(resolve_node)" || fail "Node is niet gevonden. Verwacht /opt/homebrew/bin/node of node op PATH."

  stop_existing_service
  kill_lingering_sq5_processes
  write_launch_agent "$node_bin"
  start_service
  wait_for_bridge

  if probe_mixer; then
    echo "SQ5 Control draait: http://127.0.0.1:${SQ5_TOOL_PORT} -> ${SQ5_HOST}:${SQ5_MIXER_PORT}"
  else
    fail "SQ5 bridge draait, maar mixerprobe naar ${SQ5_HOST}:${SQ5_MIXER_PORT} faalt."
  fi
}

main "$@"
