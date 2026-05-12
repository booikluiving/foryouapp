#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
APP_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
APP_LABEL="${FORYOU_LAUNCHD_LABEL:-nl.foryou.app}"
APP_PORT="${FORYOU_PORT:-3310}"
LOG_DIR="$HOME/Library/Logs/ForYouApp"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

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

echo "For You App status"
echo "=================="
echo "Map:    $APP_DIR"
echo "Label:  $APP_LABEL"
echo "Poort:  $APP_PORT"
echo ""

echo "launchd:"
if launchctl print "gui/$(id -u)/$APP_LABEL" >/dev/null 2>&1; then
  echo "  actief"
else
  echo "  niet actief"
fi
echo ""

echo "health:"
body="$(curl -fsS --max-time 2 "http://127.0.0.1:${APP_PORT}/health" 2>/dev/null || true)"
if [[ "$body" == *'"ok":true'* ]]; then
  echo "  OK $body"
else
  echo "  geen gezonde response op http://127.0.0.1:${APP_PORT}/health"
fi
echo ""

lan_ip="$(detect_lan_ip)"
echo "URLs:"
echo "  admin lokaal:  http://127.0.0.1:${APP_PORT}/admin"
echo "  stage lokaal:  http://127.0.0.1:${APP_PORT}/stage"
if [[ -n "$lan_ip" ]]; then
  echo "  admin netwerk: http://${lan_ip}:${APP_PORT}/admin"
  echo "  publiek:       http://${lan_ip}:${APP_PORT}/"
fi
echo ""

echo "git:"
cd "$APP_DIR"
git status --short --branch || true
echo ""

echo "branch previews:"
preview_found=0
for pid_file in "$LOG_DIR"/preview-*.pid(N); do
  [[ -e "$pid_file" ]] || continue
  preview_found=1
  name="$(basename "$pid_file" .pid)"
  pid="$(cat "$pid_file" 2>/dev/null || true)"
  if [[ -n "$pid" ]] && kill -0 "$pid" >/dev/null 2>&1; then
    echo "  ${name#preview-}: actief (pid $pid)"
  else
    echo "  ${name#preview-}: pidfile aanwezig, proces niet actief"
  fi
done
if [[ "$preview_found" == "0" ]]; then
  echo "  geen actieve preview-pidfiles"
fi
echo ""

echo "laatste logs:"
tail -n 30 "$LOG_DIR/server.err.log" 2>/dev/null || echo "  nog geen error log"
