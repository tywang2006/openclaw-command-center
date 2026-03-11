#!/usr/bin/env bash
#
# OpenClaw Command Center — Multi-Platform Build Orchestrator
#
# Usage:
#   bash scripts/build-all.sh --all              # Build everything
#   bash scripts/build-all.sh --linux             # Linux .run only
#   bash scripts/build-all.sh --macos             # macOS .tar.gz (x64 + arm64)
#   bash scripts/build-all.sh --windows           # Windows .exe + .zip
#   bash scripts/build-all.sh --npm               # npm .tgz
#   bash scripts/build-all.sh --linux --macos     # Combine flags
#
# Prerequisites: node >= 18, npm, curl
# Optional:      makeself (Linux), nsis (Windows .exe)
#

set -euo pipefail

# ============================================================
# Parse arguments
# ============================================================

BUILD_LINUX=false
BUILD_MACOS=false
BUILD_WINDOWS=false
BUILD_NPM=false

for arg in "$@"; do
  case "$arg" in
    --all)     BUILD_LINUX=true; BUILD_MACOS=true; BUILD_WINDOWS=true; BUILD_NPM=true ;;
    --linux)   BUILD_LINUX=true ;;
    --macos)   BUILD_MACOS=true ;;
    --windows) BUILD_WINDOWS=true ;;
    --npm)     BUILD_NPM=true ;;
    --help|-h)
      echo "Usage: bash scripts/build-all.sh [--all|--linux|--macos|--windows|--npm]"
      exit 0
      ;;
    *) echo "Unknown flag: $arg"; exit 1 ;;
  esac
done

# Default to --all if no flags given
if ! $BUILD_LINUX && ! $BUILD_MACOS && ! $BUILD_WINDOWS && ! $BUILD_NPM; then
  BUILD_LINUX=true; BUILD_MACOS=true; BUILD_WINDOWS=true; BUILD_NPM=true
fi

# ============================================================
# Config
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
VERSION=$(node -e "console.log(require('${PROJECT_DIR}/package.json').version)")
NODE_VERSION="22.12.0"

OUTPUT_DIR="${PROJECT_DIR}/release"
STAGING_DIR=$(mktemp -d)
NODE_CACHE_DIR="${PROJECT_DIR}/.node-cache"

trap 'rm -rf "$STAGING_DIR"' EXIT

# Colors
if [[ -t 1 ]] && [[ "${TERM:-}" != "dumb" ]]; then
  TEAL='\033[38;5;43m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
  RED='\033[0;31m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'
else
  TEAL='' GREEN='' YELLOW='' RED='' BOLD='' DIM='' NC=''
fi

echo ""
echo -e "${TEAL}${BOLD}============================================================${NC}"
echo -e "${TEAL}${BOLD} ChaoClaw Command Center — Multi-Platform Builder${NC}"
echo -e "${TEAL}${BOLD}============================================================${NC}"
echo -e " Version:      ${BOLD}${VERSION}${NC}"
echo -e " Node.js:      ${BOLD}v${NODE_VERSION}${NC}"
echo -e " Targets:      ${BOLD}$(
  targets=()
  $BUILD_LINUX && targets+=("Linux")
  $BUILD_MACOS && targets+=("macOS")
  $BUILD_WINDOWS && targets+=("Windows")
  $BUILD_NPM && targets+=("npm")
  echo "${targets[*]}"
)${NC}"
echo -e "${TEAL}${BOLD}============================================================${NC}"
echo ""

# ============================================================
# Step 1: Check tools
# ============================================================

echo -e "${BOLD}[1/7] Checking tools...${NC}"

check_tool() {
  if command -v "$1" &>/dev/null; then
    echo -e "  ${GREEN}✓${NC} $1"
  else
    echo -e "  ${RED}✗${NC} $1 — $2"
    return 1
  fi
}

check_tool "node" "required" || exit 1
check_tool "npm" "required" || exit 1
check_tool "curl" "required" || exit 1

