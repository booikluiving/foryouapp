#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"

SHOW_DIR="${FORYOU_TD_SHOW_DIR:-$REPO_ROOT/show}"
SHOW_PATTERN="${FORYOU_TD_SHOW_PATTERN:-ForYou TD Showcontrol-Jillis Juni v*.toe}"
LOG_PATH="${FORYOU_TD_SHOW_OPEN_LOG:-$HOME/Library/Logs/ForYouApp/showcontrol-touchdesigner-open.log}"
DRY_RUN="${FORYOU_TD_DRY_RUN:-0}"
ACTION="${1:-open}"

mkdir -p "$(dirname "$LOG_PATH")"

log() {
  printf '%s %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*" >> "$LOG_PATH"
}

version_for_file() {
  local base="$1"
  if [[ "$base" =~ [[:space:]]v([0-9]+([.][0-9]+)*)\.toe$ ]]; then
    printf '%s\n' "${BASH_REMATCH[1]}"
    return 0
  fi
  return 1
}

version_key() {
  local version="$1"
  local major minor patch
  IFS=. read -r major minor patch _ <<< "$version"
  printf '%06d.%06d.%06d\n' "${major:-0}" "${minor:-0}" "${patch:-0}"
}

select_latest_show_file() {
  local file base version key best_file="" best_key=""
  while IFS= read -r -d '' file; do
    base="$(basename "$file")"
    version="$(version_for_file "$base")" || continue
    key="$(version_key "$version")"
    if [[ -z "$best_key" || "$key" > "$best_key" ]]; then
      best_key="$key"
      best_file="$file"
    fi
  done < <(/usr/bin/find "$SHOW_DIR" -maxdepth 1 -type f -name "$SHOW_PATTERN" -print0 2>/dev/null)

  [[ -n "$best_file" ]] || return 1
  printf '%s\n' "$best_file"
}

open_touchdesigner_file() {
  local file="$1"
  log "OPEN file=$file"
  if [[ "$DRY_RUN" == "1" ]]; then
    printf 'action|open\nfile|%s\n' "$file"
    return 0
  fi
  /usr/bin/open "$file"
}

main() {
  local selected version

  selected="$(select_latest_show_file)" || {
    log "ERROR no matching show file dir=$SHOW_DIR pattern=$SHOW_PATTERN"
    printf 'Geen TouchDesigner showfile gevonden in %s met patroon %s\n' "$SHOW_DIR" "$SHOW_PATTERN" >&2
    return 1
  }
  version="$(version_for_file "$(basename "$selected")")"

  case "$ACTION" in
    selected|status)
      printf 'version|%s\nfile|%s\n' "$version" "$selected"
      ;;
    open|"")
      printf 'Open TouchDesigner showfile v%s:\n%s\n' "$version" "$selected"
      open_touchdesigner_file "$selected"
      ;;
    *)
      printf 'Usage: %s [open|selected|status]\n' "$0" >&2
      return 64
      ;;
  esac
}

main "$@"
