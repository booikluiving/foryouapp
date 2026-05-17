#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
APP_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
APP_LABEL="${FORYOU_LAUNCHD_LABEL:-nl.foryou.app}"
APP_PORT="${FORYOU_PORT:-3310}"
APP_BRANCH="${FORYOU_BRANCH:-main}"
ALLOW_LIVE_BRANCH="${FORYOU_ALLOW_LIVE_BRANCH:-0}"
ADMIN_AUTH_DISABLED="${FORYOU_ADMIN_AUTH_DISABLED:-1}"
ADMIN_BOOTSTRAP_PASSWORD="${FORYOU_ADMIN_PASSWORD:-Tijdelijk_2026!}"
PLIST_PATH="$HOME/Library/LaunchAgents/${APP_LABEL}.plist"
LOG_DIR="$HOME/Library/Logs/ForYouApp"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

fail() {
  echo "FOUT: $*" >&2
  exit 1
}

info() {
  echo "==> $*"
}

xml_escape() {
  printf '%s' "$1" \
    | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'
}

detect_lan_ip() {
  local ip=""
  ip="$(ipconfig getifaddr en0 2>/dev/null || true)"
  if [[ -z "$ip" ]]; then
    ip="$(ipconfig getifaddr en1 2>/dev/null || true)"
  fi
  if [[ -z "$ip" ]]; then
    ip="$(
      ifconfig | awk '
        $1 == "inet" {
          ip = $2;
          if (ip ~ /^192\.168\./ || ip ~ /^10\./) {
            print ip;
            exit;
          }
          if (ip ~ /^172\./) {
            split(ip, parts, ".");
            second = parts[2] + 0;
            if (second >= 16 && second <= 31) {
              print ip;
              exit;
            }
          }
        }
      '
    )"
  fi
  echo "$ip"
}

ensure_git_repo() {
  cd "$APP_DIR"
  if [[ ! -d .git ]]; then
    fail "Deze map is geen git clone. Clone eerst de repo en run dit script opnieuw."
  fi
}

ensure_node() {
  if command -v node >/dev/null 2>&1; then
    local major=""
    major="$(node -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || echo 0)"
    if [[ "$major" -ge 22 ]]; then
      return 0
    fi
  fi

  if command -v brew >/dev/null 2>&1; then
    info "Node 22+ ontbreekt; installeren/updaten via Homebrew."
    brew install node || brew upgrade node || true
  else
    fail "Node 22+ ontbreekt en Homebrew is niet gevonden. Installeer Node.js 22+ of Homebrew en run dit script opnieuw."
  fi

  if ! command -v node >/dev/null 2>&1; then
    fail "Node is na installatie nog niet beschikbaar."
  fi
  local major=""
  major="$(node -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || echo 0)"
  if [[ "$major" -lt 22 ]]; then
    fail "Node $(node -v) is te oud. Deze app vereist Node 22+."
  fi

  if ! command -v npm >/dev/null 2>&1; then
    fail "npm is niet beschikbaar terwijl Node wel gevonden is."
  fi
}

ensure_clean_worktree_for_pull() {
  cd "$APP_DIR"
  if [[ -n "$(git status --porcelain)" ]]; then
    info "Werkmap heeft lokale wijzigingen; git pull wordt overgeslagen."
    return 1
  fi
  return 0
}

pull_latest() {
  cd "$APP_DIR"
  if [[ "$APP_PORT" == "3310" && "$APP_BRANCH" != "main" && "$ALLOW_LIVE_BRANCH" != "1" ]]; then
    fail "Launchd setup op live poort 3310 mag standaard alleen vanaf main. Gebruik scripts/mac-studio-preview.command ${APP_BRANCH} voor branch-preview, of zet bewust FORYOU_ALLOW_LIVE_BRANCH=1."
  fi
  if ensure_clean_worktree_for_pull; then
    info "Laatste code ophalen van origin/${APP_BRANCH}."
    git fetch origin "$APP_BRANCH"
    git checkout "$APP_BRANCH"
    git pull --ff-only origin "$APP_BRANCH"
  fi
}

