#!/bin/zsh
# Zet de sync met de website aan op de show-Mac (LaunchAgent nl.foryou.sync).
# Nodig: sync-agent/config.local.json (zie sync-agent/config.voorbeeld.json).
# Uitzetten: scripts/sync-agent-stoppen.command
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
REPO_DIR="$(cd -- "$SCRIPT_DIR/.." && git rev-parse --show-toplevel)"
PLIST_DIR="$HOME/Library/LaunchAgents"
LOG_DIR="$HOME/Library/Logs/ForYou"
DOMAIN="gui/$(id -u)"
LABEL="nl.foryou.sync"
CONFIG="$REPO_DIR/sync-agent/config.local.json"
PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export PATH

fail() {
  printf 'FOUT: %s\n' "$*" >&2
  exit 1
}

[[ -f "$CONFIG" ]] || fail "$CONFIG ontbreekt; kopieer sync-agent/config.voorbeeld.json en vul hem in"
chmod 600 "$CONFIG"
NODE_BIN="${FORYOU_NODE_BIN:-}"
[[ -n "$NODE_BIN" && -x "$NODE_BIN" ]] || NODE_BIN="$([[ -x /opt/homebrew/bin/node ]] && echo /opt/homebrew/bin/node || command -v node)"
[[ -x "$NODE_BIN" ]] || fail "Node.js niet gevonden"

printf '==> Eerst één ronde met de hand\n'
"$NODE_BIN" "$REPO_DIR/sync-agent/run.js" --een-keer || fail "de eerste ronde mislukte; zie hierboven"

mkdir -p "$PLIST_DIR" "$LOG_DIR"
PLIST="$PLIST_DIR/$LABEL.plist"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN</string>
    <string>$REPO_DIR/sync-agent/run.js</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$REPO_DIR</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>30</integer>
  <key>StandardOutPath</key>
  <string>$LOG_DIR/sync.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_DIR/sync.log</string>
</dict>
</plist>
PLIST
plutil -lint "$PLIST" >/dev/null
launchctl bootout "$DOMAIN" "$PLIST" >/dev/null 2>&1 || true
launchctl bootstrap "$DOMAIN" "$PLIST"
printf '==> Gestart: %s (log: %s/sync.log, stand: sync-agent/data/status.json)\n' "$LABEL" "$LOG_DIR"
