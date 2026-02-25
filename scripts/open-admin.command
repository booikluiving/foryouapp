#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
APP_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
PORT="${PORT:-3000}"
AUTO_CLOSE_TERMINAL="${AUTO_CLOSE_TERMINAL:-1}"
HEALTH_TIMEOUT_SEC="${HEALTH_TIMEOUT_SEC:-20}"
LOG_FILE="${TMPDIR:-/tmp}/foryou-server.log"
LOCAL_ADMIN_URL="http://127.0.0.1:${PORT}/admin"
LOCAL_HEALTH_URL="http://127.0.0.1:${PORT}/health"

detect_lan_ip() {
  local ip=""
  ip="$(ipconfig getifaddr en0 2>/dev/null || true)"
  if [[ -z "$ip" ]]; then
    ip="$(ipconfig getifaddr en1 2>/dev/null || true)"
  fi
  if [[ -z "$ip" ]]; then
    ip="$(
      ifconfig | awk '
        $1 == "inet" {
          ip = $2;
          if (ip ~ /^192\.168\./ || ip ~ /^10\./) {
            print ip;
            exit;
          }
          if (ip ~ /^172\./) {
            split(ip, parts, ".");
            second = parts[2] + 0;
            if (second >= 16 && second <= 31) {
              print ip;
              exit;
            }
          }
        }
      '
    )"
  fi
  echo "$ip"
}

cd "$APP_DIR"

if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Server draait al op poort $PORT."
else
  echo "Server starten op poort $PORT..."
  nohup env \
    PORT="$PORT" \
    npm start >"$LOG_FILE" 2>&1 &
fi

health_ready=0
attempts=$((HEALTH_TIMEOUT_SEC * 2))
for ((i=1; i<=attempts; i++)); do
  if curl -fsS --max-time 1 "$LOCAL_HEALTH_URL" >/dev/null 2>&1; then
    health_ready=1
    break
  fi
  sleep 0.5
done

if [[ "$health_ready" != "1" ]]; then
  echo "Server startte niet binnen ${HEALTH_TIMEOUT_SEC}s."
  echo "Laatste regels uit log: $LOG_FILE"
  tail -n 40 "$LOG_FILE" || true
  exit 1
fi

LAN_IP="$(detect_lan_ip)"
OPEN_URL="$LOCAL_ADMIN_URL"
if [[ -n "$LAN_IP" ]]; then
  OPEN_URL="http://${LAN_IP}:${PORT}/admin"
else
  echo "Geen LAN-IP gevonden, open lokaal: ${LOCAL_ADMIN_URL}"
fi

if ! curl -fsS --max-time 2 "$LOCAL_HEALTH_URL" >/dev/null 2>&1; then
  echo "Waarschuwing: health-check faalt net voor open, fallback naar lokaal."
  OPEN_URL="$LOCAL_ADMIN_URL"
fi

open "$OPEN_URL"

if [[ "$AUTO_CLOSE_TERMINAL" == "1" && "${TERM_PROGRAM:-}" == "Apple_Terminal" ]]; then
  osascript >/dev/null 2>&1 <<'APPLESCRIPT' || true
tell application "Terminal"
  delay 0.25
  if (count of windows) > 0 then
    close front window
  end if
end tell
APPLESCRIPT
fi
