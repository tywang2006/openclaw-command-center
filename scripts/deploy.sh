#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# OpenClaw Command Center — Quick Deploy
# Usage: bash scripts/deploy.sh
# Builds frontend + restarts PM2 process
# ============================================================

INSTALL_DIR="$HOME/.openclaw/workspace/command-center"
PM2_NAME="openclaw-cmd"
PORT=5100

# Colors
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'

log()  { echo -e "${GREEN}[+]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
err()  { echo -e "${RED}[x]${NC} $*"; exit 1; }

cd "$INSTALL_DIR" || err "Project not found at ${INSTALL_DIR}"

echo -e "${CYAN}============================================================${NC}"
echo -e "${CYAN} OpenClaw Command Center — Deploy${NC}"
echo -e "${CYAN}============================================================${NC}"

# ── Build ────────────────────────────────────────────────────
log "Building frontend (tsc + vite)..."
npm run build 2>&1 | tail -5

if [ ! -f dist/index.html ]; then
  err "Build failed — dist/index.html not found"
fi
log "Build complete"

# ── Restart PM2 ─────────────────────────────────────────────
if pm2 describe "$PM2_NAME" >/dev/null 2>&1; then
  log "Restarting PM2 process..."
  pm2 restart "$PM2_NAME" 2>&1 | tail -3
else
  log "Starting PM2 process..."
  pm2 start ecosystem.config.cjs 2>&1 | tail -3
  pm2 save 2>/dev/null || true
fi

# ── Verify ───────────────────────────────────────────────────
sleep 2
if curl -s "http://127.0.0.1:${PORT}/health" | grep -q '"status":"ok"'; then
  log "Server running"
else
  warn "Server may not be ready — check: pm2 logs ${PM2_NAME}"
fi

# ── Done ─────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}Deploy complete!${NC}"
echo -e "  URL:  http://127.0.0.1:${PORT}/cmd/"
echo -e "  Logs: pm2 logs ${PM2_NAME}"
echo ""
