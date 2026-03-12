#!/usr/bin/env bash
#
# OpenClaw Command Center — Interactive Installer
# https://github.com/openclaw
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/openclaw/command-center/main/install.sh | bash
#   # or
#   git clone ... && cd command-center && bash install.sh
#
# Supports: beginner mode (install OpenClaw + Command Center)
#           existing user mode (Command Center only)
#
# Flags (for automation / non-interactive):
#   --non-interactive    Skip all prompts, use defaults or flags
#   --port=N             Set CMD_PORT (default: 5100)
#   --password=X         Set access password (min 6 chars)
#   --mode=beginner|existing  Install mode
#   --lang=zh|en         Language
#

set -euo pipefail

# ── Bash 4+ check (needed for declare -A) ──
if [[ "${BASH_VERSINFO[0]:-0}" -lt 4 ]]; then
  echo "ERROR: bash 4+ is required (found bash ${BASH_VERSION:-unknown})." >&2
  echo "On macOS: brew install bash" >&2
  exit 1
fi

# ── Install lockfile ──
INSTALL_LOCK="/tmp/openclaw-cmd-install.lock"
cleanup() {
  rm -f "$INSTALL_LOCK"
}
trap cleanup EXIT INT TERM

if [[ -f "$INSTALL_LOCK" ]]; then
  local_pid=$(cat "$INSTALL_LOCK" 2>/dev/null || echo "")
  if [[ -n "$local_pid" ]] && kill -0 "$local_pid" 2>/dev/null; then
    echo "ERROR: Another install is already running (PID $local_pid)." >&2
    exit 1
  fi
  # Stale lockfile, remove it
  rm -f "$INSTALL_LOCK"
fi
echo $$ > "$INSTALL_LOCK"

# ============================================================
# CLI Flags
# ============================================================

NON_INTERACTIVE=0
ARG_PORT=""
ARG_PASSWORD=""
ARG_MODE=""
ARG_LANG=""

for arg in "$@"; do
  case "$arg" in
    --non-interactive) NON_INTERACTIVE=1 ;;
    --port=*)          ARG_PORT="${arg#*=}" ;;
    --password=*)      ARG_PASSWORD="${arg#*=}" ;;
    --mode=*)          ARG_MODE="${arg#*=}" ;;
    --lang=*)          ARG_LANG="${arg#*=}" ;;
  esac
done

# ============================================================
# Constants
# ============================================================

VERSION="2.1.0"
OPENCLAW_HOME="${OPENCLAW_HOME:-$HOME/.openclaw}"
CMD_DIR="${OPENCLAW_HOME}/workspace/command-center"
CMD_PORT="${ARG_PORT:-${CMD_PORT:-5100}}"
PM2_NAME="openclaw-cmd"
NODE_MIN=18
GATEWAY_HEALTH_RETRIES=15
GATEWAY_HEALTH_INTERVAL=2
# Variable to hold plain-text password for summary display only
INSTALL_PASSWORD=""

# ============================================================
# Color System — teal accent #00d4aa
# ============================================================

if [[ -t 1 ]] && [[ "${TERM:-}" != "dumb" ]]; then
  RED='\033[0;31m'
  GREEN='\033[0;32m'
  YELLOW='\033[1;33m'
  CYAN='\033[0;36m'
  TEAL='\033[38;5;43m'
  BOLD='\033[1m'
  DIM='\033[2m'
  NC='\033[0m'
  RED_BG='\033[41;97m'
  GREEN_BG='\033[42;30m'
  CYAN_BG='\033[46;30m'
else
  RED='' GREEN='' YELLOW='' CYAN='' TEAL='' BOLD='' DIM='' NC=''
  RED_BG='' GREEN_BG='' CYAN_BG=''
fi

# ============================================================
# i18n System
# ============================================================

declare -A MSG_ZH MSG_EN
LANG_CODE="en"

