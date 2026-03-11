#!/usr/bin/env bash
#
# Build a self-extracting .run installer for ChaoClaw Command Center.
#
# Prerequisites: makeself, node >= 18, npm
# Usage:         bash scripts/build-package.sh
# Output:        openclaw-cmd-<version>.run
#

set -euo pipefail

# ============================================================
# Config
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
VERSION=$(node -e "console.log(require('${PROJECT_DIR}/package.json').version)")
ARCH=$(uname -m)
PKG_NAME="openclaw-cmd-${VERSION}-linux-${ARCH}"
WORK_DIR=$(mktemp -d)
STAGE_DIR="${WORK_DIR}/${PKG_NAME}"

trap 'rm -rf "$WORK_DIR"' EXIT

echo "============================================================"
echo " ChaoClaw Command Center — Package Builder"
echo "============================================================"
echo " Version:  ${VERSION}"
echo " Arch:     ${ARCH}"
echo " Output:   ${PKG_NAME}.run"
echo "============================================================"
echo ""

# ============================================================
# Step 1: Build frontend
# ============================================================

echo "[1/5] Building frontend..."
cd "$PROJECT_DIR"
npm run build --silent 2>&1 | tail -3
if [[ ! -f "${PROJECT_DIR}/dist/index.html" ]]; then
  echo "ERROR: Build failed — dist/index.html not found"
  exit 1
fi
echo "  OK"

# ============================================================
# Step 2: Stage files
# ============================================================

echo "[2/5] Staging files..."
mkdir -p "$STAGE_DIR"

# Copy server code
cp -r "$PROJECT_DIR/server" "$STAGE_DIR/server"

# Copy built frontend
cp -r "$PROJECT_DIR/dist" "$STAGE_DIR/dist"

# Copy scripts
mkdir -p "$STAGE_DIR/scripts"
cp "$PROJECT_DIR/scripts/gen-layout.js" "$STAGE_DIR/scripts/"
cp "$PROJECT_DIR/scripts/migrate-config.js" "$STAGE_DIR/scripts/"
[[ -f "$PROJECT_DIR/scripts/auto-pair.js" ]] && cp "$PROJECT_DIR/scripts/auto-pair.js" "$STAGE_DIR/scripts/"
[[ -f "$PROJECT_DIR/scripts/deploy.sh" ]] && cp "$PROJECT_DIR/scripts/deploy.sh" "$STAGE_DIR/scripts/"

# Copy package files
cp "$PROJECT_DIR/package.json" "$STAGE_DIR/"
[[ -f "$PROJECT_DIR/package-lock.json" ]] && cp "$PROJECT_DIR/package-lock.json" "$STAGE_DIR/"

# Copy ecosystem config
cp "$PROJECT_DIR/ecosystem.config.cjs" "$STAGE_DIR/"

echo "  OK"

# ============================================================
# Step 3: Install production dependencies
# ============================================================

echo "[3/5] Installing production dependencies..."
cd "$STAGE_DIR"
npm ci --omit=dev --silent 2>&1 | tail -3 || npm install --omit=dev --silent 2>&1 | tail -3
echo "  OK ($(du -sh node_modules | cut -f1))"

# ============================================================
# Step 4: Create setup script (runs after extraction)
# ============================================================

echo "[4/5] Creating setup script..."

cat > "$STAGE_DIR/setup.sh" << 'SETUP_EOF'
#!/usr/bin/env bash
#
# ChaoClaw Command Center — Post-extraction setup
# This runs automatically after the .run file self-extracts.
#

set -euo pipefail

# Colors
if [[ -t 1 ]] && [[ "${TERM:-}" != "dumb" ]]; then
  GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'
  CYAN='\033[0;36m'; TEAL='\033[38;5;43m'; BOLD='\033[1m'
  DIM='\033[2m'; NC='\033[0m'
else
  GREEN='' YELLOW='' RED='' CYAN='' TEAL='' BOLD='' DIM='' NC=''
fi

log()  { echo -e "  ${GREEN}[OK]${NC} $1"; }
warn() { echo -e "  ${YELLOW}[!!]${NC} $1"; }
err()  { echo -e "  ${RED}[XX]${NC} $1"; }
info() { echo -e "  ${CYAN}[ii]${NC} $1"; }

# ── i18n ──
declare -A MSG_ZH MSG_EN
LANG_CODE="${LANG_CODE:-}"

