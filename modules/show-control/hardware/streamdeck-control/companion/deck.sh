#!/bin/zsh
# Stream Deck XL van For_You: bouwen, testen, toepassen, terugdraaien.
#
#   deck.sh check                 deck.json controleren
#   deck.sh test start|stop|status|druk <key>
#                                 test-Companion op 127.0.0.1:18008 met een kopie van de echte config,
#                                 virtuele deck: http://127.0.0.1:18008/emulator/streamdeck-xl
#                                 knoppen doen in de test niets buiten Companion (FY_DECK_DROOG=1)
#   deck.sh toepassen --ja        echte Companion ombouwen (volledige back-up eerst)
#   deck.sh terugdraaien [map]    laatste (of opgegeven) back-up terugzetten
#   deck.sh status                hoe staat de echte opstelling erbij
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
RES=/Applications/Companion.app/Contents/Resources
NODE="$RES/node-runtimes/node22/bin/node"
UID_NUM="$(id -u)"

LIVE_CFG="$HOME/Library/Application Support/companion"
INSTALL="$HOME/ForYou/streamdeck"
BACKUPS="$HOME/ForYou/companion-backups"
OLD_SCRIPTS="$HOME/ForYou/companion-scripts"
ELGATO_PLIST="$HOME/Library/LaunchAgents/com.elgato.StreamDeck.plist"
STATUS_LABEL="nl.foryou.deck-status"
STATUS_PLIST="$HOME/Library/LaunchAgents/$STATUS_LABEL.plist"
LOG_DIR="$HOME/Library/Logs/ForYouV2"

TEST="$HOME/Library/Caches/ForYouApp/deck-test"
TEST_PORT=18008
TEST_URL="http://127.0.0.1:$TEST_PORT"

# oude Stream Deck-scripts die bij toepassen naar het archief gaan (proxies en PerfectCue blijven staan)
OLD_PATTERNS=('configure-*.js' foryou-audio-toggle.sh foryou-audio-web-button.sh foryou-browser-tabs.sh
  foryou-operator-scene-to-chat-button.js foryou-osc-button.js foryou-ready-toggle.js
  foryou-server-status-to-companion.js foryou-server-toggle.sh foryou-show-control-cue-button.js
  foryou-start-scene-toggle.js foryou-teleprompter-cue.js foryou-v2-stack-button.js foryou-v2-stack-toggle.sh
  foryou-v2-status-to-companion.js foryou-web-button.js hide-old-streamdeck-pages-direct-db.js
  open-current-touchdesigner.sh remove-streamdeck-page2-duplicates-direct-db.js
  sq5-streamdeck-status-to-companion.js style-page2-labels.js v2-streamdeck-common.js validate-v2-streamdeck-pages.js)

say() { print -r -- "$*"; }
die() { print -r -- "STOP: $*" >&2; exit 1; }

db_open_by() { lsof -t "$1/v4.3/db.sqlite" 2>/dev/null | tr '\n' ' ' || true; }

wait_http() {
  local url="$1" tries="${2:-60}"
  for i in $(seq 1 "$tries"); do
    curl -fsS -o /dev/null --max-time 1 "$url/" 2>/dev/null && return 0
    sleep 0.5
  done
  return 1
}

# ---------- test ----------

test_running() { [[ -f "$TEST/companion.pid" ]] && kill -0 "$(cat "$TEST/companion.pid")" 2>/dev/null; }

test_stop() {
  local f pid kids
  for f in status companion; do
    if [[ -f "$TEST/$f.pid" ]]; then
      pid="$(cat "$TEST/$f.pid")"
      kids="$(pgrep -P "$pid" 2>/dev/null || true)"
      kill "$pid" 2>/dev/null || true
      for i in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || break; sleep 0.5; done
      kill -9 "$pid" 2>/dev/null || true
      [[ -n "$kids" ]] && kill ${=kids} 2>/dev/null || true
      rm -f "$TEST/$f.pid"
    fi
  done
  say "test gestopt"
}