$BUILD_LINUX && { check_tool "makeself" "apt install makeself" || true; }
$BUILD_MACOS && { check_tool "genisoimage" "apt install genisoimage (for .dmg)" || true; }
$BUILD_WINDOWS && { check_tool "makensis" "apt install nsis (optional, for .exe)" || true; }
$BUILD_WINDOWS && { check_tool "zip" "apt install zip" || true; }

echo ""

# ============================================================
# Step 2: Build frontend
# ============================================================

echo -e "${BOLD}[2/7] Building frontend...${NC}"
cd "$PROJECT_DIR"
npm run build --silent 2>&1 | tail -3
if [[ ! -f "${PROJECT_DIR}/dist/index.html" ]]; then
  echo -e "  ${RED}ERROR: Build failed — dist/index.html not found${NC}"
  exit 1
fi
echo -e "  ${GREEN}✓${NC} dist/ ready"
echo ""

# ============================================================
# Step 3: Create staging directory
# ============================================================

echo -e "${BOLD}[3/7] Staging application files...${NC}"

# Copy server code
cp -r "$PROJECT_DIR/server" "$STAGING_DIR/server"

# Copy built frontend
cp -r "$PROJECT_DIR/dist" "$STAGING_DIR/dist"

# Copy scripts (gen-layout, migrate-config, etc.)
mkdir -p "$STAGING_DIR/scripts"
for f in gen-layout.js migrate-config.js; do
  [[ -f "$PROJECT_DIR/scripts/$f" ]] && cp "$PROJECT_DIR/scripts/$f" "$STAGING_DIR/scripts/"
done

# Copy package files
cp "$PROJECT_DIR/package.json" "$STAGING_DIR/"
[[ -f "$PROJECT_DIR/package-lock.json" ]] && cp "$PROJECT_DIR/package-lock.json" "$STAGING_DIR/"
[[ -f "$PROJECT_DIR/ecosystem.config.cjs" ]] && cp "$PROJECT_DIR/ecosystem.config.cjs" "$STAGING_DIR/"

echo -e "  ${GREEN}✓${NC} Files staged"
echo ""

# ============================================================
# Step 4: Install production dependencies
# ============================================================

echo -e "${BOLD}[4/7] Installing production dependencies...${NC}"
cd "$STAGING_DIR"
npm ci --omit=dev --silent 2>&1 | tail -3 || npm install --omit=dev --silent 2>&1 | tail -3
NM_SIZE=$(du -sh node_modules | cut -f1)
echo -e "  ${GREEN}✓${NC} node_modules: ${NM_SIZE}"
echo ""

# ============================================================
# Step 5: Download Node.js binaries
# ============================================================

echo -e "${BOLD}[5/7] Downloading Node.js binaries...${NC}"
mkdir -p "$NODE_CACHE_DIR"

NODE_BIN_DIR=$(mktemp -d)

download_node() {
  local platform="$1"  # darwin, win, linux
  local arch="$2"      # x64, arm64
  local ext="$3"       # tar.gz, zip

  local filename="node-v${NODE_VERSION}-${platform}-${arch}"
  local url="https://nodejs.org/dist/v${NODE_VERSION}/${filename}.${ext}"
  local cache_file="${NODE_CACHE_DIR}/${filename}.${ext}"
  local out_name="node-${platform}-${arch}"

  if [[ "$platform" == "win" ]]; then
    out_name="node-win-${arch}.exe"
  fi

  echo -ne "  ${platform}-${arch}: "

  # Download if not cached
  if [[ ! -f "$cache_file" ]]; then
    if ! curl -fSL --progress-bar -o "$cache_file" "$url"; then
      echo -e "${RED}FAILED${NC}"
      rm -f "$cache_file"
      return 1
    fi
  else
    echo -ne "(cached) "
  fi

  # Extract node binary
  if [[ "$ext" == "tar.gz" ]]; then
    tar xzf "$cache_file" -C "$NODE_BIN_DIR" "${filename}/bin/node" --strip-components=2
    mv "${NODE_BIN_DIR}/node" "${NODE_BIN_DIR}/${out_name}"
  elif [[ "$ext" == "zip" ]]; then
    # Windows zip — extract node.exe
    local tmpzip=$(mktemp -d)
    cd "$tmpzip"
    unzip -q -o "$cache_file" "${filename}/node.exe" 2>/dev/null || true
    if [[ -f "${filename}/node.exe" ]]; then
      mv "${filename}/node.exe" "${NODE_BIN_DIR}/${out_name}"
    fi
    cd - >/dev/null
    rm -rf "$tmpzip"
  fi

  if [[ -f "${NODE_BIN_DIR}/${out_name}" ]]; then
    local size=$(du -h "${NODE_BIN_DIR}/${out_name}" | cut -f1)
    echo -e "${GREEN}✓${NC} (${size})"
  else
    echo -e "${RED}✗ extract failed${NC}"
    return 1
  fi
}

