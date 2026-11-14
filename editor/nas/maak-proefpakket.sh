#!/bin/sh
# De proefshow als eigen map (proefapp) naast een bestaande editor op de NAS: de code van de show
# zoals die nu in deze map staat, zonder gegevens en zonder geheimen. De editor start hem met
#   EDITOR_PROEFSHOW=1  EDITOR_PROEF_APP=/app/proefapp  EDITOR_PROEF_DATA=/app/proefapp/gegevens
# Gebruik: maak-proefpakket.sh <map van het editorpakket>   (er komt een map proefapp in)
set -eu
APP="$(cd "$(dirname "$0")/../.." && pwd)"
DOEL="${1:?geef de map van het editorpakket}/proefapp"
rm -rf "$DOEL"
mkdir -p "$DOEL"
cd "$APP"
git ls-files -z -- shared modules/catalog modules/paths modules/script-agent modules/runtime modules/audience \
  modules/algorithm modules/show-control editor/proef ':!:modules/*/tests' ':!:modules/show-control/hardware' \
  | xargs -0 -I{} sh -c '[ -f "$2" ] && mkdir -p "$1/$(dirname "$2")" && cp "$2" "$1/$2" || true' _ "$DOEL" {}
# De onderdelen willen hun gegevens binnen hun eigen app. In docker-compose.yml hoort daarom:
#   volumes:  - ./data/proefshow:/app/proefapp/gegevens      (map data/proefshow, eigenaar 1000)
mkdir -p "$DOEL/gegevens"
echo "Hier koppelt docker-compose de map data/proefshow." > "$DOEL/gegevens/LEESMIJ.txt"
printf 'main %s, %s\n' "$(git rev-parse --short HEAD)" "$(date '+%Y-%m-%d %H:%M')" > "$DOEL/BRON.txt"
echo "proefpakket: $DOEL ($(du -sh "$DOEL" | cut -f1))"
