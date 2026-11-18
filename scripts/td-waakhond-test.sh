#!/usr/bin/env bash
# Test van de TD-waakhond met verzonnen processen (pid's die niet bestaan) en een nep-launcher.
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd -P)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
SHOW="/Users/x/show/ForYou TD Showcontrol - Najaar 2026 v1.67.toe"
echo "/Users/x/show/ForYou TD Showcontrol - Najaar 2026 v1.69.toe" > "$T/nieuwste"
cat > "$T/launcher" <<EOF
#!/bin/sh
case "\$1" in selected) echo "file|\$(cat "$T/nieuwste")";; *) echo LAUNCHER-OPEN;; esac
EOF
chmod +x "$T/launcher"
export FORYOU_TD_WAAKHOND_TEST_PS="$T/ps" FORYOU_TD_WAAKHOND_MODUS_BESTAND="$T/modus" \
  FORYOU_TD_WAAKHOND_LOG="$T/log" FORYOU_TD_WAAKHOND_LAUNCHER="$T/launcher" \
  FORYOU_TD_WAAKHOND_STATE_DIR="$T" FORYOU_TD_WAAKHOND_TOESTEMMING="$T/toestemming" \
  FORYOU_TD_VERSIE_BESTAND="$T/td-versie.txt"
W="$DIR/td-waakhond.sh"
fout=0
check() { # naam wel-regex niet-regex
  if ! grep -Eq "$2" "$T/log" || { [[ -n "${3:-}" ]] && grep -Eq "$3" "$T/log"; }; then
    echo "FOUT: $1"; sed 's/^/    /' "$T/log"; fout=1
  else echo "ok: $1"; fi
}
geval() { # naam modus poort-pids wel niet ; ps-regels op stdin
  cat > "$T/ps"; echo "$2" > "$T/modus"; : > "$T/log"
  FORYOU_TD_WAAKHOND_TEST_POORT="$3" "$W" --een-keer
  check "$1" "$4" "${5:-}"
}

geval "één show-TD: niets" sluiten "900001" "STAND" "SLUIT|MELDEN|OPEN" <<< "900001|500|$SHOW"
geval "leeg naast show: sluiten, geen launcher" sluiten "900001" "SLUIT pid=900002 \(geen showbestand" "OPEN" <<EOF
900001|500|$SHOW
900002|900|
EOF
geval "melden sluit niets" melden "900001" "MELDEN zou sluiten pid=900002" "SLUIT|OPEN" <<EOF
900001|500|$SHOW
900002|900|
EOF
geval "alleen leeg: sluiten en nieuwste openen" sluiten "" "OPEN nieuwste versie" <<< "900002|900|"
geval "leeg maar jonger dan grace: wachten" sluiten "" "STAND" "SLUIT|OPEN" <<< "900002|10|"
geval "twee show-TD's: houd die met poort (jongste)" sluiten "900005" "SLUIT pid=900004 \(tweede show-TD naast pid=900005" "SLUIT pid=900005" <<EOF
900004|900|$SHOW
900005|300|$SHOW
EOF
geval "twee zonder poort: houd de oudste" sluiten "" "SLUIT pid=900007 \(tweede show-TD naast pid=900006" "SLUIT pid=900006" <<EOF
900006|900|$SHOW
900007|300|$SHOW
EOF
geval "show via Finder (geen argument, wel poort) blijft" sluiten "900008" "STAND" "SLUIT|OPEN" <<< "900008|900|"

# Versiebestand
grep -q "versie: v1.69" "$T/td-versie.txt" && echo "ok: versiebestand v1.69" || { echo "FOUT: versiebestand"; cat "$T/td-versie.txt"; fout=1; }
echo "/Users/x/show/ForYou TD Showcontrol - Najaar 2026 v1.70.toe" > "$T/nieuwste"
geval "nieuwe versie bewaard: versiebestand volgt" sluiten "900001" "VERSIE nu .*v1.70" <<< "900001|500|$SHOW"
grep -q "versie: v1.70" "$T/td-versie.txt" && echo "ok: versiebestand v1.70" || { echo "FOUT: versiebestand v1.70"; fout=1; }

# Toestemming Greenscreen Lab
LAB="/Users/x/greenscreen-lab/td/Greenscreen lab.toe"
"$W" toestemming greenscreen 30 'greenscreen-lab' > /dev/null
geval "lab met toestemming blijft" sluiten "900001" "TOEGESTAAN pid=900010" "SLUIT" <<EOF
900001|500|$SHOW
900010|900|$LAB
EOF
"$W" klaar greenscreen > /dev/null
geval "lab na klaar gaat dicht" sluiten "900001" "SLUIT pid=900010 \(geen showbestand en geen toestemming" <<EOF
900001|500|$SHOW
900010|900|$LAB
EOF
printf 'greenscreen|greenscreen-lab|%s\n' "$(( $(date +%s) - 5 ))" > "$T/toestemming"
geval "lab met verlopen toestemming gaat dicht" sluiten "900001" "SLUIT pid=900010" <<EOF
900001|500|$SHOW
900010|900|$LAB
EOF
geval "ander .toe zonder toestemming gaat dicht" sluiten "900001" "SLUIT pid=900009" <<EOF
900001|500|$SHOW
900009|900|/x/Greenscreen test.toe
EOF

# Logboek blijft klein
: > "$T/log"; for i in $(seq 1 400); do echo "regel $i" >> "$T/log"; done
FORYOU_TD_WAAKHOND_TEST_POORT="900001" "$W" --een-keer
n=$(wc -l < "$T/log"); (( n <= 300 )) && echo "ok: logboek ingekort ($n regels)" || { echo "FOUT: logboek $n regels"; fout=1; }

exit $fout
