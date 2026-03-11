#!/usr/bin/env bash
#
# ChaoClaw Command Center — macOS First-Run Setup
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
      title)             echo "ChaoClaw 指挥中心 — 首次设置" ;;
      copying)           echo "正在安装文件..." ;;
      password_prompt)   echo "设置访问密码（最少6位，留空使用默认: chaoclaw）" ;;
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
      oc_checking)       echo "检查 ChaoClaw..." ;;
      oc_found)          echo "ChaoClaw 已安装" ;;
      oc_not_found)      echo "未检测到 ChaoClaw" ;;
      oc_install_ask)    echo "是否安装 ChaoClaw？(需要它来驱动 AI 功能)" ;;
      oc_installing)     echo "正在安装 ChaoClaw..." ;;
      oc_install_ok)     echo "ChaoClaw 安装成功" ;;
      oc_install_fail)   echo "ChaoClaw 安装失败，请稍后手动安装: npm install -g openclaw" ;;
      oc_init)           echo "初始化 ChaoClaw..." ;;
      oc_gateway_start)  echo "启动 ChaoClaw Gateway..." ;;
      oc_gateway_ok)     echo "Gateway 已启动" ;;
      oc_gateway_fail)   echo "Gateway 启动失败（可稍后手动启动: openclaw gateway）" ;;
      oc_skip)           echo "跳过 ChaoClaw 安装（AI 功能将不可用）" ;;
      device_paired)     echo "设备已配对" ;;
      device_pair_fail)  echo "设备配对失败（可稍后手动配置）" ;;
      dept_created)      echo "部门配置已创建" ;;
      yes_no)            echo "[Y/n]" ;;
      *)                 echo "$key" ;;
    esac
  else
    case "$key" in
      title)             echo "ChaoClaw Command Center — First-Run Setup" ;;
      copying)           echo "Installing files..." ;;
      password_prompt)   echo "Set access password (min 6 chars, empty for default: chaoclaw)" ;;
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
      oc_checking)       echo "Checking ChaoClaw..." ;;
      oc_found)          echo "ChaoClaw installed" ;;
      oc_not_found)      echo "ChaoClaw not detected" ;;
      oc_install_ask)    echo "Install ChaoClaw? (required for AI features)" ;;
      oc_installing)     echo "Installing ChaoClaw..." ;;
      oc_install_ok)     echo "ChaoClaw installed successfully" ;;
      oc_install_fail)   echo "ChaoClaw install failed. Install manually later: npm install -g openclaw" ;;
      oc_init)           echo "Initializing ChaoClaw..." ;;
      oc_gateway_start)  echo "Starting ChaoClaw Gateway..." ;;
      oc_gateway_ok)     echo "Gateway started" ;;
      oc_gateway_fail)   echo "Gateway failed to start (run manually later: openclaw gateway)" ;;
      oc_skip)           echo "Skipping ChaoClaw install (AI features will be unavailable)" ;;
      device_paired)     echo "Device paired with Gateway" ;;
      device_pair_fail)  echo "Device pairing failed (configure manually later)" ;;
      dept_created)      echo "Department config created" ;;
      yes_no)            echo "[Y/n]" ;;
      *)                 echo "$key" ;;
    esac
  fi
}

# Banner
echo ""
printf "${TEAL}${BOLD}"
cat << 'BANNER'
    ____ _                  ____ _
   / ___| |__   __ _  ___ / ___| | __ ___      __
  | |   | '_ \ / _` |/ _ \ |   | |/ _` \ \ /\ / /
  | |___| | | | (_| | (_) | |___| | (_| |\ V  V /
   \____|_| |_|\__,_|\___/ \____|_|\__,_| \_/\_/
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

# ================================================================
# Step 1: Check & install ChaoClaw
# ================================================================
info "$(t oc_checking)"

OPENCLAW_BIN=""
HAS_OPENCLAW=false

# Check system PATH first, then bundled node's global
if command -v openclaw >/dev/null 2>&1; then
  OPENCLAW_BIN="$(command -v openclaw)"
  HAS_OPENCLAW=true
fi

if $HAS_OPENCLAW; then
  OC_VER=$("$OPENCLAW_BIN" --version 2>/dev/null || echo "unknown")
  log "$(t oc_found) (v${OC_VER})"
else
  warn "$(t oc_not_found)"
  echo ""
  printf "  ${BOLD}$(t oc_install_ask)${NC} $(t yes_no): "
  read -r install_oc
  case "$install_oc" in
    n|N|no|NO)
      warn "$(t oc_skip)"
      ;;
    *)
      info "$(t oc_installing)"
      # Use bundled node's npm to install globally
      NPM_DIR="$(dirname "$NODE")"
      if "$NODE" "${NPM_DIR}/../lib/node_modules/npm/bin/npm-cli.js" install -g openclaw 2>/dev/null; then
        log "$(t oc_install_ok)"
        HAS_OPENCLAW=true
        OPENCLAW_BIN="$(command -v openclaw 2>/dev/null || echo "")"
      else
        # Fallback: try system npm
        if command -v npm >/dev/null 2>&1; then
          if npm install -g openclaw 2>/dev/null; then
            log "$(t oc_install_ok)"
            HAS_OPENCLAW=true
            OPENCLAW_BIN="$(command -v openclaw 2>/dev/null || echo "")"
          else
            warn "$(t oc_install_fail)"
          fi
        else
          warn "$(t oc_install_fail)"
        fi
      fi
      ;;
  esac
