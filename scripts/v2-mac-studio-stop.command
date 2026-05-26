#!/bin/zsh
set -euo pipefail

DOMAIN="gui/$(id -u)"
LABELS=(
  nl.foryou.v2.gateway
  nl.foryou.v2.script-agent
  nl.foryou.v2.audience
  nl.foryou.v2.show-control
  nl.foryou.v2.perfect-cue-control
  nl.foryou.v2.streamdeck-control
  nl.foryou.v2.camera-control
  nl.foryou.v2.sq5-control
  nl.foryou.v2.runtime
  nl.foryou.v2.algorithm
  nl.foryou.v2.paths
  nl.foryou.v2.catalog
)

for label in "${LABELS[@]}"; do
  plist="$HOME/Library/LaunchAgents/${label}.plist"
  launchctl bootout "$DOMAIN/$label" >/dev/null 2>&1 || \
    launchctl bootout "$DOMAIN" "$plist" >/dev/null 2>&1 || true
  printf 'Gestopt: %s\n' "$label"
done
