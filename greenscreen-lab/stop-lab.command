#!/usr/bin/env bash
# Stopt alleen wat start-lab.command startte: de sidecar en de lab-TD (op pid, met controle).
set -uo pipefail
LAB="$(cd "$(dirname "$0")" && pwd -P)"
OUT="$LAB/out"

if [[ -f "$OUT/sidecar.pid" ]]; then
  pid="$(cat "$OUT/sidecar.pid")"
  if ps -p "$pid" -o command= | grep -q rvm_syphon.py; then kill "$pid" && echo "sidecar gestopt ($pid)"; fi
  rm -f "$OUT/sidecar.pid"
fi

if [[ -f "$OUT/td-lab.pid" ]]; then
  pid="$(cat "$OUT/td-lab.pid")"
  # alleen stoppen als dit proces echt het labbestand open heeft
  if lsof -p "$pid" 2>/dev/null | grep -q "greenscreen-lab"; then
    kill "$pid"
    for _ in 1 2 3 4 5 6; do kill -0 "$pid" 2>/dev/null || break; sleep 0.5; done
    # het labbestand wordt bij elke start opnieuw gebouwd: niets op te slaan, dus hard stoppen mag
    kill -0 "$pid" 2>/dev/null && kill -9 "$pid"
    echo "lab-TD gestopt ($pid)"
  else
    echo "pid $pid heeft greenscreen-lab niet open: niets gestopt" >&2
  fi
  rm -f "$OUT/td-lab.pid"
fi