# --- Chinese ---
MSG_ZH=(
  [lang_select]="请选择语言 / Select Language"
  [lang_zh]="中文"
  [lang_en]="English"
  [mode_select]="请选择安装模式"
  [mode_beginner]="小白模式 — 从零开始安装"
  [mode_beginner_desc]="安装 OpenClaw + 配置模型 + 启动 Gateway + 安装指挥中心"
  [mode_existing]="已安装模式 — 仅安装指挥中心"
  [mode_existing_desc]="已有 OpenClaw，只需要安装 Command Center"
  [step_prefix]="步骤"
  [step_of]="/"
  [step_done]="完成"
  [step_skip]="已跳过"
  [step_fail]="失败"
  [retry_prompt]="操作失败。[r]重试 [s]跳过 [a]中止"
  [retry_r]="重试中..."
  [retry_abort]="[r]重试 [a]中止"
  [skip_prompt]="按 s 跳过此步骤，按回车继续"
  [abort_msg]="安装已中止。"
  [prereqs]="检查系统依赖"
  [prereqs_node]="检查 Node.js"
  [prereqs_npm]="检查 npm"
  [prereqs_git]="检查 git"
  [prereqs_pm2]="检查 pm2"
  [node_not_found]="未找到 Node.js >= ${NODE_MIN}。请先安装："
  [node_old]="Node.js 版本过低 (需要 >= ${NODE_MIN}，当前"
  [npm_not_found]="未找到 npm，请安装 Node.js"
  [pm2_installing]="pm2 未找到，正在全局安装..."
  [warn_overwrite]="覆盖警告"
  [warn_overwrite_msg]="检测到已有 OpenClaw 安装！"
  [warn_overwrite_path]="路径"
  [warn_overwrite_confirm]="继续将重新配置 OpenClaw。输入 YES 确认（大写）"
  [warn_overwrite_abort]="未确认，安装中止。"
  [install_openclaw]="安装 OpenClaw"
  [install_openclaw_run]="正在全局安装 openclaw..."
  [install_openclaw_ok]="OpenClaw 已安装"
  [setup_wizard]="OpenClaw 初始化向导"
  [setup_wizard_run]="启动 openclaw setup --wizard..."
  [setup_wizard_note]="请在下方交互界面完成配置"
  [configure_model]="配置模型"
  [configure_model_run]="启动 openclaw configure --section model..."
  [configure_gateway]="配置 Gateway"
  [configure_gateway_run]="启动 openclaw configure --section gateway..."
  [start_gateway]="启动 Gateway"
  [start_gateway_run]="正在安装并启动 Gateway 服务..."
  [start_gateway_fallback]="常规方式失败，尝试前台启动..."
  [verify_gateway]="验证 Gateway"
  [verify_gateway_run]="正在检查 Gateway 健康状态..."
  [verify_gateway_ok]="Gateway 运行正常"
  [verify_gateway_fail]="Gateway 未响应（重试 %d/%d）"
  [verify_gateway_dead]="Gateway 启动失败。请手动检查：openclaw gateway health"
  [check_openclaw]="检查 OpenClaw"
  [check_openclaw_ok]="OpenClaw 配置已找到"
  [check_openclaw_token]="认证 Token 已提取"
  [check_openclaw_no_token]="未找到认证 Token（某些功能可能受限）"
  [check_openclaw_fail]="未找到 OpenClaw 配置文件：%s"
  [install_deps]="安装依赖"
  [install_deps_clone]="正在克隆仓库..."
  [install_deps_update]="正在更新代码..."
  [install_deps_npm]="正在安装 npm 依赖..."
  [install_deps_npm_fail]="npm install 失败"
  [npm_mirror_hint]="提示：如果网络较慢，可尝试使用国内镜像："
  [npm_mirror_cmd]="npm config set registry https://registry.npmmirror.com"
  [configure]="配置 Command Center"
  [configure_password]="设置访问密码（最少6位）"
  [configure_password_default]="留空使用默认密码: openclaw"
  [configure_password_confirm]="再次输入确认密码"
  [configure_password_mismatch]="两次输入不一致，请重试"
  [configure_password_short]="密码太短（至少6位），使用默认密码: openclaw"
  [configure_password_ok]="密码已设置"
  [configure_password_keep]="保留已有密码"
  [configure_env]="生成 .env 配置"
  [configure_env_ok]=".env 已创建"
  [configure_env_keep]=".env 已存在，保留"
  [configure_dept]="配置部门"
  [configure_dept_migrate]="检测到旧格式，正在迁移..."
  [configure_dept_migrate_fail]="迁移失败"
  [configure_dept_create]="创建默认部门配置..."
  [configure_dept_ok]="部门配置完成"
  [build_start]="构建并启动"
  [build_run]="正在构建前端..."
  [build_fail]="构建失败 — dist/index.html 未生成"
  [build_layout]="正在生成办公室布局..."
  [build_pm2_port]="端口 %d 已被占用！"
  [build_pm2_port_hint]="设置 CMD_PORT 环境变量使用其他端口"
  [build_pm2_start]="正在启动 PM2 服务..."
  [build_pm2_ok]="服务已启动"
  [nginx_setup]="配置 Nginx"
  [nginx_not_found]="未检测到 nginx，跳过"
  [nginx_exists]="Nginx /cmd/ 配置已存在"
  [nginx_adding]="正在添加反向代理配置..."
  [nginx_ok]="Nginx 配置完成并已重载"
  [nginx_fail]="Nginx 配置测试失败，请手动检查"
  [health_check]="最终验证"
  [health_run]="正在检查服务状态..."
  [health_ok]="服务运行正常"
  [health_fail]="健康检查失败 — 服务可能仍在启动中"
  [health_hint]="查看日志：pm2 logs openclaw-cmd"
  [health_gw_ok]="Gateway: 已连接"
  [health_gw_fail]="Gateway: %s"
  [done_title]="安装完成！"
  [done_url]="访问地址"
  [done_password]="访问密码"
  [done_commands]="常用命令"
  [done_cmd_logs]="查看日志"
  [done_cmd_restart]="重启服务"
  [done_cmd_stop]="停止服务"
  [done_cmd_deploy]="快速部署"
  [done_cmd_password]="修改密码"
  [root_warn]="您正在以 root 用户运行安装程序"
  [root_warn_hint]="建议使用普通用户安装。按回车继续..."
  [spinner_ok]="完成"
  [spinner_fail]="失败"
  [banner_subtitle]="指挥中心交互式安装程序"
  [git_not_found]="未找到 git（可选）"
  [git_clone_fail]="git clone 失败"
  [git_pull_fail]="git pull 失败，使用现有代码"
  [pkg_not_found]="未找到 package.json：%s"
  [layout_fail]="布局生成失败（使用默认）"
  [install_hint]="请先安装 OpenClaw："
  [gw_not_running]="Gateway 未运行。启动命令："
  [openclaw_not_found]="未找到 openclaw CLI，无法验证 Gateway"
  [nginx_conf_not_found]="未找到 Nginx 标准配置文件"
  [nginx_no_inject]="未找到 Nginx 配置注入点"
  [mode_label]="模式"
)

