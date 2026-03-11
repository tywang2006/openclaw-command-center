#!/usr/bin/env bash
#
# ChaoClaw Command Center — macOS .app launcher
# Lives at: ChaoClaw Command Center.app/Contents/MacOS/launcher
# Compatible with macOS default bash 3.2.
#

CONTENTS_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RESOURCES="${CONTENTS_DIR}/Resources"
NODE="${RESOURCES}/node"
APP_DIR="${RESOURCES}/app"
OPENCLAW_HOME="${HOME}/.openclaw"
CMD_DIR="${OPENCLAW_HOME}/workspace/command-center"
SETUP_MARKER="${CMD_DIR}/.setup-done"

# First run — no setup marker, go straight to setup
if [ ! -f "$SETUP_MARKER" ]; then
  osascript -e "
    tell application \"Terminal\"
      activate
      do script \"bash '${RESOURCES}/setup.sh' && exit\"
    end tell
  "
  exit 0
fi

# ── Already set up — show action dialog ──
# Detect system language for bilingual dialog
SYS_LANG=$(defaults read NSGlobalDomain AppleLanguages 2>/dev/null | head -2 | tail -1 | tr -d ' ",' || echo "en")
if echo "$SYS_LANG" | grep -qi "zh"; then
  DLG_TITLE="ChaoClaw 指挥中心"
  DLG_MSG="请选择操作："
  BTN_LAUNCH="启动"
  BTN_REINSTALL="重装"
  BTN_UNINSTALL="卸载"
  REINSTALL_MSG="请选择重装模式："
  BTN_REINSTALL_APP="仅重装 App"
  BTN_REINSTALL_ALL="完全重装（含 OpenClaw）"
  CONFIRM_REINSTALL_APP="将重新运行安装向导，当前指挥中心配置会被覆盖。OpenClaw 配置保留。确定继续？"
  CONFIRM_REINSTALL_ALL="将删除整个 ~/.openclaw 目录并重新安装所有组件（OpenClaw + 指挥中心）。所有数据、配置、会话都将丢失！确定继续？"
  CONFIRM_UNINSTALL="确定卸载？这将删除 ~/.openclaw/workspace/command-center 下的所有数据。"
  UNINSTALL_DONE="已卸载。你可以将应用从"应用程序"文件夹中删除。"
else
  DLG_TITLE="ChaoClaw Command Center"
  DLG_MSG="Choose an action:"
  BTN_LAUNCH="Launch"
  BTN_REINSTALL="Reinstall"
  BTN_UNINSTALL="Uninstall"
  REINSTALL_MSG="Choose reinstall mode:"
  BTN_REINSTALL_APP="App Only"
  BTN_REINSTALL_ALL="Full Reset (incl. OpenClaw)"
  CONFIRM_REINSTALL_APP="This will re-run setup and overwrite Command Center config. OpenClaw config is preserved. Continue?"
  CONFIRM_REINSTALL_ALL="This will DELETE the entire ~/.openclaw directory and reinstall everything (OpenClaw + Command Center). All data, config, and sessions will be lost! Continue?"
  CONFIRM_UNINSTALL="Are you sure? This will delete all data under ~/.openclaw/workspace/command-center."
  UNINSTALL_DONE="Uninstalled. You can now remove the app from Applications."
fi

