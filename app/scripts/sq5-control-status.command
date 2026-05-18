#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
APP_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
SQ5_LABEL="${SQ5_LAUNCHD_LABEL:-nl.foryou.sq5-control}"
SQ5_HOST="${SQ5_HOST:-192.168.1.129}"
SQ5_MIXER_PORT="${SQ5_MIXER_PORT:-51325}"
SQ5_TOOL_PORT="${SQ5_TOOL_PORT:-3105}"
SQ5_OSC_PORT="${SQ5_OSC_PORT:-53000}"
PLIST_PATH="$HOME/Library/LaunchAgents/${SQ5_LABEL}.plist"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

json_probe_payload() {
  printf '{"host":"%s","port":%s}' "$SQ5_HOST" "$SQ5_MIXER_PORT"
}

http_status() {
  curl -fsS --max-time 2 "http://127.0.0.1:${SQ5_TOOL_PORT}/api/status" 2>/dev/null || true
}

probe_mixer() {
  curl -fsS --max-time 3 \
    -X POST \
    -H "content-type: application/json" \
    -d "$(json_probe_payload)" \
    "http://127.0.0.1:${SQ5_TOOL_PORT}/api/probe" 2>/dev/null || true
}

echo "SQ5 Control status"
echo "=================="
echo "Map:    $APP_DIR"
echo "Label:  $SQ5_LABEL"
echo "Poort:  $SQ5_TOOL_PORT"
echo "Mixer:  ${SQ5_HOST}:${SQ5_MIXER_PORT}"
echo ""

ok=1

echo "launchd:"
if [[ -f "$PLIST_PATH" ]] && launchctl print "gui/$(id -u)/$SQ5_LABEL" >/dev/null 2>&1; then
  echo "  actief"
else
  echo "  niet actief"
  ok=0
fi
echo ""

echo "http:"
status_body="$(http_status)"
if [[ "$status_body" == *'"mixerHost"'* ]]; then
  echo "  OK http://127.0.0.1:${SQ5_TOOL_PORT}/api/status"
else
  echo "  geen gezonde response op http://127.0.0.1:${SQ5_TOOL_PORT}/api/status"
  ok=0
fi
echo ""

echo "mixer:"
probe_body="$(probe_mixer)"
if [[ "$probe_body" == *'"ok": true'* || "$probe_body" == *'"ok":true'* ]]; then
  echo "  OK ${SQ5_HOST}:${SQ5_MIXER_PORT}"
else
  echo "  probe faalt naar ${SQ5_HOST}:${SQ5_MIXER_PORT}"
  [[ -n "$probe_body" ]] && echo "$probe_body" | sed 's/^/  /'
  ok=0
fi
echo ""

echo "listeners:"
tcp_listen="$(lsof -nP -iTCP:"${SQ5_TOOL_PORT}" -sTCP:LISTEN 2>/dev/null || true)"
udp_listen="$(lsof -nP -iUDP:"${SQ5_OSC_PORT}" 2>/dev/null || true)"
if [[ "$tcp_listen" == *"127.0.0.1:${SQ5_TOOL_PORT}"* ]]; then
  echo "  HTTP lokaal: 127.0.0.1:${SQ5_TOOL_PORT}"
else
  echo "  HTTP niet lokaal of niet gevonden"
  ok=0
fi
if [[ "$tcp_listen" == *"*:${SQ5_TOOL_PORT}"* || "$tcp_listen" == *"0.0.0.0:${SQ5_TOOL_PORT}"* ]]; then
  echo "  LET OP: HTTP luistert breed"
  ok=0
fi
if [[ "$udp_listen" == *"127.0.0.1:${SQ5_OSC_PORT}"* ]]; then
  echo "  OSC lokaal: 127.0.0.1:${SQ5_OSC_PORT}"
else
  echo "  OSC niet lokaal of niet gevonden"
  ok=0
fi
echo ""

if (( ok )); then
  echo "SQ5 Control OK"
else
  echo "SQ5 Control niet gezond"
  exit 1
fi