# --- English ---
MSG_EN=(
  [lang_select]="Select Language / 请选择语言"
  [lang_zh]="中文"
  [lang_en]="English"
  [mode_select]="Select Installation Mode"
  [mode_beginner]="Beginner — Full Setup from Scratch"
  [mode_beginner_desc]="Install OpenClaw + configure model + start Gateway + install Command Center"
  [mode_existing]="Existing User — Command Center Only"
  [mode_existing_desc]="OpenClaw already installed, just need Command Center"
  [step_prefix]="Step"
  [step_of]="/"
  [step_done]="Done"
  [step_skip]="Skipped"
  [step_fail]="Failed"
  [retry_prompt]="Operation failed. [r]etry [s]kip [a]bort"
  [retry_r]="Retrying..."
  [retry_abort]="[r]etry [a]bort"
  [skip_prompt]="Press 's' to skip, Enter to continue"
  [abort_msg]="Installation aborted."
  [prereqs]="Check Prerequisites"
  [prereqs_node]="Checking Node.js"
  [prereqs_npm]="Checking npm"
  [prereqs_git]="Checking git"
  [prereqs_pm2]="Checking pm2"
  [node_not_found]="Node.js >= ${NODE_MIN} not found. Please install:"
  [node_old]="Node.js too old (need >= ${NODE_MIN}, found"
  [npm_not_found]="npm not found. Please install Node.js"
  [pm2_installing]="pm2 not found, installing globally..."
  [warn_overwrite]="Overwrite Warning"
  [warn_overwrite_msg]="Existing OpenClaw installation detected!"
  [warn_overwrite_path]="Path"
  [warn_overwrite_confirm]="Continuing will reconfigure OpenClaw. Type YES to confirm"
  [warn_overwrite_abort]="Not confirmed. Installation aborted."
  [install_openclaw]="Install OpenClaw"
  [install_openclaw_run]="Installing openclaw globally..."
  [install_openclaw_ok]="OpenClaw installed"
  [setup_wizard]="OpenClaw Setup Wizard"
  [setup_wizard_run]="Starting openclaw setup --wizard..."
  [setup_wizard_note]="Please complete the setup in the interactive prompt below"
  [configure_model]="Configure Model"
  [configure_model_run]="Starting openclaw configure --section model..."
  [configure_gateway]="Configure Gateway"
  [configure_gateway_run]="Starting openclaw configure --section gateway..."
  [start_gateway]="Start Gateway"
  [start_gateway_run]="Installing and starting Gateway service..."
  [start_gateway_fallback]="Normal start failed, trying foreground mode..."
  [verify_gateway]="Verify Gateway"
  [verify_gateway_run]="Checking Gateway health..."
  [verify_gateway_ok]="Gateway is running"
  [verify_gateway_fail]="Gateway not responding (retry %d/%d)"
  [verify_gateway_dead]="Gateway failed to start. Check manually: openclaw gateway health"
  [check_openclaw]="Check OpenClaw"
  [check_openclaw_ok]="OpenClaw configuration found"
  [check_openclaw_token]="Auth token extracted"
  [check_openclaw_no_token]="No auth token found (some features may be limited)"
  [check_openclaw_fail]="OpenClaw config not found: %s"
  [install_deps]="Install Dependencies"
  [install_deps_clone]="Cloning repository..."
  [install_deps_update]="Updating code..."
  [install_deps_npm]="Installing npm dependencies..."
  [install_deps_npm_fail]="npm install failed"
  [npm_mirror_hint]="Hint: If network is slow, try Chinese npm mirror:"
  [npm_mirror_cmd]="npm config set registry https://registry.npmmirror.com"
  [configure]="Configure Command Center"
  [configure_password]="Set access password (min 6 chars)"
  [configure_password_default]="Leave empty for default: openclaw"
  [configure_password_confirm]="Confirm password"
  [configure_password_mismatch]="Passwords don't match, try again"
  [configure_password_short]="Password too short (min 6), using default: openclaw"
  [configure_password_ok]="Password set"
  [configure_password_keep]="Keeping existing password"
  [configure_env]="Generating .env config"
  [configure_env_ok]=".env created"
  [configure_env_keep]=".env already exists, keeping"
  [configure_dept]="Configuring departments"
  [configure_dept_migrate]="Old format detected, migrating..."
  [configure_dept_migrate_fail]="Migration failed"
  [configure_dept_create]="Creating default department config..."
  [configure_dept_ok]="Department config ready"
  [build_start]="Build & Start"
  [build_run]="Building frontend..."
  [build_fail]="Build failed — dist/index.html not found"
  [build_layout]="Generating office layout..."
  [build_pm2_port]="Port %d is already in use!"
  [build_pm2_port_hint]="Set CMD_PORT env variable to use a different port"
  [build_pm2_start]="Starting PM2 service..."
  [build_pm2_ok]="Service started"
  [nginx_setup]="Configure Nginx"
  [nginx_not_found]="nginx not detected, skipping"
  [nginx_exists]="Nginx /cmd/ config already exists"
  [nginx_adding]="Adding reverse proxy config..."
  [nginx_ok]="Nginx configured and reloaded"
  [nginx_fail]="Nginx config test failed, please check manually"
  [health_check]="Final Verification"
  [health_run]="Checking service status..."
  [health_ok]="Service is running"
  [health_fail]="Health check failed — service may still be starting"
  [health_hint]="Check logs: pm2 logs openclaw-cmd"
  [health_gw_ok]="Gateway: connected"
  [health_gw_fail]="Gateway: %s"
  [done_title]="Installation Complete!"
  [done_url]="Access URL"
  [done_password]="Password"
  [done_commands]="Useful Commands"
  [done_cmd_logs]="View logs"
  [done_cmd_restart]="Restart service"
  [done_cmd_stop]="Stop service"
  [done_cmd_deploy]="Quick deploy"
  [done_cmd_password]="Change password"
  [root_warn]="Running as root user"
  [root_warn_hint]="Consider installing as a regular user. Press Enter to continue..."
  [spinner_ok]="OK"
  [spinner_fail]="FAIL"
  [banner_subtitle]="Command Center Interactive Installer"
  [git_not_found]="git not found (optional)"
  [git_clone_fail]="git clone failed"
  [git_pull_fail]="git pull failed, using existing code"
  [pkg_not_found]="package.json not found: %s"
  [layout_fail]="Layout generation failed (using fallback)"
  [install_hint]="Install OpenClaw first:"
  [gw_not_running]="Gateway not running. Start with:"
  [openclaw_not_found]="openclaw CLI not found, cannot verify gateway"
  [nginx_conf_not_found]="Nginx config not found at standard locations"
  [nginx_no_inject]="Could not find injection point in Nginx config"
  [mode_label]="Mode"
)

# ============================================================
# Utility Functions
# ============================================================

# Translate: t key [printf_args...]
t() {
  local key="$1"; shift
  local msg
  if [[ "$LANG_CODE" == "zh" ]]; then
    msg="${MSG_ZH[$key]:-$key}"
  else
    msg="${MSG_EN[$key]:-$key}"
  fi
  if [[ $# -gt 0 ]]; then
    printf "$msg" "$@"
  else
    echo "$msg"
  fi
}

log()    { echo -e "  ${GREEN}[OK]${NC} $1"; }
warn()   { echo -e "  ${YELLOW}[!!]${NC} $1"; }
err()    { echo -e "  ${RED}[XX]${NC} $1"; }
info()   { echo -e "  ${CYAN}[ii]${NC} $1"; }

# Spinner: spinner PID "message"
spinner() {
  local pid=$1
  local msg="$2"
  local chars='|/-\'
  local i=0
  while kill -0 "$pid" 2>/dev/null; do
    printf "\r  ${TEAL}[%c]${NC} %s " "${chars:i++%4:1}" "$msg"
    sleep 0.15
  done
  wait "$pid"
  local rc=$?
  if [[ $rc -eq 0 ]]; then
    printf "\r  ${GREEN}[OK]${NC} %s\n" "$msg"
  else
    printf "\r  ${RED}[XX]${NC} %s\n" "$msg"
  fi
  return $rc
}

# Run a command with spinner
run_with_spinner() {
  local msg="$1"; shift
  local log_file
  log_file=$(mktemp /tmp/openclaw_install_XXXXXX.log)
  "$@" &>"$log_file" 2>&1 &
  local pid=$!
  spinner $pid "$msg"
  local rc=$?
  rm -f "$log_file"
  return $rc
}

# Step header: step_header CURRENT TOTAL "description"
step_header() {
  local current=$1 total=$2 desc="$3"
  echo ""
  echo -e "  ${TEAL}${BOLD}[$(t step_prefix) ${current}${NC}${TEAL}${BOLD}$(t step_of)${total}]${NC} ${BOLD}${desc}${NC}"
  echo -e "  ${DIM}$(printf '%.0s─' {1..50})${NC}"
}

# Step result: step_result "ok"|"skip"|"fail"
step_result() {
  local status="$1"
  case "$status" in
    ok)   echo -e "  ${GREEN_BG} $(t step_done) ${NC}" ;;
    skip) echo -e "  ${CYAN_BG} $(t step_skip) ${NC}" ;;
    fail) echo -e "  ${RED_BG} $(t step_fail) ${NC}" ;;
  esac
}

