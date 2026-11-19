#!/usr/bin/env bash
# TD-waakhond: er draait altijd precies één TouchDesigner, met de nieuwste versie van het showbestand.
#
#   td-waakhond.sh                         draaien (LaunchAgent nl.foryou.td-waakhond)
#   td-waakhond.sh --een-keer              één ronde
#   td-waakhond.sh versie                  welke versie geldt
#   td-waakhond.sh toestemming NAAM MIN REGEX
#                                          een andere TD (bijv. Greenscreen Lab) mag MIN minuten draaien;
#                                          REGEX moet in het argument van die TD voorkomen
#   td-waakhond.sh klaar NAAM              toestemming terug; die TD gaat dicht
#
# Elke ronde:
#   - Versiebestand ($VERSIE_BESTAND): de nieuwste "ForYou TD Showcontrol - Najaar 2026 v*.toe" in show/
#     (zelfde keuze als de launcher). Bewaart iemand een nieuwe versie, dan staat die er de volgende ronde in.
#   - Show-TD = TD met het showbestand als argument, of die de OSC-poort van show control (UDP 9100) houdt.
#     Meer show-TD's: die met de poort blijft (krijgt de opdrachten), anders de oudste. De rest gaat dicht.
#   - Andere TD (leeg project, ander bestand) gaat dicht, tenzij er toestemming voor is. Draaide er geen
#     show-TD, dan opent de waakhond daarna de nieuwste versie met de launcher.
#   - Een nieuwe TD krijgt eerst GRACE seconden om zijn project te laden.
#
# Modus ($MODUS_BESTAND): "melden" (alleen in het logboek) of "sluiten". Zonder bestand: melden.
# Logboek blijft klein: alleen wijzigingen, en bij meer dan LOG_MAX regels de oudste weg.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
TD_BIN="/Applications/TouchDesigner.app/Contents/MacOS/TouchDesigner"
SHOW_PATTERN_RE="${FORYOU_TD_SHOW_RE:-ForYou TD Showcontrol - Najaar 2026 v[0-9.]+\.toe}"
SHOW_POORT="${FORYOU_TD_SHOW_POORT:-9100}"
GRACE="${FORYOU_TD_WAAKHOND_GRACE:-60}"
INTERVAL="${FORYOU_TD_WAAKHOND_INTERVAL:-3}"
STATE_DIR="${FORYOU_TD_WAAKHOND_STATE_DIR:-$HOME/Library/Application Support/ForYouApp}"
MODUS_BESTAND="${FORYOU_TD_WAAKHOND_MODUS_BESTAND:-$STATE_DIR/td-waakhond-modus}"
TOESTEMMING="${FORYOU_TD_WAAKHOND_TOESTEMMING:-$STATE_DIR/td-waakhond-toestemming}"
VERSIE_BESTAND="${FORYOU_TD_VERSIE_BESTAND:-$HOME/ForYou/td-versie.txt}"
LOG="${FORYOU_TD_WAAKHOND_LOG:-$HOME/Library/Logs/ForYou/td-waakhond.log}"
# Welke show-TD draait (pid met de OSC-poort): show control ziet aan een nieuwe pid dat TD herstart is.
TD_SHOW_BESTAND="${FORYOU_TD_SHOW_STAND:-$STATE_DIR/td-show.json}"
LOG_MAX="${FORYOU_TD_WAAKHOND_LOG_MAX:-300}"
LAUNCHER="${FORYOU_TD_WAAKHOND_LAUNCHER:-$REPO_ROOT/scripts/open-current-showcontrol-td.command}"

mkdir -p "$(dirname "$LOG")" "$STATE_DIR" "$(dirname "$VERSIE_BESTAND")"

log() {
  printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG"
  if (( $(wc -l < "$LOG") > LOG_MAX )); then
    tail -n $(( LOG_MAX / 2 )) "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
  fi
}

modus() {
  local m
  m="$( { tr -d '[:space:]' < "$MODUS_BESTAND"; } 2>/dev/null || true)"
  [[ "$m" == "sluiten" ]] && echo sluiten || echo melden
}

nu() { date +%s; }

# ---------- versie ----------

nieuwste_bestand() { "$LAUNCHER" selected 2>/dev/null | sed -n 's/^file|//p'; }