fi

# Initialize ChaoClaw if freshly installed (no config exists)
if $HAS_OPENCLAW && [ -n "$OPENCLAW_BIN" ] && [ ! -f "${OPENCLAW_HOME}/openclaw.json" ]; then
  echo ""
  info "$(t oc_init)"
  "$OPENCLAW_BIN" init 2>/dev/null || "$OPENCLAW_BIN" doctor --fix 2>/dev/null || true
fi

# Start Gateway if ChaoClaw is available but Gateway isn't running
if $HAS_OPENCLAW && [ -n "$OPENCLAW_BIN" ]; then
  GATEWAY_RUNNING=false
  if curl -s --max-time 2 "http://127.0.0.1:18789" >/dev/null 2>&1; then
    GATEWAY_RUNNING=true
  fi

  if ! $GATEWAY_RUNNING; then
    echo ""
    info "$(t oc_gateway_start)"
    # Start Gateway in background
    nohup "$OPENCLAW_BIN" gateway >/dev/null 2>&1 &
    GATEWAY_PID=$!

    # Wait up to 10 seconds for Gateway to be ready
    i=0
    while [ $i -lt 20 ]; do
      if curl -s --max-time 1 "http://127.0.0.1:18789" >/dev/null 2>&1; then
        log "$(t oc_gateway_ok) (pid: $GATEWAY_PID)"
        GATEWAY_RUNNING=true
        break
      fi
      sleep 0.5
      i=$((i + 1))
    done

    if ! $GATEWAY_RUNNING; then
      warn "$(t oc_gateway_fail)"
    fi
  else
    log "$(t oc_gateway_ok)"
  fi
fi

echo ""

# ================================================================
# Step 1b: Auto-pair device + create departments config
# ================================================================

# Auto-pair command-center device so Gateway accepts our connection
if $HAS_OPENCLAW || [ -d "${OPENCLAW_HOME}" ]; then
  "${NODE}" "$APP_DIR/scripts/auto-pair.js" --openclaw-home "$OPENCLAW_HOME" 2>/dev/null && \
    log "$(t device_paired)" || warn "$(t device_pair_fail)"

  # Create default departments config if missing
  DEPT_CONFIG="${OPENCLAW_HOME}/workspace/departments/config.json"
  if [ ! -f "$DEPT_CONFIG" ]; then
    mkdir -p "$(dirname "$DEPT_CONFIG")"
    cat > "$DEPT_CONFIG" << 'DEPTEOF'
{
  "departments": {
    "general": {
      "name": "General",
      "agent": "Assistant",
      "icon": "bolt",
      "color": "#fbbf24",
      "hue": 45,
      "order": 0
    }
  },
  "defaultDepartment": "general",
  "groupId": ""
}
DEPTEOF
    mkdir -p "${OPENCLAW_HOME}/workspace/departments/general/memory"
    mkdir -p "${OPENCLAW_HOME}/workspace/departments/bulletin/requests"
    mkdir -p "${OPENCLAW_HOME}/workspace/departments/personas"
    log "$(t dept_created)"
  fi

  # Restart Gateway to pick up new paired device (if it was running)
  if $GATEWAY_RUNNING 2>/dev/null; then
    # Give Gateway a moment to restart with new paired.json
    if command -v openclaw >/dev/null 2>&1; then
      openclaw gateway restart >/dev/null 2>&1 || true
      sleep 2
    fi
  fi
fi

echo ""

# ================================================================
# Step 2: Copy app files
# ================================================================
info "$(t copying)"
mkdir -p "$CMD_DIR"
if command -v rsync >/dev/null 2>&1; then
  rsync -a "$APP_DIR/" "$CMD_DIR/"
else
  cp -R "$APP_DIR/"* "$CMD_DIR/"
fi
log "$(t copying)"

# ================================================================
# Step 3: Password
# ================================================================
echo ""
info "$(t password_prompt)"
printf "  > "
read -r -s pw1; echo ""
if [ -z "$pw1" ] || [ ${#pw1} -lt 6 ]; then
  pw1="chaoclaw"
else
  printf "  %s: " "$(t password_confirm)"
  read -r -s pw2; echo ""
  if [ "$pw1" != "$pw2" ]; then
    warn "$(t password_mismatch)"
    pw1="chaoclaw"
  fi
fi
"${NODE}" -e "
  const c = require('crypto');
  const s = c.randomBytes(16).toString('hex');
  const h = c.scryptSync(process.argv[1], s, 64).toString('hex');
  process.stdout.write(s + ':' + h);
" "$pw1" > "$CMD_DIR/.auth_password"
log "$(t password_ok)"

# ================================================================
# Step 4: .env
# ================================================================
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

# ================================================================
# Step 5: Layout
# ================================================================
info "$(t layout_gen)"
"${NODE}" "$CMD_DIR/scripts/gen-layout.js" >/dev/null 2>&1 || true

# ================================================================
# Step 6: Start server
# ================================================================
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

# ================================================================
# Done
# ================================================================
PASSWORD=$(cat "$CMD_DIR/.auth_password" 2>/dev/null || echo "chaoclaw")
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