# Run step with retry/skip/abort on failure
# run_step CURRENT TOTAL "desc" skippable(0|1) function_name
run_step() {
  local current=$1 total=$2 desc="$3" skippable=$4 func=$5

  step_header "$current" "$total" "$desc"

  # Offer skip before running if skippable (skip in non-interactive mode)
  if [[ "$skippable" -eq 1 ]] && [[ "$NON_INTERACTIVE" -eq 0 ]]; then
    echo -ne "  ${DIM}$(t skip_prompt): ${NC}"
    read -r -t 5 skip_input 2>/dev/null || skip_input=""
    if [[ "$skip_input" == "s" || "$skip_input" == "S" ]]; then
      step_result skip
      return 0
    fi
  fi

  while true; do
    if $func; then
      step_result ok
      return 0
    else
      # In non-interactive mode, fail immediately on non-skippable, skip on skippable
      if [[ "$NON_INTERACTIVE" -eq 1 ]]; then
        if [[ "$skippable" -eq 1 ]]; then
          step_result skip
          return 0
        else
          step_result fail
          err "$(t abort_msg)"
          exit 1
        fi
      fi
      if [[ "$skippable" -eq 1 ]]; then
        echo ""
        echo -ne "  ${YELLOW}$(t retry_prompt): ${NC}"
        read -r choice || choice="a"
        case "$choice" in
          r|R) info "$(t retry_r)"; continue ;;
          s|S) step_result skip; return 0 ;;
          a|A) err "$(t abort_msg)"; exit 1 ;;
          *)   info "$(t retry_r)"; continue ;;
        esac
      else
        echo ""
        echo -ne "  ${YELLOW}$(t retry_abort): ${NC}"
        read -r choice || choice="a"
        case "$choice" in
          a|A) err "$(t abort_msg)"; exit 1 ;;
          *)   info "$(t retry_r)"; continue ;;
        esac
      fi
    fi
  done
}

# ============================================================
# Banner
# ============================================================

show_banner() {
  clear 2>/dev/null || true
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
  echo -e "  ${DIM}$(t banner_subtitle) v${VERSION}${NC}"
  echo -e "  ${DIM}$(printf '%.0s─' {1..50})${NC}"
  echo ""
}

# ============================================================
# Language Selection
# ============================================================

select_language() {
  if command -v whiptail &>/dev/null; then
    local choice
    choice=$(whiptail --title "Language / 语言" \
      --menu "$(t lang_select)" 12 50 2 \
      "zh" "中文 (Chinese)" \
      "en" "English" \
      3>&1 1>&2 2>&3) || choice="zh"
    LANG_CODE="$choice"
  else
    echo -e "  ${BOLD}$(t lang_select)${NC}"
    echo ""
    echo -e "    ${TEAL}1)${NC} 中文 (Chinese)"
    echo -e "    ${TEAL}2)${NC} English"
    echo ""
    echo -ne "  [1/2]: "
    read -r lang_choice || lang_choice=""
    case "$lang_choice" in
      2|en|EN) LANG_CODE="en" ;;
      *)       LANG_CODE="zh" ;;
    esac
  fi
}

# ============================================================
# Mode Selection
# ============================================================

INSTALL_MODE=""

select_mode() {
  if command -v whiptail &>/dev/null; then
    local choice
    choice=$(whiptail --title "$(t mode_select)" \
      --menu "" 14 70 2 \
      "beginner" "$(t mode_beginner)" \
      "existing" "$(t mode_existing)" \
      3>&1 1>&2 2>&3) || choice="existing"
    INSTALL_MODE="$choice"
  else
    echo ""
    echo -e "  ${BOLD}$(t mode_select)${NC}"
    echo ""
    echo -e "    ${TEAL}1)${NC} $(t mode_beginner)"
    echo -e "       ${DIM}$(t mode_beginner_desc)${NC}"
    echo ""
    echo -e "    ${TEAL}2)${NC} $(t mode_existing)"
    echo -e "       ${DIM}$(t mode_existing_desc)${NC}"
    echo ""
    echo -ne "  [1/2]: "
    read -r mode_choice || mode_choice=""
    case "$mode_choice" in
      2) INSTALL_MODE="existing" ;;
      *) INSTALL_MODE="beginner" ;;
    esac
  fi
}

# ============================================================
# Step Functions — Shared
# ============================================================

OPENCLAW_TOKEN=""

do_prereqs() {
  # Node.js
  info "$(t prereqs_node)"
  if ! command -v node &>/dev/null; then
    err "$(t node_not_found)"
    echo -e "    ${DIM}curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -${NC}"
    echo -e "    ${DIM}sudo apt-get install -y nodejs${NC}"
    echo -e "    ${DIM}# or: curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash${NC}"
    return 1
  fi
  local node_ver
  node_ver=$(node -v | sed 's/v//' | cut -d. -f1)
  if [[ "$node_ver" -lt "$NODE_MIN" ]]; then
    err "$(t node_old) v$(node -v))"
    return 1
  fi
  log "Node.js $(node -v)"

  # npm
  info "$(t prereqs_npm)"
  if ! command -v npm &>/dev/null; then
    err "$(t npm_not_found)"
    return 1
  fi
  log "npm $(npm -v)"

  # git (non-fatal)
  info "$(t prereqs_git)"
  if command -v git &>/dev/null; then
    log "git $(git --version | awk '{print $3}')"
  else
    warn "$(t git_not_found)"
  fi

  # curl (needed for health check)
  if ! command -v curl &>/dev/null; then
    warn "curl not found — health check will be skipped"
  else
    log "curl $(curl --version 2>/dev/null | head -1 | awk '{print $2}')"
  fi

  # pm2
  info "$(t prereqs_pm2)"
  if ! command -v pm2 &>/dev/null; then
    warn "$(t pm2_installing)"
    if [[ "$(id -u)" -eq 0 ]]; then
      npm install -g pm2 &>/dev/null || return 1
    else
      sudo npm install -g pm2 &>/dev/null || npm install -g pm2 &>/dev/null || return 1
    fi
  fi
  log "pm2 $(pm2 -v 2>/dev/null || echo '?')"

  return 0
}

