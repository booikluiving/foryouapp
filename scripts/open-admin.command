#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
APP_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
REQUESTED_PORT="${PORT:-3000}"
PORT_WAS_EXPLICIT=0
if [[ -n "${PORT:-}" ]]; then
  PORT_WAS_EXPLICIT=1
fi
PORT="$REQUESTED_PORT"
AUTO_CLOSE_TERMINAL="${AUTO_CLOSE_TERMINAL:-1}"
HEALTH_TIMEOUT_SEC="${HEALTH_TIMEOUT_SEC:-20}"
LOG_FILE="${TMPDIR:-/tmp}/foryou-server.log"
LOCAL_ADMIN_URL=""

refresh_urls() {
  LOCAL_ADMIN_URL="http://127.0.0.1:${PORT}/admin"
}

is_foryou_healthy() {
  is_foryou_healthy_port "$PORT"
}

is_foryou_healthy_port() {
  local check_port="$1"
  local check_url="http://127.0.0.1:${check_port}/health"
  local body=""
  body="$(curl -fsS --max-time 1 "$check_url" 2>/dev/null || true)"
  [[ "$body" == *'"ok":true'* && "$body" == *'"buildLabel"'* ]]
}

is_port_listening() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

find_free_port() {
  local candidate=""
  for candidate in 3310 3311 3312 3313 3314 3315 3001 3002 3003 3004 3005 3006 3007 3008 3009 3010; do
    if ! is_port_listening "$candidate"; then
      echo "$candidate"
      return 0
    fi
  done
  return 1
}

find_existing_foryou_port() {
  local candidate=""
  for candidate in 3310 3311 3312 3313 3314 3315 3001 3002 3003 3004 3005 3006 3007 3008 3009 3010; do
    if is_foryou_healthy_port "$candidate"; then
      echo "$candidate"
      return 0
    fi
  done
  return 1
}

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
refresh_urls

if is_foryou_healthy; then
  echo "For You server draait al op poort $PORT."
elif is_port_listening "$PORT"; then
  if [[ "$PORT_WAS_EXPLICIT" == "1" ]]; then
    echo "Poort $PORT is bezet, maar daarop draait geen For You server."
    echo "Stop de andere app of start met een andere poort, bijvoorbeeld:"
    echo "  PORT=3310 $0"
    exit 1
  fi

  EXISTING_PORT="$(find_existing_foryou_port || true)"
  if [[ -n "$EXISTING_PORT" ]]; then
    echo "Poort $PORT is bezet door een andere app; bestaande For You server gevonden op poort $EXISTING_PORT."
    PORT="$EXISTING_PORT"
    refresh_urls
  else
    FALLBACK_PORT="$(find_free_port || true)"
    if [[ -z "$FALLBACK_PORT" ]]; then
      echo "Poort $PORT is bezet door een andere app en ik vond geen vrije fallbackpoort."
      exit 1
    fi

    echo "Poort $PORT is bezet door een andere app; For You start op poort $FALLBACK_PORT."
    PORT="$FALLBACK_PORT"
    refresh_urls
    echo "Server starten op poort $PORT..."
    nohup env \
      PORT="$PORT" \
      npm start >"$LOG_FILE" 2>&1 &
  fi
else
  if [[ "$PORT_WAS_EXPLICIT" != "1" ]]; then
    EXISTING_PORT="$(find_existing_foryou_port || true)"
  else
    EXISTING_PORT=""
  fi

  if [[ -n "$EXISTING_PORT" ]]; then
    echo "Bestaande For You server gevonden op poort $EXISTING_PORT."
    PORT="$EXISTING_PORT"
    refresh_urls
  else
    echo "Server starten op poort $PORT..."
    nohup env \
      PORT="$PORT" \
      npm start >"$LOG_FILE" 2>&1 &
  fi
fi

health_ready=0
attempts=$((HEALTH_TIMEOUT_SEC * 2))
for ((i=1; i<=attempts; i++)); do
  if is_foryou_healthy; then
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

if ! is_foryou_healthy; then
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