# Show 3-button dialog via osascript
CHOICE=$(osascript -e "
  tell application \"System Events\"
    set btn to button returned of (display dialog \"${DLG_MSG}\" with title \"${DLG_TITLE}\" buttons {\"${BTN_UNINSTALL}\", \"${BTN_REINSTALL}\", \"${BTN_LAUNCH}\"} default button \"${BTN_LAUNCH}\")
  end tell
  return btn
" 2>/dev/null)

# User cancelled or closed dialog
if [ -z "$CHOICE" ]; then
  exit 0
fi

# ── Handle: Uninstall ──
if [ "$CHOICE" = "$BTN_UNINSTALL" ]; then
  # Confirm
  CONFIRM=$(osascript -e "
    tell application \"System Events\"
      set btn to button returned of (display dialog \"${CONFIRM_UNINSTALL}\" with title \"${DLG_TITLE}\" buttons {\"Cancel\", \"OK\"} default button \"Cancel\" with icon caution)
    end tell
    return btn
  " 2>/dev/null)

  if [ "$CONFIRM" = "OK" ]; then
    # Kill running server
    CMD_PORT="${CMD_PORT:-5100}"
    lsof -ti:"${CMD_PORT}" 2>/dev/null | xargs kill -15 2>/dev/null || true; sleep 1; lsof -ti:"${CMD_PORT}" 2>/dev/null | xargs kill -9 2>/dev/null || true
    # Remove data
    rm -rf "$CMD_DIR"
    osascript -e "display dialog \"${UNINSTALL_DONE}\" with title \"${DLG_TITLE}\" buttons {\"OK\"} default button \"OK\"" 2>/dev/null
  fi
  exit 0
fi

# ── Handle: Reinstall ──
if [ "$CHOICE" = "$BTN_REINSTALL" ]; then
  # Sub-choice: App Only vs Full Reset
  REINSTALL_MODE=$(osascript -e "
    tell application \"System Events\"
      set btn to button returned of (display dialog \"${REINSTALL_MSG}\" with title \"${DLG_TITLE}\" buttons {\"Cancel\", \"${BTN_REINSTALL_APP}\", \"${BTN_REINSTALL_ALL}\"} default button \"${BTN_REINSTALL_APP}\")
    end tell
    return btn
  " 2>/dev/null)

  if [ -z "$REINSTALL_MODE" ]; then
    exit 0
  fi

  if [ "$REINSTALL_MODE" = "$BTN_REINSTALL_ALL" ]; then
    # Full reset — confirm with strong warning
    CONFIRM=$(osascript -e "
      tell application \"System Events\"
        set btn to button returned of (display dialog \"${CONFIRM_REINSTALL_ALL}\" with title \"${DLG_TITLE}\" buttons {\"Cancel\", \"OK\"} default button \"Cancel\" with icon caution)
      end tell
      return btn
    " 2>/dev/null)

    if [ "$CONFIRM" = "OK" ]; then
      # Kill running server
      CMD_PORT="${CMD_PORT:-5100}"
      lsof -ti:"${CMD_PORT}" 2>/dev/null | xargs kill -15 2>/dev/null || true; sleep 1; lsof -ti:"${CMD_PORT}" 2>/dev/null | xargs kill -9 2>/dev/null || true
      # Kill openclaw gateway if running
      pkill -f "openclaw gateway" 2>/dev/null || true
      # Delete entire ~/.openclaw
      rm -rf "$OPENCLAW_HOME"
      # Remove setup marker (parent dir already gone, but be safe)
      rm -f "$SETUP_MARKER"
      # Run setup in Terminal
      osascript -e "
        tell application \"Terminal\"
          activate
          do script \"bash '${RESOURCES}/setup.sh' && exit\"
        end tell
      "
    fi

  elif [ "$REINSTALL_MODE" = "$BTN_REINSTALL_APP" ]; then
    # App only — confirm
    CONFIRM=$(osascript -e "
      tell application \"System Events\"
        set btn to button returned of (display dialog \"${CONFIRM_REINSTALL_APP}\" with title \"${DLG_TITLE}\" buttons {\"Cancel\", \"OK\"} default button \"Cancel\" with icon caution)
      end tell
      return btn
    " 2>/dev/null)

    if [ "$CONFIRM" = "OK" ]; then
      # Kill running server
      CMD_PORT="${CMD_PORT:-5100}"
      lsof -ti:"${CMD_PORT}" 2>/dev/null | xargs kill -15 2>/dev/null || true; sleep 1; lsof -ti:"${CMD_PORT}" 2>/dev/null | xargs kill -9 2>/dev/null || true
      # Remove setup marker to trigger fresh setup
      rm -f "$SETUP_MARKER"
      # Run setup in Terminal
      osascript -e "
        tell application \"Terminal\"
          activate
          do script \"bash '${RESOURCES}/setup.sh' && exit\"
        end tell
      "
    fi
  fi

  exit 0
fi

# ── Handle: Launch ──
export OPENCLAW_HOME
export CMD_PORT="${CMD_PORT:-5100}"

# Source .env if present
if [ -f "${CMD_DIR}/.env" ]; then
  set -a; . "${CMD_DIR}/.env"; set +a
fi

# Auto-pair device if needed (idempotent — skips if already paired)
"${NODE}" -e "
  const fs = require('fs');
  const path = require('path');
  const crypto = require('crypto');
  const home = process.argv[1];
  const pp = path.join(home, 'devices', 'paired.json');
  let d = {}; try { d = JSON.parse(fs.readFileSync(pp, 'utf8')); } catch {}
  for (const e of Object.values(d)) { if (e.clientId === 'gateway-client' && e.clientMode === 'backend') process.exit(0); }
  fs.mkdirSync(path.join(home, 'devices'), { recursive: true });
  const id = crypto.createHash('sha256').update(crypto.randomBytes(32)).digest('hex');
  const now = Date.now();
  d[id] = { deviceId: id, publicKey: crypto.randomBytes(32).toString('base64url'), displayName: 'Command Center', platform: process.platform, clientId: 'gateway-client', clientMode: 'backend', role: 'operator', roles: ['operator'], scopes: ['operator.admin'], tokens: { operator: { token: crypto.randomBytes(16).toString('hex'), role: 'operator', scopes: ['operator.admin'], createdAtMs: now } }, createdAtMs: now, approvedAtMs: now };
  const tmp = pp + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(d, null, 2)); fs.renameSync(tmp, pp);
" "$OPENCLAW_HOME" 2>/dev/null || true

# Ensure ChaoClaw Gateway is running
if command -v openclaw >/dev/null 2>&1; then
  if ! (echo | nc -w 1 127.0.0.1 18789 >/dev/null 2>&1); then
    nohup openclaw gateway >/dev/null 2>&1 &
    sleep 2
  fi
fi

# Kill any existing Command Center instance on our port
lsof -ti:"${CMD_PORT}" 2>/dev/null | xargs kill -15 2>/dev/null || true; sleep 1; lsof -ti:"${CMD_PORT}" 2>/dev/null | xargs kill -9 2>/dev/null || true

# Start server
cd "$CMD_DIR"
"${NODE}" server/index.js &
SERVER_PID=$!

# Wait for server to be ready (max 15 seconds)
i=0
while [ $i -lt 30 ]; do
  if curl -s --max-time 1 "http://127.0.0.1:${CMD_PORT}/health" 2>/dev/null | grep -q '"status":"ok"'; then
    break
  fi
  sleep 0.5
  i=$((i + 1))
done

# Open browser
open "http://localhost:${CMD_PORT}/cmd/"

# Keep running until server exits
wait $SERVER_PID
