#!/usr/bin/env bash
set -euo pipefail

DROPBOX_ROOT="${FORYOU_DROPBOX_ROOT:-$HOME/Library/CloudStorage/Dropbox}"
LOG_PATH="${FORYOU_TD_OPEN_LOG:-$HOME/Library/Logs/ForYouApp/streamdeck-touchdesigner.log}"
DRY_RUN="${FORYOU_TD_DRY_RUN:-0}"
ACTION="${1:-toggle}"
SHOW_TD_PROJECT="${FORYOU_TOUCHDESIGNER_PROJECT:-$DROPBOX_ROOT/For You/Voorstelling/show/td-light/For You TD Light POC from v3.37.toe}"
API_TD_PROJECT="${FORYOU_TOUCHDESIGNER_API_PROJECT:-}"
TD_WINDOW_X="${FORYOU_TD_WINDOW_X:--2550}"
TD_WINDOW_Y="${FORYOU_TD_WINDOW_Y:-40}"
TD_WINDOW_WIDTH="${FORYOU_TD_WINDOW_WIDTH:-2520}"
TD_WINDOW_HEIGHT="${FORYOU_TD_WINDOW_HEIGHT:-1360}"
TD_WINDOW_POSITION_RETRIES="${FORYOU_TD_WINDOW_POSITION_RETRIES:-10}"

mkdir -p "$(dirname "$LOG_PATH")"

log() {
  printf '%s %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*" >> "$LOG_PATH"
}

find_current_folder() {
  [[ -f "$SHOW_TD_PROJECT" ]] || return 1
  dirname "$SHOW_TD_PROJECT"
}

selected_files() {
  local folder="$1"
  local api_file foryou_file
  api_file="$API_TD_PROJECT"
  foryou_file="$SHOW_TD_PROJECT"

  if [[ -n "$api_file" && ! -f "$api_file" ]]; then
    log "ERROR missing configured API TouchDesigner project api=$api_file"
    printf 'Missing configured API TouchDesigner project: %s\n' "$api_file" >&2
    return 1
  fi

  if [[ ! -f "$foryou_file" ]]; then
    log "ERROR missing configured For You TouchDesigner project foryou=$foryou_file"
    printf 'Missing configured For You TouchDesigner project: %s\n' "$foryou_file" >&2
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

  [[ -n "$api_file" ]] && /usr/bin/open "$api_file"
  /usr/bin/open "$foryou_file"
  position_touchdesigner_windows
}

position_touchdesigner_windows() {
  local result attempt

  if [[ "$DRY_RUN" == "1" ]]; then
    printf 'window|x=%s|y=%s|w=%s|h=%s\n' "$TD_WINDOW_X" "$TD_WINDOW_Y" "$TD_WINDOW_WIDTH" "$TD_WINDOW_HEIGHT"
    return 0
  fi

  for ((attempt = 1; attempt <= TD_WINDOW_POSITION_RETRIES; attempt += 1)); do
    result="$(
      osascript - "$TD_WINDOW_X" "$TD_WINDOW_Y" "$TD_WINDOW_WIDTH" "$TD_WINDOW_HEIGHT" <<'APPLESCRIPT' 2>&1 || true
on run argv
  set windowX to item 1 of argv as integer
  set windowY to item 2 of argv as integer
  set windowWidth to item 3 of argv as integer
  set windowHeight to item 4 of argv as integer
  set positionedCount to 0

  tell application "System Events"
    if not (exists process "TouchDesigner") then return "missing"
    tell process "TouchDesigner"
      if (count of windows) is 0 then return "no_windows"
      repeat with touchDesignerWindow in windows
        try
          set windowName to name of touchDesignerWindow as text
          if windowName contains ".toe" then
            set position of touchDesignerWindow to {windowX, windowY}
            set size of touchDesignerWindow to {windowWidth, windowHeight}
            set positionedCount to positionedCount + 1
          end if
        end try
      end repeat
      if positionedCount is 0 then return "no_editor_window"
      return "positioned"
    end tell
  end tell
end run
APPLESCRIPT
    )"

    log "POSITION attempt=$attempt result=$result bounds=$TD_WINDOW_X,$TD_WINDOW_Y,$TD_WINDOW_WIDTH,$TD_WINDOW_HEIGHT"
    [[ "$result" == "positioned" ]] && return 0
    [[ "$result" != "missing" && "$result" != "no_windows" && "$result" != "no_editor_window" ]] && return 0
    sleep 1
  done
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
    log "ERROR missing configured TouchDesigner project project=$SHOW_TD_PROJECT"
    printf 'Missing configured TouchDesigner project: %s\n' "$SHOW_TD_PROJECT" >&2
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
