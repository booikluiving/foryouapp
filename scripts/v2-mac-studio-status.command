#!/bin/zsh
set -u

PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export PATH

DOMAIN="gui/$(id -u)"
SERVICES=(
  "nl.foryou.v2.gateway|3020|http://127.0.0.1:3020/health"
  "nl.foryou.v2.catalog|3021|http://127.0.0.1:3021/health"
  "nl.foryou.v2.paths|3022|http://127.0.0.1:3022/health"
  "nl.foryou.v2.algorithm|3023|http://127.0.0.1:3023/health"
  "nl.foryou.v2.runtime|3024|http://127.0.0.1:3024/health"
  "nl.foryou.v2.show-control|3025|http://127.0.0.1:3025/health"
  "nl.foryou.v2.audience|3026|http://127.0.0.1:3026/health"
  "nl.foryou.v2.script-agent|3027|http://127.0.0.1:3027/health"
  "nl.foryou.v2.sq5-control|3225|http://127.0.0.1:3225/api/status"
  "nl.foryou.v2.camera-control|3226|http://127.0.0.1:3226/api/state"
  "nl.foryou.v2.streamdeck-control|3227|http://127.0.0.1:3227/api/state"
  "nl.foryou.v2.perfect-cue-control|3228|http://127.0.0.1:3228/api/state"
  "nl.foryou.v2.dmx-control|3229|http://127.0.0.1:3229/api/state"
)
OLD_TCP=(3010 3105 3110 3310)
OLD_UDP=(1234 53000 53100)

printf 'For You V2 Mac Studio status\n'
printf '============================\n'

for row in "${SERVICES[@]}"; do
  IFS='|' read -r label port url <<< "$row"
  state="$(launchctl print "$DOMAIN/$label" 2>/dev/null | awk -F'= ' '/state =/ { print $2; exit }')"
  [[ -n "$state" ]] || state="niet geladen"
  listener="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | awk 'NR==2 { print $1 " pid=" $2; exit }')"
  [[ -n "$listener" ]] || listener="geen listener"
  health="$(curl -fsS --max-time 1 "$url" 2>/dev/null | python3 -c 'import json,sys; data=sys.stdin.read(); print("ok" if data and json.loads(data).get("ok", True) is not False else "not ok")' 2>/dev/null || true)"
  [[ -n "$health" ]] || health="geen health"
  printf '%-32s %-16s %-18s %s\n' "$label" "$state" "$listener" "$health"
done

printf '\nOude V1 TCP-poorten:\n'
for port in "${OLD_TCP[@]}"; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    printf '  %s open\n' "$port"
  else
    printf '  %s dicht\n' "$port"
  fi
done

printf '\nOude V1 UDP-poorten:\n'
for port in "${OLD_UDP[@]}"; do
  if lsof -nP -iUDP:"$port" >/dev/null 2>&1; then
    printf '  %s open\n' "$port"
  else
    printf '  %s dicht\n' "$port"
  fi
done
