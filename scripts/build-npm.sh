#!/usr/bin/env bash
#
# Build npm package (.tgz) for publishing.
#
# Usage:  bash scripts/build-npm.sh <staging_dir> <output_dir> <version>
#   staging_dir — directory with server/, dist/, node_modules/, scripts/, etc.
#   output_dir  — where to write .tgz
#   version     — e.g. "1.0.0"

set -euo pipefail

STAGING_DIR="$1"
OUTPUT_DIR="$2"
VERSION="$3"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PLATFORMS_DIR="${SCRIPT_DIR}/platforms/npm"

echo "  Building npm package..."

WORK_DIR=$(mktemp -d)
NPM_DIR="${WORK_DIR}/npm-pkg"
mkdir -p "${NPM_DIR}/bin"

# Copy app files
cp -r "${STAGING_DIR}/server" "${NPM_DIR}/"
cp -r "${STAGING_DIR}/dist" "${NPM_DIR}/"
cp -r "${STAGING_DIR}/scripts" "${NPM_DIR}/"
[[ -f "${STAGING_DIR}/ecosystem.config.cjs" ]] && cp "${STAGING_DIR}/ecosystem.config.cjs" "${NPM_DIR}/"

# CLI entry point
cp "${PLATFORMS_DIR}/cli.mjs" "${NPM_DIR}/bin/cli.mjs"
chmod +x "${NPM_DIR}/bin/cli.mjs"

# Generate publish-ready package.json (no devDependencies, no react)
node -e "
  const pkg = JSON.parse(require('fs').readFileSync('${PROJECT_DIR}/package.json', 'utf8'));

  const publishPkg = {
    name: 'chaoclaw-cmd',
    version: '${VERSION}',
    description: 'ChaoClaw Command Center — visual management dashboard for ChaoClaw agents',
    type: 'module',
    bin: {
      'chaoclaw-cmd': './bin/cli.mjs'
    },
    files: [
      'bin/',
      'server/',
      'dist/',
      'scripts/',
      'ecosystem.config.cjs'
    ],
    dependencies: {},
    engines: {
      node: '>=18.0.0'
    },
    keywords: ['chaoclaw', 'command-center', 'agent', 'dashboard'],
    license: 'MIT',
    repository: {
      type: 'git',
      url: 'https://github.com/chaoclaw/command-center'
    }
  };

  // Copy only server-side dependencies (no react, no dev deps)
  const serverDeps = ['express', 'ws', 'chokidar', 'googleapis', 'nodemailer', 'multer'];
  for (const dep of serverDeps) {
    if (pkg.dependencies && pkg.dependencies[dep]) {
      publishPkg.dependencies[dep] = pkg.dependencies[dep];
    }
  }

  require('fs').writeFileSync('${NPM_DIR}/package.json', JSON.stringify(publishPkg, null, 2) + '\n');
  console.log('  package.json generated');
"

# Install only prod deps (no node_modules copy — npm will handle this)
cd "$NPM_DIR"
npm install --omit=dev --silent 2>&1 | tail -3

# Pack
npm pack --silent 2>&1
TGZ=$(ls -1 *.tgz 2>/dev/null | head -1)

if [[ -n "$TGZ" ]]; then
  mv "$TGZ" "${OUTPUT_DIR}/"
  local_size=$(du -h "${OUTPUT_DIR}/${TGZ}" | cut -f1)
  echo "  OK: ${TGZ} (${local_size})"
else
  echo "  WARN: npm pack did not produce .tgz"
fi

rm -rf "$WORK_DIR"
