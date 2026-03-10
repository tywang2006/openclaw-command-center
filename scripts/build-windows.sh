#!/usr/bin/env bash
#
# Build Windows installer (.exe via NSIS) and portable (.zip).
# Runs on Linux — requires nsis package for .exe.
#
# Usage:  bash scripts/build-windows.sh <staging_dir> <output_dir> <version> <node_dir>
#   staging_dir — directory with server/, dist/, node_modules/, scripts/, etc.
#   output_dir  — where to write .exe and .zip
#   version     — e.g. "1.0.0"
#   node_dir    — directory containing node-win-x64.exe

set -euo pipefail

STAGING_DIR="$1"
OUTPUT_DIR="$2"
VERSION="$3"
NODE_DIR="$4"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLATFORMS_DIR="${SCRIPT_DIR}/platforms/windows"

NODE_EXE="${NODE_DIR}/node-win-x64.exe"

if [[ ! -f "$NODE_EXE" ]]; then
  echo "  SKIP Windows: node.exe not found at ${NODE_EXE}"
  exit 0
fi

echo "  Building Windows x64..."

# ── Portable directory ──
WORK_DIR=$(mktemp -d)
WIN_DIR="${WORK_DIR}/OpenClaw-Cmd-${VERSION}-win-x64"
mkdir -p "$WIN_DIR"

# Node binary
cp "$NODE_EXE" "${WIN_DIR}/node.exe"

# App files
cp -r "${STAGING_DIR}/server" "${WIN_DIR}/"
cp -r "${STAGING_DIR}/dist" "${WIN_DIR}/"
cp -r "${STAGING_DIR}/node_modules" "${WIN_DIR}/"
cp -r "${STAGING_DIR}/scripts" "${WIN_DIR}/"
cp "${STAGING_DIR}/package.json" "${WIN_DIR}/"
[[ -f "${STAGING_DIR}/ecosystem.config.cjs" ]] && cp "${STAGING_DIR}/ecosystem.config.cjs" "${WIN_DIR}/"
[[ -f "${STAGING_DIR}/package-lock.json" ]] && cp "${STAGING_DIR}/package-lock.json" "${WIN_DIR}/"

# Platform launchers
cp "${PLATFORMS_DIR}/launcher.bat" "${WIN_DIR}/"
cp "${PLATFORMS_DIR}/setup.ps1" "${WIN_DIR}/"

# ── Portable ZIP ──
ZIP_NAME="OpenClaw-Cmd-${VERSION}-win-x64-portable.zip"
cd "$WORK_DIR"
zip -r -q "${OUTPUT_DIR}/${ZIP_NAME}" "$(basename "$WIN_DIR")"
cd - >/dev/null

local_size=$(du -h "${OUTPUT_DIR}/${ZIP_NAME}" | cut -f1)
echo "  OK: ${ZIP_NAME} (${local_size})"

# ── NSIS Installer ──
if command -v makensis &>/dev/null; then
  echo "  Building NSIS installer..."

  NSIS_STAGE="${WORK_DIR}/nsis-stage"
  cp -r "$WIN_DIR" "$NSIS_STAGE"

  NSIS_OUT="OpenClaw-Cmd-Setup-${VERSION}-win-x64.exe"

  makensis -V2 \
    -DVERSION="${VERSION}" \
    -DSTAGE_DIR="${NSIS_STAGE}" \
    -DOUTDIR="${OUTPUT_DIR}" \
    "${PLATFORMS_DIR}/installer.nsi" 2>&1 | tail -5

  if [[ -f "${OUTPUT_DIR}/${NSIS_OUT}" ]]; then
    local_size=$(du -h "${OUTPUT_DIR}/${NSIS_OUT}" | cut -f1)
    echo "  OK: ${NSIS_OUT} (${local_size})"
  else
    echo "  WARN: NSIS build may have failed — .exe not found"
  fi
else
  echo "  SKIP NSIS installer: makensis not found (apt install nsis)"
fi

rm -rf "$WORK_DIR"
