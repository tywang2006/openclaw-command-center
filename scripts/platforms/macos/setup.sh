#!/usr/bin/env bash
#
# OpenClaw Command Center — macOS First-Run Setup
# Runs in Terminal on first launch.
# Compatible with macOS default bash 3.2 (no associative arrays).
#

set -euo pipefail

# Colors
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'
CYAN='\033[0;36m'; TEAL='\033[38;5;43m'; BOLD='\033[1m'
DIM='\033[2m'; NC='\033[0m'

log()  { printf "  ${GREEN}[OK]${NC} %s\n" "$1"; }
warn() { printf "  ${YELLOW}[!!]${NC} %s\n" "$1"; }
err()  { printf "  ${RED}[XX]${NC} %s\n" "$1"; exit 1; }
info() { printf "  ${CYAN}[ii]${NC} %s\n" "$1"; }

# Detect where we are (inside .app bundle or standalone)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -f "${SCRIPT_DIR}/node" ]; then
  RESOURCES="${SCRIPT_DIR}"
  NODE="${RESOURCES}/node"
  APP_DIR="${RESOURCES}/app"
else
  err "Cannot find bundled Node.js binary"
fi

# i18n — bash 3.2 compatible (no associative arrays)
LANG_CODE=""
t() {
  local key="$1"
  if [ "$LANG_CODE" = "zh" ]; then
    case "$key" in
      title)             echo "OpenClaw 指挥中心 — 首次设置" ;;
      copying)           echo "正在安装文件..." ;;
      password_prompt)   echo "设置访问密码（最少6位，留空使用默认: openclaw）" ;;
      password_confirm)  echo "确认密码" ;;
      password_mismatch) echo "两次密码不一致，使用默认密码" ;;
      password_ok)       echo "密码已设置" ;;
      env_create)        echo "创建配置文件..." ;;
      layout_gen)        echo "生成办公室布局..." ;;
      starting)          echo "启动服务..." ;;
      health_ok)         echo "服务运行正常" ;;
      health_fail)       echo "服务可能仍在启动中" ;;
      done)              echo "安装完成！" ;;
      url)               echo "访问地址" ;;
      password_label)    echo "密码" ;;
      relaunch)          echo "请关闭此窗口，然后重新双击应用图标启动" ;;
      *)                 echo "$key" ;;
    esac
  else
    case "$key" in
      title)             echo "OpenClaw Command Center — First-Run Setup" ;;
      copying)           echo "Installing files..." ;;
      password_prompt)   echo "Set access password (min 6 chars, empty for default: openclaw)" ;;
      password_confirm)  echo "Confirm password" ;;
      password_mismatch) echo "Passwords don't match, using default" ;;
      password_ok)       echo "Password set" ;;
      env_create)        echo "Creating configuration..." ;;
      layout_gen)        echo "Generating office layout..." ;;
      starting)          echo "Starting service..." ;;
      health_ok)         echo "Service is running" ;;
      health_fail)       echo "Service may still be starting" ;;
      done)              echo "Setup Complete!" ;;
      url)               echo "Access URL" ;;
      password_label)    echo "Password" ;;
      relaunch)          echo "Close this window and double-click the app icon to launch" ;;
      *)                 echo "$key" ;;
    esac
  fi
}

