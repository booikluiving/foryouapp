#!/usr/bin/env bash
# Start het greenscreen-lab: de RVM-sidecar en een TWEEDE, losse TouchDesigner met greenscreen-lab.toe.
# Raakt het show-TD niet aan. Stoppen met stop-lab.command.
set -euo pipefail
LAB="$(cd "$(dirname "$0")" && pwd -P)"
OUT="$LAB/out"
mkdir -p "$OUT"
PY="$HOME/.venvs/greenscreen/bin/python"

# 1. sidecar (route 2)
if [[ -f "$OUT/sidecar.pid" ]] && kill -0 "$(cat "$OUT/sidecar.pid")" 2>/dev/null; then
  echo "sidecar draait al (pid $(cat "$OUT/sidecar.pid"))"
else
  nohup "$PY" -I "$LAB/sidecar/rvm_syphon.py" \
    --model "$LAB/models/rvm_1920x1080.mlpackage" --model "$LAB/models/rvm_1080x1920.mlpackage" \
    --stats "$OUT/sidecar_stats.json" --debug-dir "$OUT/sidecar" > "$OUT/sidecar.log" 2>&1 &
  echo $! > "$OUT/sidecar.pid"
  echo "sidecar gestart (pid $!)"
fi

# 2. tweede TouchDesigner met het labbestand
if [[ -f "$OUT/td-lab.pid" ]] && kill -0 "$(cat "$OUT/td-lab.pid")" 2>/dev/null; then
  echo "lab-TD draait al (pid $(cat "$OUT/td-lab.pid"))"
  exit 0
fi
# De TD-waakhond sluit elke andere TD dan de show, behalve met toestemming (scripts/td-waakhond.sh).
# Stoppen met stop-lab.command geeft de toestemming terug; na de tijd sluit de waakhond hem ook.
WAAKHOND="${FORYOU_TD_WAAKHOND:-$HOME/ForYou/main/scripts/td-waakhond.sh}"
if [[ -x "$WAAKHOND" ]]; then
  "$WAAKHOND" toestemming greenscreen "${LAB_MINUTEN:-180}" 'greenscreen-lab\.toe' || { echo "geen toestemming van de TD-waakhond" >&2; exit 1; }
fi
before="$(pgrep -x TouchDesigner | sort || true)"
open -n -a TouchDesigner "$LAB/td/greenscreen-lab.toe"
for _ in $(seq 1 40); do
  sleep 0.5
  after="$(pgrep -x TouchDesigner | sort || true)"
  new="$(comm -13 <(echo "$before") <(echo "$after") | head -1)"
  if [[ -n "$new" ]]; then
    echo "$new" > "$OUT/td-lab.pid"
    echo "lab-TD gestart (pid $new); show-TD pid(s): $(echo $before)"
    exit 0
  fi
done
echo "lab-TD niet gevonden" >&2
exit 1
