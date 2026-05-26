#!/bin/zsh
set -u

cd "$(dirname "$0")" || exit 1

export DEMO_UI_PORT="${DEMO_UI_PORT:-3035}"
export DEMO_CATALOG_PORT="${DEMO_CATALOG_PORT:-3031}"
export DEMO_TD_OSC_PORT="${DEMO_TD_OSC_PORT:-9110}"
export DEMO_TD_ACK_PORT="${DEMO_TD_ACK_PORT:-9111}"

URL="http://127.0.0.1:${DEMO_UI_PORT}"
TD_FILE="$PWD/ForYou TD Demo.toe"

clear
echo "For You TouchDesigner Demo"
echo "==========================="
echo ""
echo "Deze demo start nu:"
echo "- webpagina:       $URL"
echo "- catalog API:     http://127.0.0.1:${DEMO_CATALOG_PORT}"
echo "- OSC naar TD:     127.0.0.1:${DEMO_TD_OSC_PORT}"
echo "- ack terug van TD:127.0.0.1:${DEMO_TD_ACK_PORT}"
echo ""
echo "Laat dit Terminal-venster open zolang je de demo gebruikt."
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is niet gevonden."
  echo "Installeer Node.js en dubbelklik daarna opnieuw op start-demo.command."
  echo ""
  echo "Druk op Enter om dit venster te sluiten."
  read
  exit 1
fi

(
  for _attempt in {1..60}; do
    if /usr/bin/curl -fsS "$URL/api/demo/status" >/dev/null 2>&1; then
      /usr/bin/open "$URL"
      if [ -f "$TD_FILE" ]; then
        /usr/bin/open "$TD_FILE"
      fi
      exit 0
    fi
    sleep 0.25
  done
  echo "Kon de demo-webpagina niet automatisch openen. Probeer handmatig: $URL"
) &

node demo-server.js
STATUS=$?

echo ""
echo "De demo-server is gestopt."
echo "Exit code: $STATUS"
echo ""
echo "Druk op Enter om dit venster te sluiten."
read
exit "$STATUS"