$BUILD_MACOS && download_node "darwin" "x64" "tar.gz"
$BUILD_MACOS && download_node "darwin" "arm64" "tar.gz"
$BUILD_WINDOWS && download_node "win" "x64" "zip"

echo ""

# ============================================================
# Step 6: Build per-platform packages
# ============================================================

echo -e "${BOLD}[6/7] Building platform packages...${NC}"
mkdir -p "$OUTPUT_DIR"

# ── Linux .run ──
if $BUILD_LINUX; then
  echo ""
  echo -e "  ${BOLD}── Linux ──${NC}"
  if command -v makeself &>/dev/null; then
    bash "${SCRIPT_DIR}/build-package.sh"
    # Move .run to release/
    for f in "${PROJECT_DIR}"/*.run; do
      [[ -f "$f" ]] && mv "$f" "${OUTPUT_DIR}/" && echo -e "  ${GREEN}✓${NC} $(basename "$f") moved to release/"
    done
  else
    echo -e "  ${YELLOW}SKIP: makeself not found${NC}"
  fi
fi

# ── macOS ──
if $BUILD_MACOS; then
  echo ""
  echo -e "  ${BOLD}── macOS ──${NC}"
  bash "${SCRIPT_DIR}/build-macos.sh" "$STAGING_DIR" "$OUTPUT_DIR" "$VERSION" "$NODE_BIN_DIR"
fi

# ── Windows ──
if $BUILD_WINDOWS; then
  echo ""
  echo -e "  ${BOLD}── Windows ──${NC}"
  bash "${SCRIPT_DIR}/build-windows.sh" "$STAGING_DIR" "$OUTPUT_DIR" "$VERSION" "$NODE_BIN_DIR"
fi

# ── npm ──
if $BUILD_NPM; then
  echo ""
  echo -e "  ${BOLD}── npm ──${NC}"
  bash "${SCRIPT_DIR}/build-npm.sh" "$STAGING_DIR" "$OUTPUT_DIR" "$VERSION"
fi

echo ""

# ============================================================
# Step 7: Generate checksums
# ============================================================

echo -e "${BOLD}[7/7] Generating checksums...${NC}"
cd "$OUTPUT_DIR"

ARTIFACTS=$(find . -maxdepth 1 -type f \( -name '*.run' -o -name '*.dmg' -o -name '*.tar.gz' -o -name '*.zip' -o -name '*.exe' -o -name '*.tgz' \) -printf '%f\n' 2>/dev/null | sort)
if [[ -n "$ARTIFACTS" ]]; then
  sha256sum $ARTIFACTS > SHA256SUMS.txt
  echo -e "  ${GREEN}✓${NC} SHA256SUMS.txt"
else
  echo -e "  ${YELLOW}No artifacts found${NC}"
fi

cd "$PROJECT_DIR"

# ============================================================
# Summary
# ============================================================

echo ""
echo -e "${TEAL}${BOLD}============================================================${NC}"
echo -e "${TEAL}${BOLD} Build Complete!${NC}"
echo -e "${TEAL}${BOLD}============================================================${NC}"
echo ""
echo -e " Output directory: ${BOLD}${OUTPUT_DIR}/${NC}"
echo ""

if [[ -d "$OUTPUT_DIR" ]]; then
  ls -lh "$OUTPUT_DIR"/ 2>/dev/null | tail -n +2 | while read -r line; do
    echo "  $line"
  done
fi

echo ""
echo -e "${TEAL}${BOLD}============================================================${NC}"
echo ""
