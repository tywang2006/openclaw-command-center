#!/bin/bash
#
# OpenClaw Command Center — One-Click Installer
# https://github.com/openclaw
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/openclaw/command-center/main/install.sh | bash
#   # or
#   git clone ... && cd command-center && bash install.sh
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

log()   { echo -e "${GREEN}[✓]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
err()   { echo -e "${RED}[✗]${NC} $1"; }
info()  { echo -e "${CYAN}[i]${NC} $1"; }
header(){ echo -e "\n${BOLD}${CYAN}=== $1 ===${NC}\n"; }

# -------------------------------------------------------
header "OpenClaw Command Center Installer"
# -------------------------------------------------------

OPENCLAW_HOME="${OPENCLAW_HOME:-$HOME/.openclaw}"
CMD_DIR="${OPENCLAW_HOME}/workspace/command-center"
CMD_PORT="${CMD_PORT:-5100}"

# ---- 1. Check Prerequisites ----
header "Checking Prerequisites"

# Node.js >= 18
if ! command -v node &>/dev/null; then
  err "Node.js is not installed. Please install Node.js >= 18."
  echo "    https://nodejs.org/"
  exit 1
fi
NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  err "Node.js >= 18 required (found v$(node -v))"
  exit 1
fi
log "Node.js $(node -v)"

# npm
if ! command -v npm &>/dev/null; then
  err "npm is not installed."
  exit 1
fi
log "npm $(npm -v)"

# pm2 (optional, will install if missing)
if ! command -v pm2 &>/dev/null; then
  warn "pm2 not found. Installing globally..."
  npm install -g pm2
  log "pm2 installed"
else
  log "pm2 $(pm2 -v)"
fi

# ---- 2. Check OpenClaw Installation ----
header "Checking OpenClaw"

if [ ! -f "${OPENCLAW_HOME}/openclaw.json" ]; then
  warn "OpenClaw not found at ${OPENCLAW_HOME}/openclaw.json"
  warn "Command Center will start but Gateway connection may fail."
  warn "Install OpenClaw first for full functionality."
  OPENCLAW_TOKEN=""
else
  log "OpenClaw found at ${OPENCLAW_HOME}"
  # Extract auth token
  OPENCLAW_TOKEN=$(node -e "
    try {
      const c = require('${OPENCLAW_HOME}/openclaw.json');
      console.log(c.authToken || c.token || '');
    } catch { console.log(''); }
  " 2>/dev/null || echo "")
  if [ -n "$OPENCLAW_TOKEN" ]; then
    log "Auth token found"
  else
    warn "Could not extract auth token from openclaw.json"
  fi
fi

# ---- 3. Clone / Update ----
header "Installing Command Center"

if [ -d "$CMD_DIR" ] && [ -f "${CMD_DIR}/package.json" ]; then
  info "Existing installation found at ${CMD_DIR}"
  echo -n "  Update existing installation? [Y/n] "
  read -r answer
  if [[ "$answer" =~ ^[Nn] ]]; then
    info "Skipping clone/update."
  else
    cd "$CMD_DIR"
    if [ -d ".git" ]; then
      info "Pulling latest changes..."
      git pull --rebase || warn "git pull failed, continuing with existing code"
    fi
  fi
else
  # Fresh install
  mkdir -p "$(dirname "$CMD_DIR")"
  if command -v git &>/dev/null; then
    info "Cloning repository..."
    git clone https://github.com/openclaw/command-center.git "$CMD_DIR" 2>/dev/null || {
      warn "git clone failed. Assuming code is already in place."
    }
  fi
fi

cd "$CMD_DIR"
log "Working directory: ${CMD_DIR}"

# ---- 4. Install Dependencies ----
header "Installing Dependencies"
npm install --production 2>&1 | tail -1
log "Dependencies installed"

# ---- 5. Configuration ----
header "Configuration"

# Set password
if [ ! -f "${CMD_DIR}/.auth_password" ]; then
  echo -n "  Set access password (min 6 chars) [openclaw]: "
  read -r -s PASSWORD
  echo
  PASSWORD="${PASSWORD:-openclaw}"
  if [ ${#PASSWORD} -lt 6 ]; then
    warn "Password too short, using default 'openclaw'"
    PASSWORD="openclaw"
  fi
  echo -n "$PASSWORD" > "${CMD_DIR}/.auth_password"
  log "Password set"
else
  log "Password already configured"
fi

# Create .env if missing
if [ ! -f "${CMD_DIR}/.env" ]; then
  cat > "${CMD_DIR}/.env" <<ENVEOF
# OpenClaw Command Center Configuration
OPENCLAW_HOME=${OPENCLAW_HOME}
CMD_PORT=${CMD_PORT}
OPENCLAW_AUTH_TOKEN=${OPENCLAW_TOKEN}
ENVEOF
  log ".env created"
else
  log ".env already exists"
fi

# ---- 6. Department Setup ----
header "Department Setup"

DEPT_CONFIG="${OPENCLAW_HOME}/workspace/departments/config.json"
if [ -f "$DEPT_CONFIG" ]; then
  log "Department config found"
  # Check if migration is needed
  NEEDS_MIGRATE=$(node -e "
    const c = JSON.parse(require('fs').readFileSync('${DEPT_CONFIG}', 'utf8'));
    const k = Object.keys(c.departments || {})[0] || '';
    console.log(/^\d+$/.test(k) ? 'yes' : 'no');
  " 2>/dev/null || echo "no")
  if [ "$NEEDS_MIGRATE" = "yes" ]; then
    info "Old config format detected, running migration..."
    node "${CMD_DIR}/scripts/migrate-config.js"
    log "Config migrated to new format"
  else
    log "Config is already in new format"
  fi
else
  info "No department config found. Creating default..."
  mkdir -p "$(dirname "$DEPT_CONFIG")"
  cat > "$DEPT_CONFIG" <<DEPTEOF
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
  # Create directory structure
  mkdir -p "${OPENCLAW_HOME}/workspace/departments/general/memory"
  mkdir -p "${OPENCLAW_HOME}/workspace/departments/bulletin/requests"
  mkdir -p "${OPENCLAW_HOME}/workspace/departments/personas"
  log "Default department config created"
fi

# ---- 7. Build Frontend ----
header "Building Frontend"
npm run build 2>&1 | tail -3
log "Frontend built"

# ---- 8. Generate Layout ----
header "Generating Office Layout"
node "${CMD_DIR}/scripts/gen-layout.js" 2>&1 | tail -3 || warn "Layout generation failed (will use fallback)"
log "Layout generated"

# ---- 9. PM2 Setup ----
header "Setting Up PM2 Service"

# Generate ecosystem config
cat > "${CMD_DIR}/ecosystem.config.cjs" <<PMEOF
const path = require('path');
const home = process.env.HOME || '/root';

module.exports = {
  apps: [{
    name: 'openclaw-cmd',
    script: 'server/index.js',
    cwd: path.join(home, '.openclaw', 'workspace', 'command-center'),
    node_args: '--max-old-space-size=256',
    max_memory_restart: '400M',
    autorestart: true,
    exp_backoff_restart_delay: 1000,
    watch: false,
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    env: {
      NODE_ENV: 'production',
    }
  }]
};
PMEOF

# Stop existing process if running
pm2 delete openclaw-cmd 2>/dev/null || true

# Start
pm2 start "${CMD_DIR}/ecosystem.config.cjs"
pm2 save
log "PM2 service started"

# ---- 10. Verify ----
header "Verifying Installation"
sleep 2

HEALTH=$(curl -s "http://127.0.0.1:${CMD_PORT}/health" 2>/dev/null || echo "")
if echo "$HEALTH" | node -e "
  let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{
    try { const j=JSON.parse(d); process.exit(j.status==='ok'?0:1); } catch { process.exit(1); }
  });
" 2>/dev/null; then
  log "Health check passed"
else
  warn "Health check failed — service may still be starting"
  info "Check logs: pm2 logs openclaw-cmd"
fi

# ---- Done! ----
header "Installation Complete!"
echo ""
echo -e "  ${BOLD}Command Center${NC} is running at:"
echo ""
echo -e "    ${CYAN}http://localhost:${CMD_PORT}/cmd/${NC}"
echo ""
echo -e "  ${BOLD}Useful commands:${NC}"
echo -e "    pm2 logs openclaw-cmd    — View logs"
echo -e "    pm2 restart openclaw-cmd — Restart service"
echo -e "    pm2 stop openclaw-cmd    — Stop service"
echo ""
echo -e "  ${BOLD}Nginx reverse proxy example:${NC}"
echo -e "    location /cmd/ {"
echo -e "        proxy_pass http://127.0.0.1:${CMD_PORT};"
echo -e "        proxy_http_version 1.1;"
echo -e "        proxy_set_header Upgrade \$http_upgrade;"
echo -e "        proxy_set_header Connection \"upgrade\";"
echo -e "        proxy_set_header Host \$host;"
echo -e "    }"
echo ""
log "Done!"
