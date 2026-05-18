#!/usr/bin/env bash
set -euo pipefail

DROPBOX_ROOT="${FORYOU_DROPBOX_ROOT:-$HOME/Library/CloudStorage/Dropbox}"
LOG_PATH="${FORYOU_TD_OPEN_LOG:-$HOME/Library/Logs/ForYouApp/streamdeck-touchdesigner.log}"
DRY_RUN="${FORYOU_TD_DRY_RUN:-0}"
ACTION="${1:-toggle}"

mkdir -p "$(dirname "$LOG_PATH")"

log() {
  printf '%s %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*" >> "$LOG_PATH"
}

select_exact_major_toe() {
  local folder="$1"
  local kind="$2"

  find "$folder" -maxdepth 1 -type f -iname "*.toe" -print0 2>/dev/null | while IFS= read -r -d '' file; do
    local base version mtime
    base="$(basename "$file")"

    case "$kind" in
      api)
        [[ "$base" =~ [Aa][Pp][Ii] ]] || continue
        ;;
      foryou)
        [[ "$base" =~ [Ff]or[[:space:]]*[Yy]ou ]] || continue
        [[ "$base" =~ [Aa][Pp][Ii] ]] && continue
        ;;
      *)
        return 64
        ;;
    esac

    if [[ "$base" =~ [vV]([0-9]+)[[:space:]]*\.toe$ ]]; then
      version="${BASH_REMATCH[1]}"
      mtime="$(stat -f '%m' "$file")"
      printf '%s|%s|%s\n' "$version" "$mtime" "$file"
    fi
  done | sort -t '|' -k1,1nr -k2,2nr | head -n 1 | cut -d '|' -f 3-
}

candidate_folders() {
  local candidates=(
    "$DROPBOX_ROOT/Current Touch Designer version"
    "$DROPBOX_ROOT/Current Touch Designer Version"
    "$DROPBOX_ROOT/Current TouchDesigner version"
    "$DROPBOX_ROOT/Current TouchDesigner Version"
  )

  local candidate
  for candidate in "${candidates[@]}"; do
    [[ -d "$candidate" ]] && printf '%s\n' "$candidate"
  done

  if command -v mdfind >/dev/null 2>&1; then
    mdfind -onlyin "$DROPBOX_ROOT" \
      "kMDItemFSName == 'Current Touch Designer version' || kMDItemFSName == 'Current Touch Designer Version' || kMDItemFSName == 'Current TouchDesigner version' || kMDItemFSName == 'Current TouchDesigner Version'" \
      2>/dev/null || true
  fi
}

find_current_folder() {
  local best=""
  best="$(
    candidate_folders | awk '!seen[$0]++' | while IFS= read -r candidate; do
      [[ -d "$candidate" ]] || continue
      local api_file foryou_file score
      api_file="$(select_exact_major_toe "$candidate" api || true)"
      foryou_file="$(select_exact_major_toe "$candidate" foryou || true)"
      [[ -n "$api_file" && -n "$foryou_file" ]] || continue
      score="$(printf '%s\n%s\n' "$(stat -f '%m' "$api_file")" "$(stat -f '%m' "$foryou_file")" | sort -nr | head -n 1)"
      printf '%s|%s\n' "$score" "$candidate"
    done | sort -t '|' -k1,1nr | head -n 1 | cut -d '|' -f 2-
  )"

  [[ -n "$best" ]] || return 1
  printf '%s\n' "$best"
}

selected_files() {
  local folder="$1"
  local api_file foryou_file
  api_file="$(select_exact_major_toe "$folder" api)"
  foryou_file="$(select_exact_major_toe "$folder" foryou)"

  if [[ -z "$api_file" || -z "$foryou_file" ]]; then
    log "ERROR missing exact major .toe files folder=$folder api=$api_file foryou=$foryou_file"
    printf 'Missing exact major .toe files in %s\n' "$folder" >&2
    return 1
  fi

  printf '%s\n%s\n' "$api_file" "$foryou_file"
}

