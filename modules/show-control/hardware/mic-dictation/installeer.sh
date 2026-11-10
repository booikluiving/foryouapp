#!/bin/zsh
# Bouwt mic-knop en zet hem vast als LaunchAgent nl.foryou.mic-knop.
#   ./installeer.sh          bouwen + installeren + (her)starten
#   ./installeer.sh uit      LaunchAgent stoppen en weghalen (binary blijft staan)
set -e
HIER=${0:A:h}
DOEL=$HOME/ForYou/mic-knop
PLIST=$HOME/Library/LaunchAgents/nl.foryou.mic-knop.plist
LOGS=$HOME/Library/Logs/ForYou
if [[ "$1" == "uit" ]]; then
  launchctl bootout gui/$(id -u)/nl.foryou.mic-knop 2>/dev/null || true
  rm -f "$PLIST"; echo "mic-knop uit"; exit 0
fi
mkdir -p "$DOEL" "$LOGS"
swiftc -O "$HIER/mic-knop.swift" -o "$DOEL/mic-knop.nieuw" -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker "$HIER/Info.plist"
codesign -s - -f -i nl.foryou.mic-knop "$DOEL/mic-knop.nieuw"
mv "$DOEL/mic-knop.nieuw" "$DOEL/mic-knop"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>nl.foryou.mic-knop</string>
  <key>ProgramArguments</key><array><string>$DOEL/mic-knop</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>LimitLoadToSessionType</key><string>Aqua</string>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardOutPath</key><string>$LOGS/nl.foryou.mic-knop.out.log</string>
  <key>StandardErrorPath</key><string>$LOGS/nl.foryou.mic-knop.err.log</string>
</dict>
</plist>
PL
launchctl bootout gui/$(id -u)/nl.foryou.mic-knop 2>/dev/null || true
launchctl bootstrap gui/$(id -u) "$PLIST"
echo "mic-knop draait: curl -s http://127.0.0.1:3231/api/state"
