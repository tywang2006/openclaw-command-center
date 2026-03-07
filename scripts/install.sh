#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# OpenClaw Command Center — One-click installer
# Usage: bash install.sh [password]
#   password: optional login password (default: openclaw)
# ============================================================

INSTALL_DIR="$HOME/.openclaw/workspace/command-center"
PORT=5100
PM2_NAME="openclaw-cmd"
NODE_MIN="18"

# Colors
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'

log()  { echo -e "${GREEN}[+]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
err()  { echo -e "${RED}[x]${NC} $*"; exit 1; }

# ── Pre-flight checks ──────────────────────────────────────
log "OpenClaw Command Center Installer"
echo "============================================================"

# Node.js
command -v node >/dev/null 2>&1 || err "Node.js not found. Install Node.js >= ${NODE_MIN} first."
NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
[ "$NODE_VER" -ge "$NODE_MIN" ] || err "Node.js >= ${NODE_MIN} required (found v$(node -v))"
log "Node.js $(node -v) ✓"

# npm
command -v npm >/dev/null 2>&1 || err "npm not found"
log "npm $(npm -v) ✓"

# pm2
if ! command -v pm2 >/dev/null 2>&1; then
  warn "pm2 not found, installing globally..."
  npm install -g pm2
fi
log "pm2 $(pm2 -v) ✓"

# nginx (optional)
SETUP_NGINX=false
if command -v nginx >/dev/null 2>&1; then
  SETUP_NGINX=true
  log "nginx found ✓"
else
  warn "nginx not found — skipping reverse proxy setup (access directly on port ${PORT})"
fi

# OpenClaw workspace
OPENCLAW_DIR="$HOME/.openclaw"
if [ ! -d "$OPENCLAW_DIR" ]; then
  warn "~/.openclaw not found — creating directory structure"
  mkdir -p "$OPENCLAW_DIR/workspace"
fi

# ── Extract / Copy project files ───────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

if [ "$PROJECT_ROOT" != "$INSTALL_DIR" ]; then
  log "Copying project to ${INSTALL_DIR}..."
  mkdir -p "$INSTALL_DIR"
  # Copy everything except node_modules, dist, logs, .auth_password
  rsync -a --delete \
    --exclude='node_modules' \
    --exclude='dist' \
    --exclude='logs' \
    --exclude='.auth_password' \
    --exclude='tsconfig.tsbuildinfo' \
    "$PROJECT_ROOT/" "$INSTALL_DIR/"
else
  log "Already in target directory"
fi

cd "$INSTALL_DIR"

# ── Set password ────────────────────────────────────────────
AUTH_PASSWORD="${1:-}"
if [ -z "$AUTH_PASSWORD" ]; then
  if [ -f .auth_password ]; then
    log "Keeping existing password"
  else
    AUTH_PASSWORD="openclaw"
    printf '%s' "$AUTH_PASSWORD" > .auth_password
    log "Default password set: openclaw"
  fi
else
  printf '%s' "$AUTH_PASSWORD" > .auth_password
  log "Password set ✓"
fi

# ── Fix ecosystem.config.cjs paths ─────────────────────────
log "Configuring PM2 ecosystem..."

# Read OpenClaw auth token if available
OPENCLAW_TOKEN=""
if [ -f "$HOME/.openclaw/openclaw.json" ]; then
  OPENCLAW_TOKEN=$(node -e "try{console.log(JSON.parse(require('fs').readFileSync('$HOME/.openclaw/openclaw.json','utf8')).authToken||'')}catch{}" 2>/dev/null || true)
fi

cat > ecosystem.config.cjs << ECOSYSTEMEOF
module.exports = {
  apps: [{
    name: '${PM2_NAME}',
    script: 'server/index.js',
    cwd: '${INSTALL_DIR}',
    node_args: '--max-old-space-size=256',
    max_memory_restart: '400M',
    autorestart: true,
    exp_backoff_restart_delay: 1000,
    watch: false,
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    env: {
      NODE_ENV: 'production',
      OPENCLAW_AUTH_TOKEN: '${OPENCLAW_TOKEN}'
    }
  }]
};
ECOSYSTEMEOF

# ── Install dependencies ────────────────────────────────────
log "Installing dependencies..."
npm install --production=false 2>&1 | tail -1

# ── Build frontend ──────────────────────────────────────────
log "Building frontend..."
npm run build 2>&1 | tail -3

if [ ! -f dist/index.html ]; then
  err "Build failed — dist/index.html not found"
fi
log "Frontend built ✓"

# ── Fix hardcoded paths in server ───────────────────────────
# Update department config path in server/index.js if needed
DEPT_CONFIG="$HOME/.openclaw/workspace/departments/config.json"
if [ ! -f "$DEPT_CONFIG" ]; then
  warn "Department config not found at ${DEPT_CONFIG}"
  warn "Create it or the department name mapping won't work"
fi

# Replace hardcoded /root/ paths with actual $HOME
if [ "$HOME" != "/root" ]; then
  log "Adjusting paths for HOME=${HOME}..."
  sed -i "s|/root/.openclaw|${HOME}/.openclaw|g" server/index.js
fi

# ── Setup Nginx reverse proxy ──────────────────────────────
if [ "$SETUP_NGINX" = true ]; then
  NGINX_CONF="/etc/nginx/sites-enabled/default"

  # Check if /cmd/ location already exists
  if grep -q "location /cmd/" "$NGINX_CONF" 2>/dev/null; then
    log "Nginx /cmd/ location already configured"
  else
    log "Adding Command Center to Nginx config..."

    # Create a snippet to inject
    NGINX_SNIPPET=$(cat << 'NGINXEOF'

	# OpenClaw Command Center (app-level auth)
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

    # Inject before the first closing brace of the server block
    # Back up first
    cp "$NGINX_CONF" "${NGINX_CONF}.bak.$(date +%s)"

    # Find the line with "location / {" and insert before it
    if grep -qn "location / {" "$NGINX_CONF"; then
      LINE_NUM=$(grep -n "location / {" "$NGINX_CONF" | head -1 | cut -d: -f1)
      head -n $((LINE_NUM - 1)) "$NGINX_CONF" > /tmp/nginx_new.conf
      echo "$NGINX_SNIPPET" >> /tmp/nginx_new.conf
      echo "" >> /tmp/nginx_new.conf
      tail -n +"$LINE_NUM" "$NGINX_CONF" >> /tmp/nginx_new.conf
      cp /tmp/nginx_new.conf "$NGINX_CONF"
      rm /tmp/nginx_new.conf
    else
      warn "Could not auto-inject Nginx config — add /cmd/ location blocks manually"
    fi

    # Test and reload
    if nginx -t 2>/dev/null; then
      systemctl reload nginx 2>/dev/null || nginx -s reload 2>/dev/null || true
      log "Nginx configured and reloaded ✓"
    else
      warn "Nginx config test failed — check ${NGINX_CONF}"
    fi
  fi
fi

# ── Start with PM2 ─────────────────────────────────────────
log "Starting Command Center..."

# Stop existing if running
pm2 delete "$PM2_NAME" 2>/dev/null || true

pm2 start ecosystem.config.cjs 2>&1 | tail -5
pm2 save 2>/dev/null || true

# Wait for startup
sleep 2

# Verify
if curl -s "http://127.0.0.1:${PORT}/health" | grep -q '"status":"ok"'; then
  log "Server running ✓"
else
  warn "Server may not be ready yet — check: pm2 logs ${PM2_NAME}"
fi

# ── Done ────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}============================================================${NC}"
echo -e "${CYAN} OpenClaw Command Center installed successfully!${NC}"
echo -e "${CYAN}============================================================${NC}"
echo ""
echo -e "  Direct:  ${GREEN}http://127.0.0.1:${PORT}/cmd/${NC}"
if [ "$SETUP_NGINX" = true ]; then
  echo -e "  Nginx:   ${GREEN}http://<your-ip>/cmd/${NC}"
fi
echo ""
echo -e "  Password: $(cat .auth_password)"
echo ""
echo -e "  PM2 commands:"
echo -e "    pm2 logs ${PM2_NAME}       # View logs"
echo -e "    pm2 restart ${PM2_NAME}    # Restart"
echo -e "    pm2 stop ${PM2_NAME}       # Stop"
echo ""
echo -e "  Quick redeploy (after code changes):"
echo -e "    bash ${INSTALL_DIR}/scripts/deploy.sh"
echo ""
echo -e "  Change password:"
echo -e "    echo 'newpassword' > ${INSTALL_DIR}/.auth_password"
echo ""
echo -e "  Documentation:"
echo -e "    ${INSTALL_DIR}/docs/USER_GUIDE.md"
echo ""
echo -e "${CYAN}============================================================${NC}"