werk_versie_bij() {
  local bestand oud
  bestand="$(nieuwste_bestand)"
  [[ -n "$bestand" ]] || return 0
  oud="$(sed -n 's/^bestand: //p' "$VERSIE_BESTAND" 2>/dev/null)"
  [[ "$bestand" == "$oud" ]] && return 0
  {
    echo "versie: $(basename "$bestand" | sed -E 's/.* (v[0-9.]+)\.toe$/\1/')"
    echo "bestand: $bestand"
    echo "sinds: $(date '+%Y-%m-%d %H:%M')"
  } > "$VERSIE_BESTAND.tmp" && mv "$VERSIE_BESTAND.tmp" "$VERSIE_BESTAND"
  log "VERSIE nu $(basename "$bestand")"
}

# ---------- toestemming ----------

# Regels "naam|regex|tot (epoch)". Verlopen regels tellen niet.
toestemming_voor() { # args -> naam of leeg
  local args="$1" naam regex tot
  [[ -f "$TOESTEMMING" ]] || return 0
  while IFS='|' read -r naam regex tot; do
    [[ -n "$naam" ]] || continue
    (( tot > $(nu) )) || continue
    [[ "$args" =~ $regex ]] && { echo "$naam"; return 0; }
  done < "$TOESTEMMING"
}

geef_toestemming() {
  local naam="$1" minuten="$2" regex="$3"
  [[ -n "$naam" && "$minuten" =~ ^[0-9]+$ && -n "$regex" ]] || { echo "gebruik: toestemming NAAM MINUTEN REGEX" >&2; return 64; }
  trek_in "$naam" stil
  printf '%s|%s|%s\n' "$naam" "$regex" "$(( $(nu) + minuten * 60 ))" >> "$TOESTEMMING"
  log "TOESTEMMING $naam $minuten min ($regex)"
  echo "toestemming: $naam mag $minuten minuten draaien"
}

trek_in() {
  local naam="$1"
  [[ -f "$TOESTEMMING" ]] || return 0
  grep -v "^$naam|" "$TOESTEMMING" > "$TOESTEMMING.tmp" || true
  mv "$TOESTEMMING.tmp" "$TOESTEMMING"
  [[ "${2:-}" == stil ]] || { log "KLAAR $naam: toestemming ingetrokken"; echo "klaar: $naam gaat dicht"; }
}

# ---------- processen ----------

# Regels "pid|leeftijd_s|argumenten" van alle TouchDesigner-hoofdprocessen (geen cef-helpers).
td_processen() {
  if [[ -n "${FORYOU_TD_WAAKHOND_TEST_PS:-}" ]]; then cat "$FORYOU_TD_WAAKHOND_TEST_PS"; return; fi
  ps -axo pid=,etime=,args= | while read -r pid etime rest; do
    [[ "$rest" == "$TD_BIN" || "$rest" == "$TD_BIN "* ]] || continue
    local args="${rest#"$TD_BIN"}"; args="${args# }"
    printf '%s|%s|%s\n' "$pid" "$(etime_s "$etime")" "$args"
  done
}

