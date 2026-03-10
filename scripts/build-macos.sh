#!/usr/bin/env bash
#
# Build macOS .app bundles as .dmg (primary) + .tar.gz (fallback).
# Runs on Linux — uses genisoimage for DMG creation.
#
# Usage:  bash scripts/build-macos.sh <staging_dir> <output_dir> <version> <node_dir>
#   staging_dir — directory with server/, dist/, node_modules/, scripts/, etc.
#   output_dir  — where to write .dmg / .tar.gz files
#   version     — e.g. "1.0.0"
#   node_dir    — directory containing node-darwin-x64 and/or node-darwin-arm64

set -euo pipefail

STAGING_DIR="$1"
OUTPUT_DIR="$2"
VERSION="$3"
NODE_DIR="$4"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLATFORMS_DIR="${SCRIPT_DIR}/platforms/macos"

HAS_GENISOIMAGE=false
command -v genisoimage &>/dev/null && HAS_GENISOIMAGE=true

HAS_DMG_TOOL=false
command -v dmg &>/dev/null && HAS_DMG_TOOL=true

build_macos_arch() {
  local arch="$1"  # x64 or arm64
  local node_bin="${NODE_DIR}/node-darwin-${arch}"

  if [[ ! -f "$node_bin" ]]; then
    echo "  SKIP macOS-${arch}: node binary not found at ${node_bin}"
    return
  fi

  local app_name="OpenClaw Command Center.app"
  local work_dir=$(mktemp -d)
  local app_dir="${work_dir}/${app_name}"

  echo "  Building macOS-${arch}..."

  # Create .app structure
  mkdir -p "${app_dir}/Contents/MacOS"
  mkdir -p "${app_dir}/Contents/Resources/app"

  # Info.plist — replace version placeholder
  sed "s/__VERSION__/${VERSION}/g" "${PLATFORMS_DIR}/Info.plist" > "${app_dir}/Contents/Info.plist"

  # Launcher (the executable macOS runs)
  cp "${PLATFORMS_DIR}/launcher.sh" "${app_dir}/Contents/MacOS/launcher"
  chmod +x "${app_dir}/Contents/MacOS/launcher"

  # Node binary
  cp "$node_bin" "${app_dir}/Contents/Resources/node"
  chmod +x "${app_dir}/Contents/Resources/node"

  # Setup script
  cp "${PLATFORMS_DIR}/setup.sh" "${app_dir}/Contents/Resources/setup.sh"
  chmod +x "${app_dir}/Contents/Resources/setup.sh"

  # App files
  cp -r "${STAGING_DIR}/server" "${app_dir}/Contents/Resources/app/"
  cp -r "${STAGING_DIR}/dist" "${app_dir}/Contents/Resources/app/"
  cp -r "${STAGING_DIR}/node_modules" "${app_dir}/Contents/Resources/app/"
  cp -r "${STAGING_DIR}/scripts" "${app_dir}/Contents/Resources/app/"
  cp "${STAGING_DIR}/package.json" "${app_dir}/Contents/Resources/app/"
  [[ -f "${STAGING_DIR}/ecosystem.config.cjs" ]] && cp "${STAGING_DIR}/ecosystem.config.cjs" "${app_dir}/Contents/Resources/app/"
  [[ -f "${STAGING_DIR}/package-lock.json" ]] && cp "${STAGING_DIR}/package-lock.json" "${app_dir}/Contents/Resources/app/"

  # ── DMG (primary) ──
  if $HAS_GENISOIMAGE; then
    local dmg_name="OpenClaw-Cmd-${VERSION}-macos-${arch}.dmg"
    local dmg_stage="${work_dir}/dmg-root"
    mkdir -p "$dmg_stage"

    # Copy .app into DMG staging
    cp -r "${app_dir}" "${dmg_stage}/"

    # Symlink to /Applications for drag-install
    ln -s /Applications "${dmg_stage}/Applications"

    # Step 1: genisoimage → uncompressed HFS+ hybrid ISO
    local raw_iso="${work_dir}/raw.iso"
    genisoimage \
      -V "OpenClaw Command Center" \
      -D -R -apple -no-pad \
      -o "$raw_iso" \
      "$dmg_stage" 2>/dev/null

    if [[ -f "$raw_iso" ]]; then
      if $HAS_DMG_TOOL; then
        # Step 2: dmg tool → compressed UDZO DMG (zlib, ~60% smaller)
        dmg "$raw_iso" "${OUTPUT_DIR}/${dmg_name}" 2>/dev/null
      else
        # Fallback: rename raw ISO as .dmg (macOS can still mount it)
        mv "$raw_iso" "${OUTPUT_DIR}/${dmg_name}"
      fi

      if [[ -f "${OUTPUT_DIR}/${dmg_name}" ]]; then
        local size=$(du -h "${OUTPUT_DIR}/${dmg_name}" | cut -f1)
        echo "  OK: ${dmg_name} (${size})"
      else
        echo "  WARN: DMG creation failed for ${arch}"
      fi
    else
      echo "  WARN: genisoimage failed for ${arch}"
    fi

    rm -rf "$dmg_stage" "$raw_iso"
  fi

  # ── tar.gz (always produce as fallback) ──
  local tgz_name="OpenClaw-Cmd-${VERSION}-macos-${arch}.tar.gz"
  cd "$work_dir"
  tar czf "${OUTPUT_DIR}/${tgz_name}" "${app_name}"
  cd - >/dev/null

  local size=$(du -h "${OUTPUT_DIR}/${tgz_name}" | cut -f1)
  echo "  OK: ${tgz_name} (${size})"

  rm -rf "$work_dir"
}

# Build both architectures
build_macos_arch "x64"
build_macos_arch "arm64"
