#!/usr/bin/env bash
#
# OpenClaw Command Center — macOS .app launcher
# Lives at: OpenClaw Command Center.app/Contents/MacOS/launcher
#

CONTENTS_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RESOURCES="${CONTENTS_DIR}/Resources"
NODE="${RESOURCES}/node"
APP_DIR="${RESOURCES}/app"
OPENCLAW_HOME="${HOME}/.openclaw"
CMD_DIR="${OPENCLAW_HOME}/workspace/command-center"
SETUP_MARKER="${CMD_DIR}/.setup-done"

# First run — open Terminal for interactive setup
if [[ ! -f "$SETUP_MARKER" ]]; then
  osascript -e "
    tell application \"Terminal\"
      activate
      do script \"bash '${RESOURCES}/setup.sh' && exit\"
    end tell
  "
  exit 0
fi

# Normal run — start server in background, open browser
export OPENCLAW_HOME
export CMD_PORT="${CMD_PORT:-5100}"

# Source .env if present
[[ -f "${CMD_DIR}/.env" ]] && set -a && source "${CMD_DIR}/.env" && set +a

# Kill any existing instance on our port
lsof -ti:"${CMD_PORT}" 2>/dev/null | xargs kill -9 2>/dev/null || true

# Start server
cd "$CMD_DIR"
"${NODE}" server/index.js &
SERVER_PID=$!

# Wait for server to be ready (max 15 seconds)
for i in {1..30}; do
  if curl -s --max-time 1 "http://127.0.0.1:${CMD_PORT}/health" | grep -q '"status":"ok"' 2>/dev/null; then
    break
  fi
  sleep 0.5
done

# Open browser
open "http://localhost:${CMD_PORT}/cmd/"

# Keep running until server exits
wait $SERVER_PID