etime_s() { # [[dd-]hh:]mm:ss -> seconden
  local e="$1" d=0 h=0 m=0 s=0 a b c
  [[ "$e" == *-* ]] && { d="${e%%-*}"; e="${e#*-}"; }
  IFS=: read -r a b c <<< "$e"
  if [[ -n "${c:-}" ]]; then h=$a; m=$b; s=$c; else m=$a; s=$b; fi
  echo $(( 10#$d*86400 + 10#$h*3600 + 10#$m*60 + 10#$s ))
}

heeft_poort() {
  if [[ -n "${FORYOU_TD_WAAKHOND_TEST_POORT+x}" ]]; then [[ " $FORYOU_TD_WAAKHOND_TEST_POORT " == *" $1 "* ]]; return; fi
  /usr/sbin/lsof -nP -a -p "$1" -iUDP:"$SHOW_POORT" >/dev/null 2>&1
}

GEMELD=""
eenmaal() { # sleutel tekst: alleen loggen als deze sleutel nog niet gemeld is
  [[ "$GEMELD" == *"|$1|"* ]] && return 0
  GEMELD+="|$1|"; log "$2"
}

sluit() {
  local pid="$1" reden="$2"
  if [[ "$(modus)" != "sluiten" ]]; then
    eenmaal "melden-$pid" "MELDEN zou sluiten pid=$pid ($reden)"
    return 1
  fi
  log "SLUIT pid=$pid ($reden)"
  kill -TERM "$pid" 2>/dev/null || true
  local i
  for i in 1 2 3 4 5 6 7 8 9 10; do kill -0 "$pid" 2>/dev/null || return 0; sleep 1; done
  log "SLUIT pid=$pid reageert niet op TERM, KILL"
  kill -KILL "$pid" 2>/dev/null || true
  return 0
}

VORIGE_TD_SHOW="-"
schrijf_td_show() {
  local pid="$1"
  [[ "$pid" == "$VORIGE_TD_SHOW" ]] && return 0
  VORIGE_TD_SHOW="$pid"
  printf '{"pid":%s,"sinds":"%s"}\n' "${pid:-null}" "$(date '+%Y-%m-%dT%H:%M:%S')" > "$TD_SHOW_BESTAND.tmp" && mv "$TD_SHOW_BESTAND.tmp" "$TD_SHOW_BESTAND"
}

VORIGE_STAND=""

ronde() {
  werk_versie_bij

  local regels show=() vreemd=() pid leeftijd args poort stand="" r
  regels="$(td_processen)"
  while IFS='|' read -r pid leeftijd args; do
    [[ -n "$pid" ]] || continue
    poort=0; heeft_poort "$pid" && poort=1
    if [[ "$args" =~ $SHOW_PATTERN_RE ]] || (( poort )); then
      show+=("$pid|$leeftijd|$poort|$args")
    else
      vreemd+=("$pid|$leeftijd|$poort|$args")
    fi
    stand+="$pid:$poort:${args##*/};"
  done <<< "$regels"

  # De show-TD met de poort (precies één): naar het bestand voor show control.
  local met_poort_pid="" aantal_poort=0
  for r in "${show[@]+"${show[@]}"}"; do IFS='|' read -r pid leeftijd poort args <<< "$r"; (( poort )) && { aantal_poort=$((aantal_poort+1)); met_poort_pid=$pid; }; done
  (( aantal_poort == 1 )) || met_poort_pid=""
  schrijf_td_show "$met_poort_pid"

  if [[ "$stand" != "$VORIGE_STAND" ]]; then
    log "STAND modus=$(modus) show=${#show[@]} anders=${#vreemd[@]} [$stand]"
    VORIGE_STAND="$stand"
  fi

  # Meer show-TD's: houd de TD met de poort, anders de oudste.
  if (( ${#show[@]} > 1 )); then
    local houd="" houd_leeftijd=-1 met_poort=0
    for r in "${show[@]}"; do IFS='|' read -r pid leeftijd poort args <<< "$r"; (( poort )) && { met_poort=$((met_poort+1)); houd=$pid; }; done
    if (( met_poort != 1 )); then
      houd=""
      for r in "${show[@]}"; do IFS='|' read -r pid leeftijd poort args <<< "$r"; (( leeftijd > houd_leeftijd )) && { houd=$pid; houd_leeftijd=$leeftijd; }; done
    fi
    for r in "${show[@]}"; do
      IFS='|' read -r pid leeftijd poort args <<< "$r"
      [[ "$pid" == "$houd" ]] && continue
      (( leeftijd >= GRACE )) || continue
      sluit "$pid" "tweede show-TD naast pid=$houd, ${args##*/}"
    done
  fi

  # Andere TD: alleen met toestemming.
  local gesloten=0 naam
  for r in "${vreemd[@]+"${vreemd[@]}"}"; do
    IFS='|' read -r pid leeftijd poort args <<< "$r"
    naam="$(toestemming_voor "$args")"
    if [[ -n "$naam" ]]; then
      eenmaal "toegestaan-$pid" "TOEGESTAAN pid=$pid ($naam: ${args##*/})"
      continue
    fi
    (( leeftijd >= GRACE )) || continue
    sluit "$pid" "geen showbestand en geen toestemming: ${args:-leeg project}" && gesloten=1
  done
  if (( gesloten )) && (( ${#show[@]} == 0 )); then
    log "OPEN nieuwste versie via launcher (er draaide geen show-TD)"
    "$LAUNCHER" open >> "$LOG" 2>&1 || log "OPEN mislukt"
  fi
}

case "${1:-}" in
  versie) werk_versie_bij; cat "$VERSIE_BESTAND" ;;
  toestemming) geef_toestemming "${2:-}" "${3:-}" "${4:-}" ;;
  klaar) trek_in "${2:?naam}" ;;
  --een-keer) ronde ;;
  "")
    log "START waakhond modus=$(modus) grace=${GRACE}s interval=${INTERVAL}s"
    while true; do ronde; sleep "$INTERVAL"; done ;;
  *) echo "gebruik: $0 [--een-keer|versie|toestemming NAAM MINUTEN REGEX|klaar NAAM]" >&2; exit 64 ;;
esac
