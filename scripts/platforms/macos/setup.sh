#!/usr/bin/env bash
#
# OpenClaw Command Center — macOS First-Run Setup
# Runs in Terminal on first launch.
#

set -euo pipefail

# Colors
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'
CYAN='\033[0;36m'; TEAL='\033[38;5;43m'; BOLD='\033[1m'
DIM='\033[2m'; NC='\033[0m'

log()  { echo -e "  ${GREEN}[OK]${NC} $1"; }
warn() { echo -e "  ${YELLOW}[!!]${NC} $1"; }
err()  { echo -e "  ${RED}[XX]${NC} $1"; exit 1; }
info() { echo -e "  ${CYAN}[ii]${NC} $1"; }

# Detect where we are (inside .app bundle or standalone)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "${SCRIPT_DIR}/node" ]]; then
  # Running from Resources/ inside .app
  RESOURCES="${SCRIPT_DIR}"
  NODE="${RESOURCES}/node"
  APP_DIR="${RESOURCES}/app"
else
  err "Cannot find bundled Node.js binary"
fi

# i18n
declare -A MSG_ZH MSG_EN
MSG_ZH=(
  [title]="OpenClaw 指挥中心 — 首次设置"
  [lang_select]="请选择语言 / Select Language"
  [copying]="正在安装文件..."
  [password_prompt]="设置访问密码（最少6位，留空使用默认: openclaw）"
  [password_confirm]="确认密码"
  [password_mismatch]="两次密码不一致，使用默认密码"
  [password_ok]="密码已设置"
  [env_create]="创建配置文件..."
  [layout_gen]="生成办公室布局..."
  [starting]="启动服务..."
  [health_ok]="服务运行正常"
  [health_fail]="服务可能仍在启动中"
  [done]="安装完成！"
  [url]="访问地址"
  [password_label]="密码"
  [relaunch]="请关闭此窗口，然后重新双击应用图标启动"
)
MSG_EN=(
  [title]="OpenClaw Command Center — First-Run Setup"
  [lang_select]="Select Language / 请选择语言"
  [copying]="Installing files..."
  [password_prompt]="Set access password (min 6 chars, empty for default: openclaw)"
  [password_confirm]="Confirm password"
  [password_mismatch]="Passwords don't match, using default"
  [password_ok]="Password set"
  [env_create]="Creating configuration..."
  [layout_gen]="Generating office layout..."
  [starting]="Starting service..."
  [health_ok]="Service is running"
  [health_fail]="Service may still be starting"
  [done]="Setup Complete!"
  [url]="Access URL"
  [password_label]="Password"
  [relaunch]="Close this window and double-click the app icon to launch"
)

LANG_CODE=""
t() {
  local key="$1"
  if [[ "$LANG_CODE" == "zh" ]]; then echo "${MSG_ZH[$key]:-$key}"; else echo "${MSG_EN[$key]:-$key}"; fi
}

# Banner
echo ""
echo -e "${TEAL}${BOLD}"
cat << 'BANNER'
    ___                    ____ _
   / _ \ _ __   ___ _ __ / ___| | __ ___      __
  | | | | '_ \ / _ \ '_ \ |   | |/ _` \ \ /\ / /
  | |_| | |_) |  __/ | | | |___| | (_| |\ V  V /
   \___/| .__/ \___|_| |_|\____|_|\__,_| \_/\_/
        |_|
BANNER
echo -e "${NC}"

# Language selection
echo -e "  ${BOLD}Select Language / 请选择语言${NC}"
echo ""
echo -e "    ${TEAL}1)${NC} 中文"
echo -e "    ${TEAL}2)${NC} English"
echo ""
echo -ne "  [1/2]: "
read -r lc
case "$lc" in
  2|en|EN) LANG_CODE="en" ;;
  *)       LANG_CODE="zh" ;;
esac

echo ""
echo -e "  ${DIM}$(t title)${NC}"
echo -e "  ${DIM}$(printf '%.0s─' {1..50})${NC}"
echo ""

# Config
OPENCLAW_HOME="${HOME}/.openclaw"
CMD_DIR="${OPENCLAW_HOME}/workspace/command-center"
CMD_PORT="${CMD_PORT:-5100}"

# Copy app files
info "$(t copying)"
mkdir -p "$CMD_DIR"
rsync -a "$APP_DIR/" "$CMD_DIR/" 2>/dev/null || cp -R "$APP_DIR/"* "$CMD_DIR/"
log "$(t copying)"

# Password
echo ""
info "$(t password_prompt)"
echo -ne "  > "
read -r -s pw1; echo ""
if [[ -z "$pw1" ]] || [[ ${#pw1} -lt 6 ]]; then
  pw1="openclaw"
else
  echo -ne "  $(t password_confirm): "
  read -r -s pw2; echo ""
  if [[ "$pw1" != "$pw2" ]]; then
    warn "$(t password_mismatch)"
    pw1="openclaw"
  fi
fi
printf '%s' "$pw1" > "$CMD_DIR/.auth_password"
log "$(t password_ok)"

# .env
info "$(t env_create)"
OC_TOKEN=""
if [[ -f "${OPENCLAW_HOME}/openclaw.json" ]]; then
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
"${NODE}" "$CMD_DIR/scripts/gen-layout.js" &>/dev/null || true

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
echo -e "  ${TEAL}${BOLD}$(printf '%.0s━' {1..50})${NC}"
echo -e "  ${TEAL}${BOLD}  $(t done)${NC}"
echo -e "  ${TEAL}${BOLD}$(printf '%.0s━' {1..50})${NC}"
echo ""
echo -e "  ${BOLD}$(t url):${NC}  ${GREEN}http://localhost:${CMD_PORT}/cmd/${NC}"
echo -e "  ${BOLD}$(t password_label):${NC}  ${CYAN}${PASSWORD}${NC}"
echo ""
echo -e "  ${DIM}$(t relaunch)${NC}"
echo ""

# Keep server running until user closes
wait $SERVER_PID 2>/dev/null || true
