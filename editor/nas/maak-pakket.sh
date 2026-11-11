#!/bin/sh
# Zet alleen wat de editor nodig heeft in een map (standaard: editor/nas/pakket), uit git:
# geen showdata, geen media, geen geheimen.
set -eu
APP="$(cd "$(dirname "$0")/../.." && pwd)"
DOEL="${1:-$APP/editor/nas/pakket}"
rm -rf "$DOEL"
mkdir -p "$DOEL"
cd "$APP"
git ls-files -z -- package.json package-lock.json shared modules/catalog modules/paths editor \
  ':!:editor/nas/pakket' ':!:editor/tests' ':!:modules/catalog/tests' ':!:modules/paths/tests' \
  | xargs -0 -I{} sh -c 'mkdir -p "$1/$(dirname "$2")" && cp "$2" "$1/$2"' _ "$DOEL" {}
cp editor/nas/Dockerfile "$DOEL/Dockerfile"
printf 'node_modules\n' > "$DOEL/.dockerignore"
echo "pakket: $DOEL ($(du -sh "$DOEL" | cut -f1))"