do_install_deps() {
  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || echo "")"

  # If we're running from the repo already, use it
  if [[ -f "${script_dir}/package.json" ]]; then
    CMD_DIR="$script_dir"
  fi

  # If CMD_DIR doesn't have package.json, try to clone or locate
  if [[ ! -f "${CMD_DIR}/package.json" ]]; then
    if [[ -n "$script_dir" ]] && [[ -f "${script_dir}/package.json" ]]; then
      # Running from repo, copy to target (cp -a instead of rsync)
      if [[ "$script_dir" != "$CMD_DIR" ]]; then
        info "$(t install_deps_clone)"
        mkdir -p "$CMD_DIR"
        # Copy everything except build artifacts and user config
        cp -a "$script_dir"/. "$CMD_DIR"/
        rm -rf "${CMD_DIR}/node_modules" "${CMD_DIR}/dist" "${CMD_DIR}/logs" "${CMD_DIR}/tsconfig.tsbuildinfo"
      fi
    elif command -v git &>/dev/null; then
      info "$(t install_deps_clone)"
      mkdir -p "$(dirname "$CMD_DIR")"
      git clone https://github.com/openclaw/command-center.git "$CMD_DIR" 2>/dev/null || {
        warn "$(t git_clone_fail)"
      }
    fi
  else
    # Existing install — update if git available
    if [[ -d "${CMD_DIR}/.git" ]] && command -v git &>/dev/null; then
      info "$(t install_deps_update)"
      (cd "$CMD_DIR" && git pull --rebase 2>/dev/null) || warn "$(t git_pull_fail)"
    fi
  fi

  if [[ ! -f "${CMD_DIR}/package.json" ]]; then
    err "$(printf "$(t pkg_not_found)" "${CMD_DIR}")"
    return 1
  fi

  cd "$CMD_DIR" || return 1

  # npm ci (deterministic) if lockfile exists, else npm install
  info "$(t install_deps_npm)"
  local npm_cmd
  if [[ -f "${CMD_DIR}/package-lock.json" ]]; then
    npm_cmd="npm ci --no-fund --no-audit"
  else
    npm_cmd="npm install --no-fund --no-audit"
  fi
  if run_with_spinner "npm install" $npm_cmd; then
    return 0
  else
    err "$(t install_deps_npm_fail)"
    if [[ "$LANG_CODE" == "zh" ]]; then
      echo ""
      info "$(t npm_mirror_hint)"
      echo -e "    ${CYAN}$(t npm_mirror_cmd)${NC}"
      echo ""
    fi
    return 1
  fi
}

