#!/bin/zsh
set -euo pipefail

echo "Niet geinstalleerd: deze LaunchAgent-sync is vervangen door de local-first Sync-module op /algoritme."
echo "De oude versie kon nieuwe velden overschrijven en blijft daarom bewust uit."
exit 3

SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
APP_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
LABEL="${FORYOU_SYNC_LABEL:-nl.foryou.macbook.algorithm-sync}"
INTERVAL="${FORYOU_SYNC_INTERVAL:-30}"
PLIST_PATH="$HOME/Library/LaunchAgents/${LABEL}.plist"
LOG_DIR="$HOME/Library/Logs/ForYouApp"
SERVICE_DIR="$HOME/Services/ForYouApp"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

mkdir -p "$(dirname "$PLIST_PATH")" "$LOG_DIR" "$SERVICE_DIR"
cp "$APP_DIR/scripts/sync-algorithm-from-studio.command" "$SERVICE_DIR/sync-algorithm-from-studio.command"
cp "$APP_DIR/scripts/sync-algorithm-catalog.js" "$SERVICE_DIR/sync-algorithm-catalog.js"
chmod +x "$SERVICE_DIR/sync-algorithm-from-studio.command" "$SERVICE_DIR/sync-algorithm-catalog.js"

cat > "$PLIST_PATH" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-lc</string>
    <string>FORYOU_LOCAL_APP_DIR="${APP_DIR}" FORYOU_SYNC_SCRIPT_DIR="${SERVICE_DIR}" "${SERVICE_DIR}/sync-algorithm-from-studio.command"</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>StartInterval</key>
  <integer>${INTERVAL}</integer>
  <key>StandardOutPath</key>
  <string>${LOG_DIR}/algorithm-sync.out.log</string>
  <key>StandardErrorPath</key>
  <string>${LOG_DIR}/algorithm-sync.err.log</string>
</dict>
</plist>
PLIST

plutil -lint "$PLIST_PATH" >/dev/null
launchctl bootout "gui/$(id -u)" "$PLIST_PATH" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH"
launchctl kickstart -k "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true

echo "MacBook algoritme-sync actief: ${LABEL}"
echo "Interval: ${INTERVAL}s"
echo "Log: ${LOG_DIR}/algorithm-sync.out.log"