install_dependencies() {
  cd "$APP_DIR"
  info "Node dependencies installeren."
  npm install
}

write_launch_agent() {
  mkdir -p "$(dirname "$PLIST_PATH")" "$LOG_DIR"

  local escaped_label=""
  local escaped_app_dir=""
  local escaped_port=""
  local escaped_admin_auth_disabled=""
  local escaped_password=""
  local escaped_npm=""
  local escaped_stdout=""
  local escaped_stderr=""

  escaped_label="$(xml_escape "$APP_LABEL")"
  escaped_app_dir="$(xml_escape "$APP_DIR")"
  escaped_port="$(xml_escape "$APP_PORT")"
  escaped_admin_auth_disabled="$(xml_escape "$ADMIN_AUTH_DISABLED")"
  escaped_password="$(xml_escape "$ADMIN_BOOTSTRAP_PASSWORD")"
  escaped_npm="$(xml_escape "$(command -v npm)")"
  escaped_stdout="$(xml_escape "$LOG_DIR/server.out.log")"
  escaped_stderr="$(xml_escape "$LOG_DIR/server.err.log")"

  info "LaunchAgent schrijven: $PLIST_PATH"
  cat > "$PLIST_PATH" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escaped_label}</string>
  <key>WorkingDirectory</key>
  <string>${escaped_app_dir}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-lc</string>
    <string>cd "${escaped_app_dir}" &amp;&amp; PORT="${escaped_port}" ADMIN_AUTH_DISABLED="${escaped_admin_auth_disabled}" ADMIN_PASSWORD="${escaped_password}" "${escaped_npm}" start</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${escaped_stdout}</string>
  <key>StandardErrorPath</key>
  <string>${escaped_stderr}</string>
</dict>
</plist>
PLIST
}

restart_service() {
  info "For You service herstarten."
  launchctl bootout "gui/$(id -u)" "$PLIST_PATH" >/dev/null 2>&1 || true
  launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH"
  launchctl kickstart -k "gui/$(id -u)/$APP_LABEL" >/dev/null 2>&1 || true
}

wait_for_health() {
  local url="http://127.0.0.1:${APP_PORT}/health"
  local body=""
  info "Wachten op health-check: $url"
  for _ in {1..40}; do
    body="$(curl -fsS --max-time 1 "$url" 2>/dev/null || true)"
    if [[ "$body" == *'"ok":true'* && "$body" == *'"buildLabel"'* ]]; then
      return 0
    fi
    sleep 0.5
  done
  echo "Laatste serverlog:"
  tail -n 80 "$LOG_DIR/server.err.log" 2>/dev/null || true
  fail "Server werd niet gezond op poort $APP_PORT."
}

run_smoke() {
  cd "$APP_DIR"
  info "Smoke-test draaien."
  npm run smoke -- --url "http://127.0.0.1:${APP_PORT}"
}

print_urls() {
  local lan_ip=""
  lan_ip="$(detect_lan_ip)"
  echo ""
  echo "For You App draait op de Mac Studio."
  echo "Admin lokaal:  http://127.0.0.1:${APP_PORT}/admin"
  echo "Stage lokaal:  http://127.0.0.1:${APP_PORT}/stage"
  if [[ -n "$lan_ip" ]]; then
    echo "Admin netwerk: http://${lan_ip}:${APP_PORT}/admin"
    echo "Publiek/QR:    http://${lan_ip}:${APP_PORT}/"
  fi
  echo ""
  echo "Admin-auth staat standaard uit. Zet ADMIN_AUTH_DISABLED=0 om wachtwoordlogin weer te gebruiken."
  echo "Logs: $LOG_DIR"
}

main() {
  ensure_git_repo
  ensure_node
  pull_latest
  install_dependencies
  write_launch_agent
  restart_service
  wait_for_health
  run_smoke
  print_urls
}

main "$@"
