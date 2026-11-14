#!/bin/sh
# Zet alleen wat de editor nodig heeft in een map (standaard: editor/nas/pakket), uit git:
# geen showdata, geen media, geen geheimen.
set -eu
APP="$(cd "$(dirname "$0")/../.." && pwd)"
DOEL="${1:-$APP/editor/nas/pakket}"
rm -rf "$DOEL"
mkdir -p "$DOEL"
cd "$APP"
# De proefshow (editor/proef) draait ook runtime, publiek, algoritme en show control.
git ls-files -z -- package.json package-lock.json shared modules/catalog modules/paths modules/script-agent \
  modules/runtime modules/audience modules/algorithm modules/show-control editor \
  ':!:editor/nas/pakket' ':!:editor/tests' ':!:modules/*/tests' ':!:modules/show-control/hardware' \
  | xargs -0 -I{} sh -c 'mkdir -p "$1/$(dirname "$2")" && cp "$2" "$1/$2"' _ "$DOEL" {}
cp editor/nas/Dockerfile "$DOEL/Dockerfile"
printf 'node_modules\n' > "$DOEL/.dockerignore"
echo "pakket: $DOEL ($(du -sh "$DOEL" | cut -f1))"