# Banner
echo ""
printf "${TEAL}${BOLD}"
cat << 'BANNER'
    ___                    ____ _
   / _ \ _ __   ___ _ __ / ___| | __ ___      __
  | | | | '_ \ / _ \ '_ \ |   | |/ _` \ \ /\ / /
  | |_| | |_) |  __/ | | | |___| | (_| |\ V  V /
   \___/| .__/ \___|_| |_|\____|_|\__,_| \_/\_/
        |_|
BANNER
printf "${NC}\n"

# Language selection
printf "  ${BOLD}Select Language / 请选择语言${NC}\n"
echo ""
printf "    ${TEAL}1)${NC} 中文\n"
printf "    ${TEAL}2)${NC} English\n"
echo ""
printf "  [1/2]: "
read -r lc
case "$lc" in
  2|en|EN) LANG_CODE="en" ;;
  *)       LANG_CODE="zh" ;;
esac

echo ""
printf "  ${DIM}%s${NC}\n" "$(t title)"
printf "  ${DIM}──────────────────────────────────────────────────${NC}\n"
echo ""

# Config
OPENCLAW_HOME="${HOME}/.openclaw"
CMD_DIR="${OPENCLAW_HOME}/workspace/command-center"
CMD_PORT="${CMD_PORT:-5100}"

# Copy app files
info "$(t copying)"
mkdir -p "$CMD_DIR"
if command -v rsync >/dev/null 2>&1; then
  rsync -a "$APP_DIR/" "$CMD_DIR/"
else
  cp -R "$APP_DIR/"* "$CMD_DIR/"
fi
log "$(t copying)"

# Password
echo ""
info "$(t password_prompt)"
printf "  > "
read -r -s pw1; echo ""
if [ -z "$pw1" ] || [ ${#pw1} -lt 6 ]; then
  pw1="openclaw"
else
  printf "  %s: " "$(t password_confirm)"
  read -r -s pw2; echo ""
  if [ "$pw1" != "$pw2" ]; then
    warn "$(t password_mismatch)"
    pw1="openclaw"
  fi
fi
printf '%s' "$pw1" > "$CMD_DIR/.auth_password"
log "$(t password_ok)"

# .env
info "$(t env_create)"
OC_TOKEN=""
if [ -f "${OPENCLAW_HOME}/openclaw.json" ]; then
  OC_TOKEN=$("${NODE}" -e "
    try {
      const c = JSON.parse(require('fs').readFileSync('${OPENCLAW_HOME}/openclaw.json','utf8'));
      console.log(c.authToken || c.token || (c.auth && c.auth.token) || (c.gateway && c.gateway.auth && c.gateway.auth.token) || '');
    } catch { console.log(''); }
  " 2>/dev/null || echo "")
fi

cat > "$CMD_DIR/.env" << ENVEOF
OPENCLAW_HOME=${OPENCLAW_HOME}
CMD_PORT=${CMD_PORT}
OPENCLAW_AUTH_TOKEN=${OC_TOKEN}
ENVEOF
log ".env"

# Layout
info "$(t layout_gen)"
"${NODE}" "$CMD_DIR/scripts/gen-layout.js" >/dev/null 2>&1 || true

# Start server
info "$(t starting)"
cd "$CMD_DIR"
"${NODE}" server/index.js &
SERVER_PID=$!

sleep 3
HEALTH=$(curl -s --max-time 5 "http://127.0.0.1:${CMD_PORT}/health" 2>/dev/null || echo "")
if echo "$HEALTH" | grep -q '"status":"ok"'; then
  log "$(t health_ok)"
else
  warn "$(t health_fail)"
fi

# Mark setup done
touch "${CMD_DIR}/.setup-done"

# Open browser
open "http://localhost:${CMD_PORT}/cmd/" 2>/dev/null || true

# Done
PASSWORD=$(cat "$CMD_DIR/.auth_password" 2>/dev/null || echo "openclaw")
echo ""
printf "  ${TEAL}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"
printf "  ${TEAL}${BOLD}  %s${NC}\n" "$(t done)"
printf "  ${TEAL}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"
echo ""
printf "  ${BOLD}%s:${NC}  ${GREEN}http://localhost:${CMD_PORT}/cmd/${NC}\n" "$(t url)"
printf "  ${BOLD}%s:${NC}  ${CYAN}${PASSWORD}${NC}\n" "$(t password_label)"
echo ""
printf "  ${DIM}%s${NC}\n" "$(t relaunch)"
echo ""

# Keep server running until user closes
wait $SERVER_PID 2>/dev/null || true