MSG_ZH=(
  [title]="ChaoClaw 指挥中心安装程序"
  [lang_select]="请选择语言 / Select Language"
  [checking]="检查环境..."
  [node_missing]="未找到 Node.js >= 18，请先安装"
  [pm2_missing]="正在安装 pm2..."
  [copying]="正在复制文件..."
  [password_prompt]="设置访问密码（最少6位，留空使用默认: chaoclaw）"
  [password_confirm]="确认密码"
  [password_mismatch]="两次密码不一致，使用默认密码"
  [password_ok]="密码已设置"
  [password_keep]="保留已有密码"
  [env_create]="创建 .env 配置"
  [layout_gen]="生成办公室布局..."
  [pm2_start]="启动服务..."
  [pm2_ok]="服务已启动"
  [health_ok]="服务运行正常"
  [health_fail]="服务可能仍在启动中"
  [done]="安装完成！"
  [url]="访问地址"
  [password_label]="密码"
  [commands]="常用命令"
)
MSG_EN=(
  [title]="ChaoClaw Command Center Installer"
  [lang_select]="Select Language / 请选择语言"
  [checking]="Checking environment..."
  [node_missing]="Node.js >= 18 not found, please install first"
  [pm2_missing]="Installing pm2..."
  [copying]="Copying files..."
  [password_prompt]="Set access password (min 6 chars, empty for default: chaoclaw)"
  [password_confirm]="Confirm password"
  [password_mismatch]="Passwords don't match, using default"
  [password_ok]="Password set"
  [password_keep]="Keeping existing password"
  [env_create]="Creating .env config"
  [layout_gen]="Generating office layout..."
  [pm2_start]="Starting service..."
  [pm2_ok]="Service started"
  [health_ok]="Service is running"
  [health_fail]="Service may still be starting"
  [done]="Installation Complete!"
  [url]="Access URL"
  [password_label]="Password"
  [commands]="Useful Commands"
)

t() {
  local key="$1"
  if [[ "$LANG_CODE" == "zh" ]]; then
    echo "${MSG_ZH[$key]:-$key}"
  else
    echo "${MSG_EN[$key]:-$key}"
  fi
}

# ── Language selection ──
select_lang() {
  echo ""
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
}

