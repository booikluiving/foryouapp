#!/bin/zsh
# Zet de sync met de website uit. De show draait gewoon door op wat er nu staat.
set -euo pipefail
LABEL="nl.foryou.sync"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
launchctl bootout "gui/$(id -u)" "$PLIST" >/dev/null 2>&1 || true
rm -f "$PLIST"
printf '==> Gestopt: %s\n' "$LABEL"