touchdesigner_pids_for_folder() {
  local folder="$1"
  local folder_lc pid command command_lc cwd cwd_lc
  folder_lc="$(printf '%s' "$folder" | tr '[:upper:]' '[:lower:]')"

  while IFS= read -r pid; do
    [[ -n "$pid" ]] || continue
    command="$(ps -p "$pid" -o command= 2>/dev/null || true)"
    cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1)"
    command_lc="$(printf '%s' "$command" | tr '[:upper:]' '[:lower:]')"
    cwd_lc="$(printf '%s' "$cwd" | tr '[:upper:]' '[:lower:]')"
    if [[ "$cwd_lc" == "$folder_lc" || "$command_lc" == *"$folder_lc"* ]]; then
      printf '%s\n' "$pid"
    fi
  done < <(pgrep -x TouchDesigner 2>/dev/null || true)
}

touchdesigner_status() {
  local folder="$1"
  if [[ -n "$(touchdesigner_pids_for_folder "$folder")" ]]; then
    printf 'aan\n'
  else
    printf 'uit\n'
  fi
}

open_touchdesigner() {
  local api_file="$1"
  local foryou_file="$2"

  log "OPEN api=$api_file"
  log "OPEN foryou=$foryou_file"

  if [[ "$DRY_RUN" == "1" ]]; then
    printf 'action|open\napi|%s\nforyou|%s\n' "$api_file" "$foryou_file"
    return 0
  fi

  /usr/bin/open "$api_file"
  /usr/bin/open "$foryou_file"
}

close_touchdesigner() {
  local folder="$1"
  local pids
  pids="$(touchdesigner_pids_for_folder "$folder")"

  if [[ -z "$pids" ]]; then
    log "CLOSE skipped no TouchDesigner pids for folder=$folder"
    [[ "$DRY_RUN" == "1" ]] && printf 'action|close\nstatus|already_off\n'
    return 0
  fi

  log "CLOSE pids=$(printf '%s' "$pids" | tr '\n' ' ') folder=$folder"

  if [[ "$DRY_RUN" == "1" ]]; then
    printf 'action|close\npids|%s\n' "$(printf '%s' "$pids" | tr '\n' ' ')"
    return 0
  fi

  osascript -e 'tell application "TouchDesigner" to quit' >/dev/null 2>&1 || true

  for _ in 1 2 3 4 5; do
    sleep 1
    [[ -z "$(touchdesigner_pids_for_folder "$folder")" ]] && return 0
  done

  while IFS= read -r pid; do
    [[ -n "$pid" ]] && kill -TERM "$pid" 2>/dev/null || true
  done <<< "$(touchdesigner_pids_for_folder "$folder")"
}

main() {
  local folder status api_file foryou_file selected

  folder="$(find_current_folder)" || {
    log "ERROR missing Current TouchDesigner folder under $DROPBOX_ROOT"
    printf 'Missing Current TouchDesigner folder under %s\n' "$DROPBOX_ROOT" >&2
    return 1
  }

  status="$(touchdesigner_status "$folder")"

  case "$ACTION" in
    status)
      printf '%s\n' "$status"
      ;;
    selected)
      selected_files "$folder" | sed '1s/^/api|/;2s/^/foryou|/'
      ;;
    open)
      selected="$(selected_files "$folder")"
      api_file="$(printf '%s\n' "$selected" | sed -n '1p')"
      foryou_file="$(printf '%s\n' "$selected" | sed -n '2p')"
      open_touchdesigner "$api_file" "$foryou_file"
      ;;
    close|stop)
      close_touchdesigner "$folder"
      ;;
    toggle|"")
      if [[ "$status" == "aan" ]]; then
        close_touchdesigner "$folder"
      else
        selected="$(selected_files "$folder")"
        api_file="$(printf '%s\n' "$selected" | sed -n '1p')"
        foryou_file="$(printf '%s\n' "$selected" | sed -n '2p')"
        open_touchdesigner "$api_file" "$foryou_file"
      fi
      ;;
    *)
      printf 'Usage: %s [status|selected|open|close|toggle]\n' "$0" >&2
      return 64
      ;;
  esac
}

main "$@"