test_start() {
  test_running && test_stop
  lsof -nP -iTCP:$TEST_PORT -sTCP:LISTEN >/dev/null 2>&1 && die "tcp $TEST_PORT is al bezet"
  rm -rf "$TEST/config" "$TEST/hold"
  mkdir -p "$TEST/config/v4.3" "$TEST/hold"
  # kopie van de echte database (alleen lezen), zonder de echte deck of netwerkdiensten
  sqlite3 "file:$LIVE_CFG/v4.3/db.sqlite?mode=ro" ".backup '$TEST/config/v4.3/db.sqlite'"
  "$NODE" "$SRC/bouw.js" --config-dir "$TEST/config" --surface emulator --scripts-dir "$SRC"
  sqlite3 "$TEST/config/v4.3/db.sqlite" "UPDATE main SET value=json_set(value,'\$.osc_enabled',json('false'),'\$.detailed_data_collection',json('false')) WHERE id='userconfig';"
  local bad
  bad="$(sqlite3 "$TEST/config/v4.3/db.sqlite" "
    SELECT 'surface '||id FROM surfaces WHERE id NOT LIKE 'emulator:%';
    SELECT 'usb_hotplug aan' FROM main WHERE id='userconfig' AND json_extract(value,'\$.usb_hotplug');
    SELECT 'elgato-plugin aan' FROM main WHERE id='userconfig' AND json_extract(value,'\$.elgato_plugin_enable');
    SELECT 'surface-module aan' FROM instances WHERE json_extract(value,'\$.moduleInstanceType')='surface' AND json_extract(value,'\$.enabled');")"
  [[ -z "$bad" ]] || die "test-db raakt de echte deck: $bad"

  local env_vars=(FY_DECK_COMPANION_URL="$TEST_URL" FY_DECK_DROOG=1 FY_DECK_HOLD_DIR="$TEST/hold" FY_DECK_LOG="$TEST/deck.log")
  (cd "$RES" && env $env_vars nohup "$NODE" --import "$SRC/test/companion-shim.mjs" "$RES/main.js" \
      --config-dir "$TEST/config" --admin-address 127.0.0.1 --admin-port $TEST_PORT \
      --machine-id foryou-deck-test --log-level info --no-notifications </dev/null >"$TEST/companion.log" 2>&1) &
  echo $! >"$TEST/companion.pid"
  wait_http "$TEST_URL" 80 || { tail -30 "$TEST/companion.log" >&2; die "test-Companion start niet"; }
  (env $env_vars nohup "$NODE" "$SRC/deck-status.js" </dev/null >"$TEST/status.log" 2>&1) &
  echo $! >"$TEST/status.pid"
  say "test draait: $TEST_URL/emulator/streamdeck-xl  (log: $TEST/deck.log)"
}

test_druk() {
  local key="$1"
  local loc
  loc="$(sqlite3 "$TEST/config/v4.3/db.sqlite" "SELECT p.id||'/'||r.key||'/'||c.key FROM pages p, json_each(json_extract(p.value,'\$.controls')) r, json_each(r.value) c WHERE c.value='bank:fy_$key';")"
  [[ -n "$loc" ]] || die "geen knop $key"
  curl -fsS -X POST "$TEST_URL/api/location/$loc/press" && say " ($key = $loc)"
}

# ---------- echt ----------

companion_stopped() { [[ -z "$(db_open_by "$LIVE_CFG")" ]] && ! pgrep -x Companion >/dev/null; }

companion_quit() {
  osascript -e 'if application id "test-companion.bitfocus.no" is running then tell application id "test-companion.bitfocus.no" to quit' >/dev/null 2>&1 || true
  for i in $(seq 1 40); do companion_stopped && return 0; sleep 0.5; done
  pkill -TERM -x Companion 2>/dev/null || true
  for i in $(seq 1 30); do companion_stopped && return 0; sleep 0.5; done
  die "Companion stopt niet (db open door: $(db_open_by "$LIVE_CFG"))"
}

companion_open() {
  open -a Companion
  wait_http "http://127.0.0.1:8008" 80 || die "Companion start niet op :8008"
}

status_agent_write() {
  mkdir -p "$LOG_DIR"
  cat >"$STATUS_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$STATUS_LABEL</string>
  <key>ProgramArguments</key>
  <array><string>$NODE</string><string>$INSTALL/deck-status.js</string></array>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOG_DIR/$STATUS_LABEL.out.log</string>
  <key>StandardErrorPath</key><string>$LOG_DIR/$STATUS_LABEL.err.log</string>
</dict>
</plist>
PLIST
}

toepassen() {
  [[ "${1:-}" == "--ja" ]] || die "alleen met --ja (na akkoord van Booi)"
  "$NODE" "$SRC/bouw.js" --check
  test_running && test_stop
  local ts; ts="$(date +%Y%m%d-%H%M%S)"
  local bk="$BACKUPS/deck-revamp-$ts"
  mkdir -p "$bk"
  say "1/7 Companion stoppen"
  companion_quit
  say "2/7 back-up naar $bk"
  tar -C "$(dirname "$LIVE_CFG")" -czf "$bk/companion.tgz" "$(basename "$LIVE_CFG")"
  [[ -f "$ELGATO_PLIST" ]] && cp -p "$ELGATO_PLIST" "$bk/"
  [[ -d "$INSTALL" ]] && tar -C "$(dirname "$INSTALL")" -czf "$bk/streamdeck-install.tgz" "$(basename "$INSTALL")"
  pgrep -x "Stream Deck" >/dev/null && echo aan >"$bk/elgato-app" || echo uit >"$bk/elgato-app"
  say "3/7 scripts installeren in $INSTALL"
  mkdir -p "$INSTALL/test"
  cp -p "$SRC"/{deck.json,lib.js,bouw.js,deck-actie.js,deck-status.js,browser-tabs.sh,stack.sh,deck.sh} "$INSTALL/"
  cp -p "$SRC/test/companion-shim.mjs" "$INSTALL/test/"
  (cd "$SRC" && git rev-parse --short HEAD 2>/dev/null || echo onbekend) >"$INSTALL/VERSIE"
  say "4/7 Companion-indeling bouwen"
  "$NODE" "$INSTALL/bouw.js" --config-dir "$LIVE_CFG" --surface usb --scripts-dir "$INSTALL"
  say "5/7 Elgato-app uit"
  osascript -e 'if application id "com.elgato.StreamDeck" is running then tell application id "com.elgato.StreamDeck" to quit' >/dev/null 2>&1 || true
  if [[ -f "$ELGATO_PLIST" ]]; then
    launchctl bootout "gui/$UID_NUM/com.elgato.StreamDeck" 2>/dev/null || true
    mv "$ELGATO_PLIST" "$bk/com.elgato.StreamDeck.plist.uit"
  fi
  pkill -x "Stream Deck" 2>/dev/null || true
  say "6/7 oude scripts naar archief"
  local arch="$OLD_SCRIPTS/archief-deck-$ts"
  mkdir -p "$arch"
  (cd "$OLD_SCRIPTS" && setopt null_glob && for p in $OLD_PATTERNS; do for f in ${~p}; do mv "$f" "$arch/"; done; done)
  echo "$arch" >"$bk/archief-pad"
  say "7/7 statusdienst en Companion starten"
  launchctl bootout "gui/$UID_NUM/$STATUS_LABEL" 2>/dev/null || true
  status_agent_write
  launchctl bootstrap "gui/$UID_NUM" "$STATUS_PLIST"
  companion_open
  say "klaar. terugdraaien: $INSTALL/deck.sh terugdraaien $bk"
  live_status
}

