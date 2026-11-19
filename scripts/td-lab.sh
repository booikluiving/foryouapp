#!/usr/bin/env bash
# Een lab (een tweede TouchDesigner naast de show, zoals de Greenscreen Lab) openen en sluiten via de
# TD-waakhond. Zonder toestemming sluit de waakhond elke andere TD dan de show na een minuut.
#
#   td-lab.sh start NAAM BESTAND.toe [MINUTEN]   toestemming vragen (standaard 120 min) en openen
#   td-lab.sh stop NAAM                          toestemming terug; de waakhond sluit de lab-TD
#   td-lab.sh lijst                              welke labs nu toestemming hebben
#
# Verloopt de tijd, dan sluit de waakhond de lab-TD ook. Langer nodig: start opnieuw met dezelfde naam.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
WAAKHOND="${FORYOU_TD_WAAKHOND:-$SCRIPT_DIR/td-waakhond.sh}"
OPEN="${FORYOU_TD_LAB_OPEN:-/usr/bin/open}"
TOESTEMMING="${FORYOU_TD_WAAKHOND_TOESTEMMING:-$HOME/Library/Application Support/ForYouApp/td-waakhond-toestemming}"

gebruik() { echo "gebruik: $0 start NAAM BESTAND.toe [MINUTEN] | stop NAAM | lijst" >&2; exit 64; }

# Het argument waarmee TouchDesigner draait bevat het pad; de waakhond zoekt de bestandsnaam.
regex_van() { basename "$1" | sed 's/[][\.*^$+?(){}|]/\\&/g'; }

case "${1:-}" in
  start)
    naam="${2:-}"; bestand="${3:-}"; minuten="${4:-120}"
    [[ -n "$naam" && -f "$bestand" ]] || gebruik
    [[ "$minuten" =~ ^[0-9]+$ ]] || gebruik
    "$WAAKHOND" toestemming "$naam" "$minuten" "$(regex_van "$bestand")" || exit 1
    "$OPEN" -n -a TouchDesigner "$bestand"
    echo "lab $naam open ($bestand), toestemming $minuten minuten"
    ;;
  stop)
    naam="${2:-}"
    [[ -n "$naam" ]] || gebruik
    "$WAAKHOND" klaar "$naam"
    ;;
  lijst)
    nu="$(date +%s)"
    [[ -f "$TOESTEMMING" ]] || { echo "geen labs"; exit 0; }
    while IFS='|' read -r naam regex tot; do
      [[ -n "$naam" ]] || continue
      if (( tot > nu )); then echo "$naam: nog $(( (tot - nu) / 60 )) min ($regex)"; else echo "$naam: verlopen"; fi
    done < "$TOESTEMMING"
    ;;
  *) gebruik ;;
esac
