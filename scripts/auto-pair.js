#!/usr/bin/env node
/**
 * Auto-pair the Command Center device with the local OpenClaw Gateway.
 *
 * Reads ~/.openclaw/devices/paired.json, checks if a device with
 * clientId="gateway-client" clientMode="backend" already exists,
 * and creates one if missing. The Gateway reads this file at startup
 * to accept connections from known devices.
 *
 * Usage:  node scripts/auto-pair.js [--openclaw-home /path/to/.openclaw]
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const args = process.argv.slice(2);
let openclawHome = process.env.OPENCLAW_HOME
  || path.join(process.env.HOME || '/root', '.openclaw');

// Parse --openclaw-home flag
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--openclaw-home' && args[i + 1]) {
    openclawHome = args[i + 1];
    break;
  }
}

const CLIENT_ID = 'gateway-client';
const CLIENT_MODE = 'backend';
const DISPLAY_NAME = 'Command Center';

const devicesDir = path.join(openclawHome, 'devices');
const pairedPath = path.join(devicesDir, 'paired.json');

function main() {
  // Read existing paired.json (or start empty)
  let devices = {};
  if (fs.existsSync(pairedPath)) {
    try {
      devices = JSON.parse(fs.readFileSync(pairedPath, 'utf8'));
    } catch {
      console.error('[auto-pair] Failed to parse paired.json, starting fresh');
      devices = {};
    }
  }

  // Check if gateway-client/backend already exists
  for (const entry of Object.values(devices)) {
    if (entry.clientId === CLIENT_ID && entry.clientMode === CLIENT_MODE) {
      console.log(`[auto-pair] Device "${CLIENT_ID}/${CLIENT_MODE}" already paired, skipping`);
      process.exit(0);
    }
  }

  // Generate new device identity
  const deviceId = crypto.createHash('sha256')
    .update(crypto.randomBytes(32))
    .digest('hex');

  const publicKey = crypto.randomBytes(32).toString('base64url');

  const token = crypto.randomBytes(16).toString('hex');

  const now = Date.now();

  const device = {
    deviceId,
    publicKey,
    displayName: DISPLAY_NAME,
    platform: process.platform,
    clientId: CLIENT_ID,
    clientMode: CLIENT_MODE,
    role: 'operator',
    roles: ['operator'],
    scopes: ['operator.admin'],
    tokens: {
      operator: {
        token,
        role: 'operator',
        scopes: ['operator.admin'],
        createdAtMs: now,
      },
    },
    createdAtMs: now,
    approvedAtMs: now,
  };

  devices[deviceId] = device;

  // Ensure directory exists
  fs.mkdirSync(devicesDir, { recursive: true });

  // Write atomically (write to temp, rename)
  const tmpPath = pairedPath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(devices, null, 2), 'utf8');
  fs.renameSync(tmpPath, pairedPath);

  console.log(`[auto-pair] Paired device "${CLIENT_ID}/${CLIENT_MODE}" (id: ${deviceId.substring(0, 12)}...)`);
}

main();