terugdraaien() {
  local bk="${1:-}"
  [[ -n "$bk" ]] || bk="$(ls -d "$BACKUPS"/deck-revamp-* 2>/dev/null | sort | tail -1)"
  [[ -f "$bk/companion.tgz" ]] || die "geen back-up gevonden ($bk)"
  say "terugzetten uit $bk"
  launchctl bootout "gui/$UID_NUM/$STATUS_LABEL" 2>/dev/null || true
  rm -f "$STATUS_PLIST"
  companion_quit
  local ts; ts="$(date +%Y%m%d-%H%M%S)"
  mv "$LIVE_CFG" "$LIVE_CFG.voor-terugdraaien-$ts"
  tar -C "$(dirname "$LIVE_CFG")" -xzf "$bk/companion.tgz"
  if [[ -f "$bk/archief-pad" ]]; then
    local arch; arch="$(cat "$bk/archief-pad")"
    [[ -d "$arch" ]] && { mv "$arch"/* "$OLD_SCRIPTS/" 2>/dev/null || true; rmdir "$arch" 2>/dev/null || true; }
  fi
  if [[ -f "$bk/com.elgato.StreamDeck.plist.uit" ]]; then
    cp -p "$bk/com.elgato.StreamDeck.plist.uit" "$ELGATO_PLIST"
    launchctl bootstrap "gui/$UID_NUM" "$ELGATO_PLIST" 2>/dev/null || true
  fi
  companion_open
  say "teruggezet. de omgebouwde config staat nog in $LIVE_CFG.voor-terugdraaien-$ts"
}

live_status() {
  say "Companion :8008      $(curl -fsS -o /dev/null --max-time 1 http://127.0.0.1:8008/ && echo draait || echo UIT)"
  say "deck-indeling        $(sqlite3 "file:$LIVE_CFG/v4.3/db.sqlite?mode=ro" "SELECT value FROM main WHERE id='fy_deck'" 2>/dev/null || echo -)"
  say "surfaces             $(sqlite3 "file:$LIVE_CFG/v4.3/db.sqlite?mode=ro" "SELECT group_concat(id,', ') FROM surfaces" 2>/dev/null)"
  say "Elgato-app           $(pgrep -x 'Stream Deck' >/dev/null && echo draait || echo uit)"
  say "statusdienst         $(launchctl print "gui/$UID_NUM/$STATUS_LABEL" >/dev/null 2>&1 && echo geladen || echo niet geladen)"
  say "consolegebruiker     $(stat -f %Su /dev/console)  (deck werkt alleen als dit for_you is)"
  local f="$LIVE_CFG/logs/companion-$(date -u +%Y-%m-%d).0.log"
  [[ -f "$f" ]] && say "HID-fouten vandaag   $(grep -c 'Cannot write to hid' "$f" || true)"
}

case "${1:-}" in
  check) "$NODE" "$SRC/bouw.js" --check ;;
  test)
    case "${2:-}" in
      start) test_start ;;
      stop) test_stop ;;
      status) test_running && say "test draait: $TEST_URL/emulator/streamdeck-xl" || say "test draait niet" ;;
      druk) test_druk "${3:?key}" ;;
      *) die "deck.sh test start|stop|status|druk <key>" ;;
    esac ;;
  toepassen) shift; toepassen "$@" ;;
  terugdraaien) shift; terugdraaien "$@" ;;
  status) live_status ;;
  *) die "gebruik: deck.sh check | test start|stop|status|druk <key> | toepassen --ja | terugdraaien [map] | status" ;;
esac
