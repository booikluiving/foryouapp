#!/bin/zsh
set -euo pipefail

DOMAIN="gui/$(id -u)"
LABELS=(
  nl.foryou.gateway
  nl.foryou.script-agent
  nl.foryou.audience
  nl.foryou.show-control
  nl.foryou.perfect-cue-control
  nl.foryou.streamdeck-control
  nl.foryou.camera-control
  nl.foryou.sq5-control
  nl.foryou.runtime
  nl.foryou.algorithm
  nl.foryou.paths
  nl.foryou.catalog
)

for label in "${LABELS[@]}"; do
  plist="$HOME/Library/LaunchAgents/${label}.plist"
  launchctl bootout "$DOMAIN/$label" >/dev/null 2>&1 || \
    launchctl bootout "$DOMAIN" "$plist" >/dev/null 2>&1 || true
  printf 'Gestopt: %s\n' "$label"
done
