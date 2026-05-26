#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
REPO_DIR="$(cd -- "$SCRIPT_DIR/.." && git rev-parse --show-toplevel)"
PLIST_DIR="$HOME/Library/LaunchAgents"
LOG_DIR="$HOME/Library/Logs/ForYouV2"
DOMAIN="gui/$(id -u)"
PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export PATH

info() {
  printf '==> %s\n' "$*"
}

fail() {
  printf 'FOUT: %s\n' "$*" >&2
  exit 1
}

xml_escape() {
  printf '%s' "$1" \
    | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'
}

resolve_node() {
  if [[ -n "${V2_NODE_BIN:-}" && -x "${V2_NODE_BIN:-}" ]]; then
    printf '%s\n' "$V2_NODE_BIN"
    return 0
  fi
  if [[ -x /opt/homebrew/bin/node ]]; then
    printf '%s\n' /opt/homebrew/bin/node
    return 0
  fi
  command -v node 2>/dev/null || return 1
}

write_launch_agent() {
  local label="$1"
  local script_path="$2"
  shift 2

  [[ -f "$REPO_DIR/$script_path" ]] || fail "Script ontbreekt: $script_path"

  local node_bin plist_path stdout_path stderr_path
  node_bin="$(resolve_node)" || fail "Node.js niet gevonden"
  plist_path="$PLIST_DIR/${label}.plist"
  stdout_path="$LOG_DIR/${label}.out.log"
  stderr_path="$LOG_DIR/${label}.err.log"

  mkdir -p "$PLIST_DIR" "$LOG_DIR"

  {
    printf '%s\n' '<?xml version="1.0" encoding="UTF-8"?>'
    printf '%s\n' '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"'
    printf '%s\n' '  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">'
    printf '%s\n' '<plist version="1.0">'
    printf '%s\n' '<dict>'
    printf '%s\n' '  <key>Label</key>'
    printf '  <string>%s</string>\n' "$(xml_escape "$label")"
    printf '%s\n' '  <key>WorkingDirectory</key>'
    printf '  <string>%s</string>\n' "$(xml_escape "$REPO_DIR")"
    printf '%s\n' '  <key>ProgramArguments</key>'
    printf '%s\n' '  <array>'
    printf '    <string>%s</string>\n' "$(xml_escape "$node_bin")"
    printf '    <string>%s</string>\n' "$(xml_escape "$script_path")"
    printf '%s\n' '  </array>'
    printf '%s\n' '  <key>EnvironmentVariables</key>'
    printf '%s\n' '  <dict>'
    printf '%s\n' '    <key>PATH</key>'
    printf '    <string>%s</string>\n' "$(xml_escape "$PATH")"
    for pair in "$@"; do
      local key="${pair%%=*}"
      local value="${pair#*=}"
      printf '    <key>%s</key>\n' "$(xml_escape "$key")"
      printf '    <string>%s</string>\n' "$(xml_escape "$value")"
    done
    printf '%s\n' '  </dict>'
    printf '%s\n' '  <key>RunAtLoad</key>'
    printf '%s\n' '  <true/>'
    printf '%s\n' '  <key>KeepAlive</key>'
    printf '%s\n' '  <true/>'
    printf '%s\n' '  <key>StandardOutPath</key>'
    printf '  <string>%s</string>\n' "$(xml_escape "$stdout_path")"
    printf '%s\n' '  <key>StandardErrorPath</key>'
    printf '  <string>%s</string>\n' "$(xml_escape "$stderr_path")"
    printf '%s\n' '</dict>'
    printf '%s\n' '</plist>'
  } > "$plist_path"

  plutil -lint "$plist_path" >/dev/null
  launchctl bootout "$DOMAIN/$label" >/dev/null 2>&1 || \
    launchctl bootout "$DOMAIN" "$plist_path" >/dev/null 2>&1 || true
  launchctl bootstrap "$DOMAIN" "$plist_path" >/dev/null 2>&1 || true
  launchctl kickstart -k "$DOMAIN/$label" >/dev/null 2>&1 || true
  info "Gestart: $label"
}

info "V2 LaunchAgents installeren vanuit $REPO_DIR"

write_launch_agent "nl.foryou.v2.catalog" "modules/catalog/server/server.js" \
  "CATALOG_PORT=3021"

write_launch_agent "nl.foryou.v2.paths" "modules/paths/server/server.js" \
  "PATHS_PORT=3022" \
  "V2_PATHS_CATALOG_URL=http://127.0.0.1:3021"

write_launch_agent "nl.foryou.v2.algorithm" "modules/algorithm/server/server.js" \
  "ALGORITHM_PORT=3023"

write_launch_agent "nl.foryou.v2.runtime" "modules/runtime/server/server.js" \
  "RUNTIME_PORT=3024" \
  "V2_RUNTIME_CATALOG_URL=http://127.0.0.1:3021" \
  "V2_RUNTIME_PATHS_URL=http://127.0.0.1:3022" \
  "V2_RUNTIME_ALGORITHM_URL=http://127.0.0.1:3023" \
  "V2_RUNTIME_AUDIENCE_URL=http://127.0.0.1:3026"

