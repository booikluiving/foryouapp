#!/bin/bash
set -euo pipefail

REPO_DIR="/Users/for_you/ForYou/main"
MEDIA_SRC="${REPO_DIR}/modules/catalog/media"
DB_SRC="${REPO_DIR}/modules/catalog/db/catalog.sqlite"
BACKUP_ROOT="${FORYOU_MEDIA_BACKUP_ROOT:-/Users/for_you/Library/CloudStorage/Dropbox/For You/media database backup}"
MEDIA_DEST="${BACKUP_ROOT}/media-current"
DB_CURRENT_DIR="${BACKUP_ROOT}/db-current"
DB_DAILY_DIR="${BACKUP_ROOT}/db-daily"
LOG_DIR="${BACKUP_ROOT}/logs"
MANIFEST_DIR="${BACKUP_ROOT}/manifests"
LOCK_DIR="/tmp/foryou-catalog-media-backup.lock"
RSYNC_BWLIMIT_KB="${FORYOU_MEDIA_BACKUP_BWLIMIT_KB:-10240}"

timestamp_utc() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

date_stamp() {
  date +"%Y-%m-%d"
}

log() {
  printf '%s %s\n' "$(timestamp_utc)" "$*"
}

if ! mkdir "${LOCK_DIR}" 2>/dev/null; then
  log "Another catalog media backup is already running; exiting."
  exit 0
fi

cleanup() {
  rmdir "${LOCK_DIR}" 2>/dev/null || true
}
trap cleanup EXIT

mkdir -p "${MEDIA_DEST}" "${DB_CURRENT_DIR}" "${DB_DAILY_DIR}" "${LOG_DIR}" "${MANIFEST_DIR}"

STAMP="$(date_stamp)"
LOG_FILE="${LOG_DIR}/${STAMP}.log"
MANIFEST_FILE="${MANIFEST_DIR}/${STAMP}.json"
DB_TMP="${DB_CURRENT_DIR}/catalog.sqlite.tmp"
DB_CURRENT="${DB_CURRENT_DIR}/catalog.sqlite"
DB_DAILY="${DB_DAILY_DIR}/catalog-${STAMP}.sqlite"

{
  log "Starting catalog media backup."
  log "Source media: ${MEDIA_SRC}"
  log "Source db: ${DB_SRC}"
  log "Backup root: ${BACKUP_ROOT}"

  if [ ! -d "${MEDIA_SRC}" ]; then
    log "ERROR: media source does not exist: ${MEDIA_SRC}"
    exit 1
  fi

  if [ ! -f "${DB_SRC}" ]; then
    log "ERROR: catalog SQLite database does not exist: ${DB_SRC}"
    exit 1
  fi

  log "Backing up SQLite database using sqlite3 .backup."
  rm -f "${DB_TMP}"
  sqlite3 "${DB_SRC}" ".timeout 5000" ".backup '${DB_TMP}'"
  mv -f "${DB_TMP}" "${DB_CURRENT}"
  cp -p "${DB_CURRENT}" "${DB_DAILY}"

  log "Backing up media with rsync; no deletes, no continuous watcher."
  rsync -a \
    --ignore-existing \
    --bwlimit="${RSYNC_BWLIMIT_KB}" \
    --exclude=".DS_Store" \
    --exclude="/_asset-upload-tmp/" \
    "${MEDIA_SRC}/" \
    "${MEDIA_DEST}/"

  MEDIA_SOURCE_FILES="$(find "${MEDIA_SRC}" -type f ! -name ".DS_Store" | wc -l | tr -d ' ')"
  MEDIA_BACKUP_FILES="$(find "${MEDIA_DEST}" -type f ! -name ".DS_Store" | wc -l | tr -d ' ')"
  MEDIA_SOURCE_SIZE="$(du -sh "${MEDIA_SRC}" | awk '{print $1}')"
  MEDIA_BACKUP_SIZE="$(du -sh "${MEDIA_DEST}" | awk '{print $1}')"
  DB_CURRENT_SIZE="$(du -sh "${DB_CURRENT}" | awk '{print $1}')"

  cat > "${MANIFEST_FILE}" <<JSON
{
  "ok": true,
  "finishedAt": "$(timestamp_utc)",
  "source": {
    "media": "${MEDIA_SRC}",
    "database": "${DB_SRC}",
    "mediaFiles": ${MEDIA_SOURCE_FILES},
    "mediaSize": "${MEDIA_SOURCE_SIZE}"
  },
  "backup": {
    "root": "${BACKUP_ROOT}",
    "media": "${MEDIA_DEST}",
    "databaseCurrent": "${DB_CURRENT}",
    "databaseDaily": "${DB_DAILY}",
    "mediaFiles": ${MEDIA_BACKUP_FILES},
    "mediaSize": "${MEDIA_BACKUP_SIZE}",
    "databaseSize": "${DB_CURRENT_SIZE}"
  },
  "policy": {
    "schedule": "daily",
    "mediaDeletes": false,
    "mediaOverwriteExisting": false,
    "rsyncBwlimitKb": ${RSYNC_BWLIMIT_KB}
  }
}
JSON

  log "Backup complete."
  log "Media source files: ${MEDIA_SOURCE_FILES}; backup files: ${MEDIA_BACKUP_FILES}."
  log "Manifest: ${MANIFEST_FILE}"
} 2>&1 | tee -a "${LOG_FILE}"
