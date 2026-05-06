#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
APP_DIR="${FORYOU_LOCAL_APP_DIR:-$(cd -- "$SCRIPT_DIR/.." && pwd)}"
SYNC_SCRIPT_DIR="${FORYOU_SYNC_SCRIPT_DIR:-$SCRIPT_DIR}"
STUDIO_HOST="${FORYOU_STUDIO_HOST:-foryou-studio}"
REMOTE_APP_DIR="${FORYOU_STUDIO_APP_DIR:-/Users/for_you/ForYou/App}"
LOCAL_DB="${FORYOU_LOCAL_DB:-$APP_DIR/data/live.sqlite}"
SYNC_CACHE_DIR="${FORYOU_SYNC_CACHE_DIR:-$HOME/Services/ForYouApp/cache}"
SYNC_HASH_FILE="$SYNC_CACHE_DIR/algorithm-catalog.sha256"
TMP_JSON="$(mktemp -t foryou-algorithm-catalog.XXXXXX.json)"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

cleanup() {
  rm -f "$TMP_JSON"
}
trap cleanup EXIT

echo "==> Pull algoritme-catalogus van ${STUDIO_HOST}"
ssh "$STUDIO_HOST" "cd '$REMOTE_APP_DIR' && PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin node scripts/sync-algorithm-catalog.js export --db data/live.sqlite" > "$TMP_JSON"

mkdir -p "$SYNC_CACHE_DIR"
next_hash="$(
  node -e 'const fs=require("fs"); const crypto=require("crypto"); const payload=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); delete payload.exportedAt; delete payload.source; process.stdout.write(crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex"));' "$TMP_JSON"
)"
prev_hash="$(cat "$SYNC_HASH_FILE" 2>/dev/null || true)"
if [[ "$next_hash" == "$prev_hash" ]]; then
  echo "==> Geen wijzigingen sinds vorige sync."
  exit 0
fi

echo "==> Import op MacBook: $LOCAL_DB"
node "$SYNC_SCRIPT_DIR/sync-algorithm-catalog.js" import --db "$LOCAL_DB" --input "$TMP_JSON" --backup
echo "$next_hash" > "$SYNC_HASH_FILE"

echo "==> Algoritme-catalogus synced van Mac Studio naar MacBook."