write_launch_agent "nl.foryou.v2.sq5-control" "modules/show-control/hardware/sq5-control/server.js" \
  "V2_SHOW_CONTROL_SQ5_HOST=127.0.0.1" \
  "V2_SHOW_CONTROL_SQ5_PORT=3225" \
  "V2_SHOW_CONTROL_SQ5_MIXER_HOST=192.168.1.129" \
  "V2_SHOW_CONTROL_SQ5_MIXER_PORT=51325" \
  "V2_SHOW_CONTROL_SQ5_MIDI_CHANNEL=1" \
  "V2_SHOW_CONTROL_SQ5_FADER_LAW=linear" \
  "V2_SHOW_CONTROL_SQ5_OSC_LISTEN_ADDRESS=127.0.0.1" \
  "V2_SHOW_CONTROL_SQ5_OSC_PORT=53250" \
  "V2_SHOW_CONTROL_SQ5_STATUS_POLL_MS=1500" \
  "V2_SHOW_CONTROL_SQ5_STREAMDECK_POLL_MS=500"

write_launch_agent "nl.foryou.v2.camera-control" "modules/show-control/hardware/camera-control/server.js" \
  "V2_SHOW_CONTROL_CAMERA_HOST=127.0.0.1" \
  "V2_SHOW_CONTROL_CAMERA_PORT=3226" \
  "V2_SHOW_CONTROL_CAMERA_OSC_LISTEN_ADDRESS=127.0.0.1" \
  "V2_SHOW_CONTROL_CAMERA_OSC_PORT=53260" \
  "V2_SHOW_CONTROL_CAMERA_CAM1_HOST=192.168.1.165" \
  "V2_SHOW_CONTROL_CAMERA_CAM2_HOST=192.168.1.166" \
  "V2_SHOW_CONTROL_CAMERA_CAM3_HOST=192.168.1.167"

write_launch_agent "nl.foryou.v2.streamdeck-control" "modules/show-control/hardware/streamdeck-control/server.js" \
  "V2_SHOW_CONTROL_STREAMDECK_HOST=127.0.0.1" \
  "V2_SHOW_CONTROL_STREAMDECK_PORT=3227" \
  "V2_SHOW_CONTROL_URL=http://127.0.0.1:3025"

write_launch_agent "nl.foryou.v2.perfect-cue-control" "modules/show-control/hardware/perfect-cue-control/server.js" \
  "V2_SHOW_CONTROL_PERFECT_CUE_HOST=127.0.0.1" \
  "V2_SHOW_CONTROL_PERFECT_CUE_PORT=3228" \
  "V2_SHOW_CONTROL_URL=http://127.0.0.1:3025"

write_launch_agent "nl.foryou.v2.dmx-control" "modules/show-control/hardware/dmx-control/server.js" \
  "V2_SHOW_CONTROL_DMX_HOST=127.0.0.1" \
  "V2_SHOW_CONTROL_DMX_PORT=3229" \
  "V2_SHOW_CONTROL_DMX_TARGET_IP=192.168.1.230" \
  "V2_SHOW_CONTROL_DMX_UNIVERSE=1" \
  "V2_SHOW_CONTROL_DMX_FRAME_RATE=35"

write_launch_agent "nl.foryou.v2.show-control" "modules/show-control/server/server.js" \
  "SHOW_CONTROL_PORT=3025" \
  "V2_SHOW_CONTROL_RUNTIME_URL=http://127.0.0.1:3024" \
  "V2_SHOW_CONTROL_SQ5_URL=http://127.0.0.1:3225" \
  "V2_SHOW_CONTROL_CAMERA_URL=http://127.0.0.1:3226" \
  "V2_SHOW_CONTROL_DMX_URL=http://127.0.0.1:3229" \
  "V2_SHOW_CONTROL_STREAMDECK_URL=http://127.0.0.1:3227" \
  "V2_SHOW_CONTROL_PERFECT_CUE_URL=http://127.0.0.1:3228" \
  "V2_SHOW_CONTROL_TD_OSC_HOST=127.0.0.1" \
  "V2_SHOW_CONTROL_TD_OSC_PORT=9100" \
  "V2_SHOW_CONTROL_TD_ACK_HOST=127.0.0.1" \
  "V2_SHOW_CONTROL_TD_ACK_PORT=9101"

write_launch_agent "nl.foryou.v2.audience" "modules/audience/server/server.js" \
  "AUDIENCE_PORT=3026" \
  "V2_AUDIENCE_RUNTIME_URL=http://127.0.0.1:3024" \
  "V2_AUDIENCE_ALGORITHM_URL=http://127.0.0.1:3023"

write_launch_agent "nl.foryou.v2.script-agent" "modules/script-agent/server/server.js" \
  "SCRIPT_AGENT_PORT=3027" \
  "V2_SCRIPT_AGENT_RUNTIME_URL=http://127.0.0.1:3024"

write_launch_agent "nl.foryou.v2.gateway" "gateway/server/server.js" \
  "GATEWAY_PORT=3020" \
  "V2_GATEWAY_CATALOG_URL=http://127.0.0.1:3021" \
  "V2_GATEWAY_PATHS_URL=http://127.0.0.1:3022" \
  "V2_GATEWAY_ALGORITHM_URL=http://127.0.0.1:3023" \
  "V2_GATEWAY_RUNTIME_URL=http://127.0.0.1:3024" \
  "V2_GATEWAY_SHOW_CONTROL_URL=http://127.0.0.1:3025" \
  "V2_GATEWAY_AUDIENCE_URL=http://127.0.0.1:3026" \
  "V2_GATEWAY_SCRIPT_AGENT_URL=http://127.0.0.1:3027"

"$SCRIPT_DIR/v2-mac-studio-status.command"