do_configure() {
  cd "$CMD_DIR" || return 1

  # --- Password ---
  if [[ -f "${CMD_DIR}/.auth_password" ]]; then
    log "$(t configure_password_keep)"
    INSTALL_PASSWORD="(existing)"
  else
    local pw1=""
    if [[ "$NON_INTERACTIVE" -eq 1 ]] && [[ -n "$ARG_PASSWORD" ]]; then
      pw1="$ARG_PASSWORD"
    else
      echo ""
      info "$(t configure_password)"
      echo -e "  ${DIM}$(t configure_password_default)${NC}"
      local pw2=""
      local attempts=0
      while true; do
        echo -ne "  > "
        read -r -s pw1 || pw1=""
        echo ""
        if [[ -z "$pw1" ]]; then
          pw1="openclaw"
          break
        fi
        if [[ ${#pw1} -lt 6 ]]; then
          warn "$(t configure_password_short)"
          pw1="openclaw"
          break
        fi
        echo -ne "  $(t configure_password_confirm): "
        read -r -s pw2 || pw2=""
        echo ""
        if [[ "$pw1" == "$pw2" ]]; then
          break
        else
          warn "$(t configure_password_mismatch)"
          attempts=$((attempts + 1))
          if [[ $attempts -ge 3 ]]; then
            pw1="openclaw"
            warn "$(t configure_password_short)"
            break
          fi
        fi
      done
    fi
    # Validate non-interactive password
    if [[ ${#pw1} -lt 6 ]]; then
      pw1="openclaw"
    fi
    # Save plain text for summary display
    INSTALL_PASSWORD="$pw1"
    # Hash with scrypt via Node.js before writing (matches auth.js hashPassword())
    local hashed
    hashed=$(node -e "
      const crypto = require('crypto');
      const salt = crypto.randomBytes(16).toString('hex');
      const hash = crypto.scryptSync(process.argv[1], salt, 64).toString('hex');
      process.stdout.write(salt + ':' + hash);
    " "$pw1" 2>/dev/null)
    if [[ -n "$hashed" ]] && [[ "$hashed" == *":"* ]]; then
      printf '%s' "$hashed" > "${CMD_DIR}/.auth_password"
    else
      # Fallback: write plain text (auth.js supports legacy plain text)
      printf '%s' "$pw1" > "${CMD_DIR}/.auth_password"
    fi
    log "$(t configure_password_ok)"
  fi

  # --- integrations.json (needed by server/routes/integrations-config.js) ---
  local integ_path="${CMD_DIR}/integrations.json"
  if [[ ! -f "$integ_path" ]]; then
    cat > "$integ_path" <<'INTEGEOF'
{
  "gmail": { "enabled": false, "email": "", "appPassword": "" },
  "drive": { "enabled": false, "serviceAccountKey": null, "folderId": null },
  "voice": { "enabled": true, "source": "openclaw", "apiKeyOverride": null },
  "webhook": { "enabled": false, "url": "", "secret": "" },
  "google-sheets": { "enabled": false }
}
INTEGEOF
    log "integrations.json created"
  fi

  # --- bulletin/board.md (needed by server) ---
  local board_path="${OPENCLAW_HOME}/workspace/departments/bulletin/board.md"
  if [[ ! -f "$board_path" ]]; then
    mkdir -p "$(dirname "$board_path")"
    printf '%s\n' "# Bulletin Board" "" "Welcome to Command Center." > "$board_path"
    log "bulletin/board.md created"
  fi

  # --- Departments ---
  info "$(t configure_dept)"
  local dept_config="${OPENCLAW_HOME}/workspace/departments/config.json"
  if [[ -f "$dept_config" ]]; then
    # Check for old numeric-key format
    local needs_migrate
    needs_migrate=$(node -e "
      const c = JSON.parse(require('fs').readFileSync('${dept_config}', 'utf8'));
      const k = Object.keys(c.departments || {})[0] || '';
      console.log(/^\d+$/.test(k) ? 'yes' : 'no');
    " 2>/dev/null || echo "no")
    if [[ "$needs_migrate" == "yes" ]]; then
      info "$(t configure_dept_migrate)"
      node "${CMD_DIR}/scripts/migrate-config.js" 2>/dev/null || warn "$(t configure_dept_migrate_fail)"
    fi
    log "$(t configure_dept_ok)"
  else
    info "$(t configure_dept_create)"
    mkdir -p "$(dirname "$dept_config")"
    cat > "$dept_config" <<DEPTEOF
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
    log "$(t configure_dept_ok)"
  fi

  return 0
}

do_build_start() {
  cd "$CMD_DIR" || return 1

  # Build frontend
  info "$(t build_run)"
  if ! run_with_spinner "$(t build_run)" npm run build; then
    err "$(t build_fail)"
    return 1
  fi
  if [[ ! -f "${CMD_DIR}/dist/index.html" ]]; then
    err "$(t build_fail)"
    return 1
  fi

  # Layout generation skipped — server auto-generates on startup (layout-generator.js)

  # Check port conflict (fallback chain: ss → lsof → netstat)
  local port_in_use=0
  if command -v ss &>/dev/null; then
    ss -tlnp 2>/dev/null | grep -q ":${CMD_PORT} " && port_in_use=1
  elif command -v lsof &>/dev/null; then
    lsof -iTCP:"${CMD_PORT}" -sTCP:LISTEN &>/dev/null && port_in_use=1
  elif command -v netstat &>/dev/null; then
    netstat -tlnp 2>/dev/null | grep -q ":${CMD_PORT} " && port_in_use=1
  fi
  if [[ "$port_in_use" -eq 1 ]]; then
    # Check if it's our own PM2 process
    local pm2_pid
    pm2_pid=$(pm2 pid "$PM2_NAME" 2>/dev/null || echo "")
    if [[ -z "$pm2_pid" ]] || [[ "$pm2_pid" == "0" ]]; then
      warn "$(printf "$(t build_pm2_port)" "$CMD_PORT")"
      info "$(t build_pm2_port_hint)"
    fi
  fi

  # Generate ecosystem config with CMD_PORT and OPENCLAW_HOME
  cat > "${CMD_DIR}/ecosystem.config.cjs" <<PMEOF
const path = require('path');
const home = process.env.HOME || '/root';

module.exports = {
  apps: [{
    name: '${PM2_NAME}',
    script: 'server/index.js',
    cwd: '${CMD_DIR}',
    node_args: '--max-old-space-size=256',
    max_memory_restart: '400M',
    autorestart: true,
    exp_backoff_restart_delay: 1000,
    watch: false,
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    env: {
      NODE_ENV: 'production',
      CMD_PORT: '${CMD_PORT}',
      OPENCLAW_HOME: '${OPENCLAW_HOME}',
    }
  }]
};
PMEOF

  # PM2 start
  info "$(t build_pm2_start)"
  pm2 delete "$PM2_NAME" 2>/dev/null || true
  pm2 start "${CMD_DIR}/ecosystem.config.cjs" &>/dev/null || return 1

  # Enable auto-start on system reboot (non-fatal)
  pm2 startup 2>/dev/null || true
  pm2 save &>/dev/null || true
  log "$(t build_pm2_ok)"

  return 0
}

do_health_check() {
  info "$(t health_run)"
  sleep 3

  if ! command -v curl &>/dev/null; then
    warn "curl not found — skipping health check"
    return 0
  fi

  local health
  health=$(curl -s --max-time 5 "http://127.0.0.1:${CMD_PORT}/health" 2>/dev/null || echo "")

  if echo "$health" | node -e "
    let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{
      try { const j=JSON.parse(d); process.exit(j.status==='ok'?0:1); } catch { process.exit(1); }
    });
  " 2>/dev/null; then
    log "$(t health_ok)"

    # Show gateway status if available
    local gw_status
    gw_status=$(echo "$health" | node -e "
      let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{
        try { const j=JSON.parse(d); console.log(j.gateway||'unknown'); } catch { console.log('unknown'); }
      });
    " 2>/dev/null || echo "unknown")
    if [[ "$gw_status" == "connected" ]]; then
      log "$(t health_gw_ok)"
    else
      warn "$(printf "$(t health_gw_fail)" "$gw_status")"
    fi
    return 0
  else
    warn "$(t health_fail)"
    info "$(t health_hint)"
    # Non-fatal: service might still be starting
    return 0
  fi
}

# ============================================================
# Step Functions — Beginner Mode Only
# ============================================================

do_warn_overwrite() {
  if [[ -d "${OPENCLAW_HOME}" ]] && [[ -f "${OPENCLAW_HOME}/openclaw.json" ]]; then
    echo ""
    local _warn_msg
    _warn_msg="$(t warn_overwrite_msg)"
    echo -e "  ${RED_BG}                                                ${NC}"
    echo -e "  ${RED_BG}   ${_warn_msg}$(printf '%*s' $((35 - ${#_warn_msg})) '')${NC}"
    echo -e "  ${RED_BG}                                                ${NC}"
    echo ""
    echo -e "  $(t warn_overwrite_path): ${YELLOW}${OPENCLAW_HOME}${NC}"
    echo ""
    echo -ne "  ${RED}$(t warn_overwrite_confirm): ${NC}"
    local confirm
    read -r confirm || confirm=""
    if [[ "$confirm" != "YES" ]]; then
      err "$(t warn_overwrite_abort)"
      exit 1
    fi
  fi
  return 0
}

do_install_openclaw() {
  info "$(t install_openclaw_run)"
  if run_with_spinner "$(t install_openclaw)" npm install -g openclaw; then
    log "$(t install_openclaw_ok) ($(openclaw --version 2>/dev/null || echo '?'))"
    return 0
  else
    if [[ "$LANG_CODE" == "zh" ]]; then
      info "$(t npm_mirror_hint)"
      echo -e "    ${CYAN}$(t npm_mirror_cmd)${NC}"
    fi
    return 1
  fi
}

do_setup_wizard() {
  info "$(t setup_wizard_run)"
  echo -e "  ${DIM}$(t setup_wizard_note)${NC}"
  echo -e "  ${DIM}$(printf '%.0s─' {1..50})${NC}"
  echo ""
  # Pass-through to interactive wizard
  local rc=0
  openclaw setup --wizard || rc=$?
  echo ""
  return $rc
}

do_configure_model() {
  info "$(t configure_model_run)"
  echo ""
  local rc=0
  openclaw configure --section model || rc=$?
  echo ""
  return $rc
}

do_configure_gateway() {
  info "$(t configure_gateway_run)"
  echo ""
  local rc=0
  openclaw configure --section gateway || rc=$?
  echo ""
  return $rc
}

do_start_gateway() {
  info "$(t start_gateway_run)"
  # Try normal install+start first
  if openclaw gateway install &>/dev/null && openclaw gateway start &>/dev/null; then
    sleep 2
    return 0
  fi
  # Fallback: run in background with --force
  warn "$(t start_gateway_fallback)"
  openclaw gateway run --force &>/dev/null &
  disown 2>/dev/null || true
  sleep 3
  return 0
}

do_verify_gateway() {
  info "$(t verify_gateway_run)"
  local i
  for i in $(seq 1 "$GATEWAY_HEALTH_RETRIES"); do
    if openclaw gateway health &>/dev/null; then
      log "$(t verify_gateway_ok)"
      return 0
    fi
    printf "  ${DIM}$(t verify_gateway_fail "$i" "$GATEWAY_HEALTH_RETRIES")${NC}\r"
    sleep "$GATEWAY_HEALTH_INTERVAL"
  done
  echo ""
  err "$(t verify_gateway_dead)"
  return 1
}

# ============================================================
# Step Functions — Existing Mode Only
# ============================================================

do_check_openclaw() {
  local config_path="${OPENCLAW_HOME}/openclaw.json"
  if [[ ! -f "$config_path" ]]; then
    err "$(printf "$(t check_openclaw_fail)" "$config_path")"
    echo ""
    echo -e "  ${DIM}$(t install_hint) npm install -g openclaw && openclaw setup --wizard${NC}"
    return 1
  fi
  log "$(t check_openclaw_ok)"

  # Extract auth token (matches server/gateway.js:resolveAuthToken priority)
  # Priority: gateway.auth.token → legacy (authToken, token, auth.token) → paired.json
  OPENCLAW_TOKEN=$(node -e "
    const fs = require('fs');
    const path = require('path');
    try {
      const c = JSON.parse(fs.readFileSync('${config_path}', 'utf8'));
      // 1. gateway.auth.token (most common — Gateway shared secret)
      if (c.gateway && c.gateway.auth && c.gateway.auth.token) {
        console.log(c.gateway.auth.token); process.exit(0);
      }
      // 2. Legacy field names
      const legacy = c.authToken || c.token || (c.auth && c.auth.token);
      if (legacy) { console.log(legacy); process.exit(0); }
      // 3. paired.json device lookup
      const pairedPath = path.join('${OPENCLAW_HOME}', 'devices', 'paired.json');
      if (fs.existsSync(pairedPath)) {
        const devices = JSON.parse(fs.readFileSync(pairedPath, 'utf8'));
        for (const e of Object.values(devices)) {
          if (e.clientId === 'gateway-client' && e.clientMode === 'backend') {
            const t = e.tokens && e.tokens.operator && e.tokens.operator.token;
            if (t) { console.log(t); process.exit(0); }
          }
        }
      }
      console.log('');
    } catch { console.log(''); }
  " 2>/dev/null || echo "")

  if [[ -n "$OPENCLAW_TOKEN" ]]; then
    log "$(t check_openclaw_token)"
  else
    warn "$(t check_openclaw_no_token)"
  fi
  return 0
}

do_check_verify_gateway() {
  # For existing mode: just check if gateway is alive, don't fail hard
  if command -v openclaw &>/dev/null; then
    info "$(t verify_gateway_run)"
    if openclaw gateway health &>/dev/null; then
      log "$(t verify_gateway_ok)"
      return 0
    fi
    # Try a few times
    local i
    for i in 1 2 3; do
      sleep 2
      if openclaw gateway health &>/dev/null; then
        log "$(t verify_gateway_ok)"
        return 0
      fi
    done
    warn "$(t verify_gateway_dead)"
    warn "$(t gw_not_running) openclaw gateway start"
    return 0  # non-fatal for existing mode
  else
    warn "$(t openclaw_not_found)"
    return 0
  fi
}

do_nginx_setup() {
  if ! command -v nginx &>/dev/null; then
    info "$(t nginx_not_found)"
    return 0
  fi

  local nginx_conf="/etc/nginx/sites-enabled/default"
  if [[ ! -f "$nginx_conf" ]]; then
    nginx_conf="/etc/nginx/conf.d/default.conf"
  fi
  if [[ ! -f "$nginx_conf" ]]; then
    warn "$(t nginx_conf_not_found)"
    return 0
  fi

  # Check if already configured
  if grep -q "location /cmd/" "$nginx_conf" 2>/dev/null; then
    log "$(t nginx_exists)"
    return 0
  fi

  info "$(t nginx_adding)"

  local nginx_snippet
  nginx_snippet=$(cat << 'NGINXEOF'

	# OpenClaw Command Center
	location /cmd/ {
		proxy_pass http://127.0.0.1:5100/cmd/;
		proxy_http_version 1.1;
		proxy_set_header Host $host;
		proxy_set_header X-Real-IP $remote_addr;
		proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
		proxy_set_header X-Forwarded-Proto $scheme;
	}

	location /cmd/ws {
		proxy_pass http://127.0.0.1:5100/ws;
		proxy_http_version 1.1;
		proxy_set_header Upgrade $http_upgrade;
		proxy_set_header Connection "upgrade";
		proxy_set_header Host $host;
		proxy_set_header X-Real-IP $remote_addr;
		proxy_read_timeout 86400;
	}

	location /cmd/api/ {
		proxy_pass http://127.0.0.1:5100/api/;
		proxy_http_version 1.1;
		proxy_set_header Host $host;
		proxy_set_header X-Real-IP $remote_addr;
		proxy_read_timeout 120s;
		proxy_send_timeout 120s;
	}
NGINXEOF
)

  # Back up
  cp "$nginx_conf" "${nginx_conf}.bak.$(date +%s)" 2>/dev/null

  # Inject before "location / {"
  if grep -qn "location / {" "$nginx_conf"; then
    local line_num
    line_num=$(grep -n "location / {" "$nginx_conf" | head -1 | cut -d: -f1)
    head -n $((line_num - 1)) "$nginx_conf" > /tmp/nginx_cmd_new.conf
    echo "$nginx_snippet" >> /tmp/nginx_cmd_new.conf
    echo "" >> /tmp/nginx_cmd_new.conf
    tail -n +"$line_num" "$nginx_conf" >> /tmp/nginx_cmd_new.conf
    cp /tmp/nginx_cmd_new.conf "$nginx_conf"
    rm -f /tmp/nginx_cmd_new.conf
  else
    warn "$(t nginx_no_inject)"
    return 0
  fi

  # Test and reload
  if nginx -t 2>/dev/null; then
    systemctl reload nginx 2>/dev/null || nginx -s reload 2>/dev/null || true
    log "$(t nginx_ok)"
  else
    warn "$(t nginx_fail)"
  fi

  return 0
}

# ============================================================
# Summary Screen
# ============================================================

show_summary() {
  # Use the plain-text password captured during do_configure(),
  # NOT the file (which now contains a scrypt hash)
  local password="${INSTALL_PASSWORD:-openclaw}"

  echo ""
  echo ""
  echo -e "  ${TEAL}${BOLD}$(printf '%.0s━' {1..50})${NC}"
  echo -e "  ${TEAL}${BOLD}  $(t done_title)${NC}"
  echo -e "  ${TEAL}${BOLD}$(printf '%.0s━' {1..50})${NC}"
  echo ""
  echo -e "  ${BOLD}$(t done_url):${NC}"
  echo -e "    ${GREEN}http://localhost:${CMD_PORT}/cmd/${NC}"
  if command -v nginx &>/dev/null && grep -q "location /cmd/" /etc/nginx/sites-enabled/default 2>/dev/null; then
    echo -e "    ${GREEN}http://<your-ip>/cmd/${NC}  (nginx)"
  fi
  echo ""
  echo -e "  ${BOLD}$(t done_password):${NC} ${CYAN}${password}${NC}"
  echo ""
  echo -e "  ${BOLD}$(t done_commands):${NC}"
  echo -e "    ${DIM}$(t done_cmd_logs)${NC}     pm2 logs ${PM2_NAME}"
  echo -e "    ${DIM}$(t done_cmd_restart)${NC}  pm2 restart ${PM2_NAME}"
  echo -e "    ${DIM}$(t done_cmd_stop)${NC}     pm2 stop ${PM2_NAME}"
  echo -e "    ${DIM}$(t done_cmd_deploy)${NC}   bash ${CMD_DIR}/scripts/deploy.sh"
  echo -e "    ${DIM}$(t done_cmd_password)${NC}  curl -X PUT http://localhost:${CMD_PORT}/api/auth/password"
  echo ""
  echo -e "  ${TEAL}${BOLD}$(printf '%.0s━' {1..50})${NC}"
  echo ""
}

# ============================================================
# Main Flow
# ============================================================

main() {
  show_banner

  # Root warning (skip in non-interactive mode)
  if [[ "$(id -u)" -eq 0 ]] && [[ "${HOME}" == "/root" ]] && [[ "$NON_INTERACTIVE" -eq 0 ]]; then
    warn "$(t root_warn)"
    echo -ne "  ${DIM}$(t root_warn_hint)${NC}"
    read -r || true
  fi

  # Language selection
  if [[ -n "$ARG_LANG" ]]; then
    LANG_CODE="$ARG_LANG"
  elif [[ "$NON_INTERACTIVE" -eq 1 ]]; then
    LANG_CODE="en"
  else
    select_language
  fi
  show_banner

  # Mode selection
  if [[ -n "$ARG_MODE" ]]; then
    INSTALL_MODE="$ARG_MODE"
  elif [[ "$NON_INTERACTIVE" -eq 1 ]]; then
    INSTALL_MODE="existing"
  else
    select_mode
  fi
  show_banner

  echo -e "  ${BOLD}$(t mode_label): ${TEAL}${INSTALL_MODE}${NC}"
  echo ""

  if [[ "$INSTALL_MODE" == "beginner" ]]; then
    # ── Beginner Mode: 13 steps (includes Nginx) ──
    local total=13

    run_step 1  $total "$(t prereqs)"           0 do_prereqs
    run_step 2  $total "$(t warn_overwrite)"     0 do_warn_overwrite
    run_step 3  $total "$(t install_openclaw)"   1 do_install_openclaw
    run_step 4  $total "$(t setup_wizard)"       1 do_setup_wizard
    run_step 5  $total "$(t configure_model)"    1 do_configure_model
    run_step 6  $total "$(t configure_gateway)"  1 do_configure_gateway
    run_step 7  $total "$(t start_gateway)"      1 do_start_gateway
    run_step 8  $total "$(t verify_gateway)"     0 do_verify_gateway
    run_step 9  $total "$(t install_deps)"       0 do_install_deps
    run_step 10 $total "$(t configure)"          0 do_configure
    run_step 11 $total "$(t build_start)"        0 do_build_start
    run_step 12 $total "$(t nginx_setup)"        1 do_nginx_setup
    run_step 13 $total "$(t health_check)"       0 do_health_check

  else
    # ── Existing User Mode: 8 steps ──
    local total=8

    run_step 1 $total "$(t prereqs)"           0 do_prereqs
    run_step 2 $total "$(t check_openclaw)"    0 do_check_openclaw
    run_step 3 $total "$(t verify_gateway)"    1 do_check_verify_gateway
    run_step 4 $total "$(t install_deps)"      0 do_install_deps
    run_step 5 $total "$(t configure)"         0 do_configure
    run_step 6 $total "$(t build_start)"       0 do_build_start
    run_step 7 $total "$(t nginx_setup)"       1 do_nginx_setup
    run_step 8 $total "$(t health_check)"      0 do_health_check
  fi

  show_summary
}

main "$@"