# ── Config ──
OPENCLAW_HOME="${OPENCLAW_HOME:-$HOME/.openclaw}"
CMD_DIR="${OPENCLAW_HOME}/workspace/command-center"
CMD_PORT="${CMD_PORT:-5100}"
PM2_NAME="openclaw-cmd"
EXTRACT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Banner ──
echo ""
echo -e "${TEAL}${BOLD}"
cat << 'BANNER'
    ____ _                  ____ _
   / ___| |__   __ _  ___ / ___| | __ ___      __
  | |   | '_ \ / _` |/ _ \ |   | |/ _` \ \ /\ / /
  | |___| | | | (_| | (_) | |___| | (_| |\ V  V /
   \____|_| |_|\__,_|\___/ \____|_|\__,_| \_/\_/
BANNER
echo -e "${NC}"

# ── Language ──
if [[ -z "$LANG_CODE" ]]; then
  select_lang
fi

echo -e "  ${DIM}$(t title)${NC}"
echo -e "  ${DIM}$(printf '%.0s─' {1..50})${NC}"
echo ""

# ── Step 1: Check Node.js ──
info "$(t checking)"
if ! command -v node &>/dev/null; then
  err "$(t node_missing)"
  echo -e "  ${DIM}curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -${NC}"
  echo -e "  ${DIM}sudo apt-get install -y nodejs${NC}"
  exit 1
fi
NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
if [[ "$NODE_VER" -lt 18 ]]; then
  err "$(t node_missing) (found v$(node -v))"
  exit 1
fi
log "Node.js $(node -v)"

# pm2
if ! command -v pm2 &>/dev/null; then
  info "$(t pm2_missing)"
  npm install -g pm2 &>/dev/null
fi
log "pm2 $(pm2 -v 2>/dev/null || echo '?')"

# ── Step 2: Copy files ──
info "$(t copying)"
mkdir -p "$CMD_DIR"

# Use rsync if available, otherwise cp
if command -v rsync &>/dev/null; then
  rsync -a --delete \
    --exclude='.auth_password' \
    --exclude='.env' \
    --exclude='setup.sh' \
    "$EXTRACT_DIR/" "$CMD_DIR/"
else
  # Preserve existing auth/env
  local_auth="" local_env=""
  [[ -f "$CMD_DIR/.auth_password" ]] && local_auth=$(cat "$CMD_DIR/.auth_password")
  [[ -f "$CMD_DIR/.env" ]] && local_env=$(cat "$CMD_DIR/.env")

  rm -rf "$CMD_DIR/server" "$CMD_DIR/dist" "$CMD_DIR/node_modules" "$CMD_DIR/scripts"
  cp -r "$EXTRACT_DIR/server" "$CMD_DIR/server"
  cp -r "$EXTRACT_DIR/dist" "$CMD_DIR/dist"
  cp -r "$EXTRACT_DIR/node_modules" "$CMD_DIR/node_modules"
  cp -r "$EXTRACT_DIR/scripts" "$CMD_DIR/scripts"
  cp "$EXTRACT_DIR/package.json" "$CMD_DIR/"
  [[ -f "$EXTRACT_DIR/package-lock.json" ]] && cp "$EXTRACT_DIR/package-lock.json" "$CMD_DIR/"
  cp "$EXTRACT_DIR/ecosystem.config.cjs" "$CMD_DIR/"

  [[ -n "$local_auth" ]] && printf '%s' "$local_auth" > "$CMD_DIR/.auth_password"
  [[ -n "$local_env" ]] && printf '%s' "$local_env" > "$CMD_DIR/.env"
fi
log "$(t copying) → $CMD_DIR"

# ── Step 3: Password ──
if [[ -f "$CMD_DIR/.auth_password" ]]; then
  log "$(t password_keep)"
else
  echo ""
  info "$(t password_prompt)"
  echo -ne "  > "
  read -r -s pw1; echo ""
  if [[ -z "$pw1" ]] || [[ ${#pw1} -lt 6 ]]; then
    pw1="chaoclaw"
  else
    echo -ne "  $(t password_confirm): "
    read -r -s pw2; echo ""
    if [[ "$pw1" != "$pw2" ]]; then
      warn "$(t password_mismatch)"
      pw1="chaoclaw"
    fi
  fi
  PLAIN_PW="$pw1"
  # Hash with scrypt
  node -e "
    const c = require('crypto');
    const s = c.randomBytes(16).toString('hex');
    const h = c.scryptSync(process.argv[1], s, 64).toString('hex');
    process.stdout.write(s + ':' + h);
  " "$pw1" > "$CMD_DIR/.auth_password"
  log "$(t password_ok)"
fi

# ── Step 4: .env ──
info "$(t env_create)"
# Extract auth token from ChaoClaw config
OC_TOKEN=""
if [[ -f "${OPENCLAW_HOME}/openclaw.json" ]]; then
  OC_TOKEN=$(node -e "
    try {
      const c = require('${OPENCLAW_HOME}/openclaw.json');
      console.log(c.authToken || c.token || (c.auth && c.auth.token) || (c.gateway && c.gateway.auth && c.gateway.auth.token) || '');
    } catch { console.log(''); }
  " 2>/dev/null || echo "")
fi

if [[ ! -f "$CMD_DIR/.env" ]]; then
  cat > "$CMD_DIR/.env" << ENVEOF
OPENCLAW_HOME=${OPENCLAW_HOME}
CMD_PORT=${CMD_PORT}
OPENCLAW_AUTH_TOKEN=${OC_TOKEN}
ENVEOF
fi
log ".env"

# ── Step 5: Layout ──
info "$(t layout_gen)"
node "$CMD_DIR/scripts/gen-layout.js" &>/dev/null || true

# ── Step 6: PM2 start ──
info "$(t pm2_start)"
cd "$CMD_DIR"
pm2 delete "$PM2_NAME" 2>/dev/null || true
pm2 start ecosystem.config.cjs &>/dev/null || pm2 start server/index.js --name "$PM2_NAME" &>/dev/null
pm2 save &>/dev/null || true
log "$(t pm2_ok)"

# ── Step 7: Health check ──
sleep 3
HEALTH=$(curl -s --max-time 5 "http://127.0.0.1:${CMD_PORT}/health" 2>/dev/null || echo "")
if echo "$HEALTH" | grep -q '"status":"ok"'; then
  log "$(t health_ok)"
else
  warn "$(t health_fail)"
fi

# ── Done ──
PASSWORD="${PLAIN_PW:-chaoclaw}"
echo ""
echo -e "  ${TEAL}${BOLD}$(printf '%.0s━' {1..50})${NC}"
echo -e "  ${TEAL}${BOLD}  $(t done)${NC}"
echo -e "  ${TEAL}${BOLD}$(printf '%.0s━' {1..50})${NC}"
echo ""
echo -e "  ${BOLD}$(t url):${NC}  ${GREEN}http://localhost:${CMD_PORT}/cmd/${NC}"
echo -e "  ${BOLD}$(t password_label):${NC}  ${CYAN}${PASSWORD}${NC}"
echo ""
echo -e "  ${BOLD}$(t commands):${NC}"
echo -e "    pm2 logs ${PM2_NAME}"
echo -e "    pm2 restart ${PM2_NAME}"
echo -e "    pm2 stop ${PM2_NAME}"
echo ""
echo -e "  ${TEAL}${BOLD}$(printf '%.0s━' {1..50})${NC}"
echo ""
SETUP_EOF

chmod +x "$STAGE_DIR/setup.sh"
echo "  OK"

# ============================================================
# Step 5: Package with makeself
# ============================================================

echo "[5/5] Creating self-extracting archive..."

cd "$WORK_DIR"

if ! command -v makeself &>/dev/null; then
  echo "ERROR: makeself not found. Install: apt install makeself"
  exit 1
fi

makeself \
  --gzip \
  --nox11 \
  "$STAGE_DIR" \
  "${PROJECT_DIR}/${PKG_NAME}.run" \
  "ChaoClaw Command Center v${VERSION}" \
  "./setup.sh"

echo ""
echo "============================================================"
echo " Package ready!"
echo "============================================================"
echo ""
echo " File:  ${PKG_NAME}.run"
echo " Size:  $(du -h "${PROJECT_DIR}/${PKG_NAME}.run" | cut -f1)"
echo ""
echo " Install on target machine:"
echo "   chmod +x ${PKG_NAME}.run"
echo "   ./${PKG_NAME}.run"
echo ""
echo " Or with language preset:"
echo "   LANG_CODE=en ./${PKG_NAME}.run"
echo "   LANG_CODE=zh ./${PKG_NAME}.run"
echo ""
echo "============================================================"
