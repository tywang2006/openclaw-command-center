import { Router } from 'express';
import { execFile, execFileSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { OPENCLAW_HOME, BASE_PATH, CONFIG_PATH, getConfigValue, safeWriteFileSync } from '../utils.js';
import { getGateway } from '../gateway.js';
import { isPasswordConfigured } from '../auth.js';
import { createLogger } from '../logger.js';

const log = createLogger('Setup');
const router = Router();

const DEPT_CONFIG = path.join(BASE_PATH, 'departments', 'config.json');
const DEPT_STATUS = path.join(BASE_PATH, 'departments', 'status.json');
const BULLETIN = path.join(BASE_PATH, 'departments', 'bulletin', 'board.md');

// Rate limit for setup endpoints — 10 requests per minute per IP.
// Prevents brute-force or enumeration attacks on unauthenticated setup routes.
const setupCallCounts = new Map();
const SETUP_RATE_WINDOW_MS = 60 * 1000;
const SETUP_RATE_MAX = 10;

// Cleanup stale rate limit entries every 60s
setInterval(() => {
  const cutoff = Date.now() - SETUP_RATE_WINDOW_MS;
  for (const [ip, entry] of setupCallCounts) {
    if (entry.windowStart < cutoff) setupCallCounts.delete(ip);
  }
}, SETUP_RATE_WINDOW_MS);

function setupRateLimit(req, res, next) {
  const ip = req.ip || req.connection?.remoteAddress || 'unknown';
  const now = Date.now();
  let entry = setupCallCounts.get(ip);

  if (!entry || now - entry.windowStart > SETUP_RATE_WINDOW_MS) {
    entry = { windowStart: now, count: 0 };
    setupCallCounts.set(ip, entry);
  }
  entry.count++;

  if (entry.count > SETUP_RATE_MAX) {
    return res.status(429).json({ error: 'Too many setup requests, please slow down' });
  }
  next();
}

router.use('/setup', setupRateLimit);

/**
 * GET /api/setup/status
 * Check whether OpenClaw is installed and configured.
 * If the system is already initialized (password file exists), return
 * only a minimal { ready: true } response to prevent information disclosure.
 */
router.get('/setup/status', (req, res) => {
  // If already initialized, block detailed status to unauthenticated callers
  if (isPasswordConfigured()) {
    return res.json({ ready: true, initialized: true });
  }
  const status = checkSetupStatus();
  res.json(status);
});

/**
 * POST /api/setup/install
 * Install OpenClaw globally and initialize workspace
 * Streams progress via WebSocket broadcast
 */
router.post('/setup/install', async (req, res) => {
  const clientIp = req.ip || req.connection?.remoteAddress || '';
  const isLocal = clientIp === '127.0.0.1' || clientIp === '::1' || clientIp === '::ffff:127.0.0.1';
  if (!isLocal) {
    return res.status(403).json({ error: 'Setup only allowed from localhost' });
  }

  // Block if system is already configured (first-run only)
  if (isPasswordConfigured()) {
    return res.status(403).json({ error: 'Setup is disabled after initial configuration. Use the admin panel.' });
  }

  const wss = req.app.locals.wss;
  const broadcast = (step, message, done = false, error = false) => {
    const payload = JSON.stringify({
      event: 'setup:progress',
      data: { step, message, done, error },
      timestamp: new Date().toISOString(),
    });
    wss?.clients?.forEach(c => {
      if (c.readyState === 1 && c._authenticated) try { c.send(payload); } catch {
        // client disconnected — expected
      }
    });
  };

  try {
    const status = checkSetupStatus();

    // Step 1: Install openclaw if not found
    if (!status.cliInstalled) {
      broadcast('install', 'Installing OpenClaw via npm...');
      await runCommand('npm', ['install', '-g', 'openclaw'], broadcast);
      broadcast('install', 'OpenClaw CLI installed.');
    }

    // Step 2: Run openclaw setup if no config
    if (!status.configExists) {
      broadcast('setup', 'Initializing OpenClaw configuration...');
      await runCommand('openclaw', ['setup', '--non-interactive'], broadcast);
      broadcast('setup', 'OpenClaw configuration initialized.');
    }

    // Step 3: Bootstrap department structure for command-center
    if (!status.deptConfigExists) {
      broadcast('departments', 'Creating default department structure...');
      bootstrapDepartments();
      broadcast('departments', 'Department structure created.');
    }

    // Step 4: Try starting gateway
    broadcast('gateway', 'Checking gateway status...');
    const gatewayRunning = await checkGateway();
    if (!gatewayRunning) {
      broadcast('gateway', 'Starting OpenClaw gateway...');
      await runCommand('openclaw', ['gateway', 'start'], broadcast);
      // Wait a moment for gateway to come up
      await new Promise(r => setTimeout(r, 2000));
      broadcast('gateway', 'Gateway started.');
    } else {
      broadcast('gateway', 'Gateway already running.');
    }

    // Reconnect command-center's gateway client with the newly configured token
    broadcast('connect', 'Connecting to Gateway...');
    try {
      const gw = getGateway();
      gw.disconnect();
      gw.shutdownRequested = false;
      await gw.connect();
      broadcast('connect', 'Gateway connection established.');
    } catch (gwErr) {
      broadcast('connect', `Gateway connect failed: ${gwErr.message} — will retry in background.`);
    }

    broadcast('done', 'OpenClaw setup complete! Reloading...', true);
    res.json({ success: true, message: 'Setup complete' });
  } catch (err) {
    log.error('Setup run failed', { error: err.message });
    broadcast('error', 'Setup failed. Check server logs for details.', true, true);
    res.status(500).json({ error: 'Setup failed' });
  }
});

// --- helpers ---

function checkSetupStatus() {
  let cliInstalled = false;
  let cliVersion = null;
  try {
    const result = execFileSync('openclaw', ['--version'], {
      encoding: 'utf8', timeout: 5000,
    }).trim();
    cliInstalled = true;
    cliVersion = result;
  } catch {
    // CLI not found — expected on first run
  }

  const configExists = fs.existsSync(CONFIG_PATH);
  const deptConfigExists = fs.existsSync(DEPT_CONFIG);
  const deptStatusExists = fs.existsSync(DEPT_STATUS);
  const bulletinExists = fs.existsSync(BULLETIN);

  let gatewayToken = false;
  if (configExists) {
    try {
      gatewayToken = !!getConfigValue('gateway.auth.token');
    } catch {
      // Config read failed — non-critical
    }
  }

  // Config + departments + gateway token = system is set up.
  // cliInstalled is informational only — PATH issues shouldn't block the UI.
  const ready = configExists && deptConfigExists && gatewayToken;

  return {
    ready,
    cliInstalled,
    cliVersion,
    configExists,
    gatewayToken,
    deptConfigExists,
    deptStatusExists,
    bulletinExists,
    openclawHome: !!OPENCLAW_HOME,
    workspace: !!BASE_PATH,
  };
}

function runCommand(cmd, args, broadcast) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      env: { ...process.env, FORCE_COLOR: '0' },
      timeout: 120000,
    });

    let output = '';
    proc.stdout?.on('data', (d) => {
      const line = d.toString().trim();
      if (line) {
        output += line + '\n';
        broadcast?.('log', line);
      }
    });
    proc.stderr?.on('data', (d) => {
      const line = d.toString().trim();
      if (line) output += line + '\n';
    });
    proc.on('close', (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(`${cmd} exited with code ${code}: ${output.slice(-200)}`));
    });
    proc.on('error', (err) => reject(err));
  });
}

function bootstrapDepartments() {
  // Create directories
  const dirs = [
    path.join(BASE_PATH, 'departments'),
    path.join(BASE_PATH, 'departments', 'bulletin'),
    path.join(BASE_PATH, 'departments', 'bulletin', 'requests'),
    path.join(BASE_PATH, 'departments', 'personas'),
    path.join(BASE_PATH, 'departments', 'meetings'),
    path.join(BASE_PATH, 'departments', 'memory'),
  ];
  for (const d of dirs) {
    fs.mkdirSync(d, { recursive: true });
  }

  // Default department config
  if (!fs.existsSync(DEPT_CONFIG)) {
    const defaultConfig = {
      departments: {
        coo: {
          name: 'Command',
          agent: 'COO',
          icon: 'bolt',
          color: '#fbbf24',
          order: 0,
          skills: ['*'],
          apiGroups: ['*'],
        },
        engineering: {
          name: 'Engineering',
          agent: 'CTO',
          icon: 'code',
          color: '#06b6d4',
          order: 1,
          skills: ['*'],
          apiGroups: ['*'],
        },
        operations: {
          name: 'Operations',
          agent: 'SRE',
          icon: 'server',
          color: '#eab308',
          order: 2,
          skills: ['*'],
          apiGroups: ['*'],
        },
        research: {
          name: 'Research',
          agent: 'Researcher',
          icon: 'search',
          color: '#22c55e',
          order: 3,
          skills: ['*'],
          apiGroups: ['*'],
        },
        product: {
          name: 'Product',
          agent: 'PM',
          icon: 'layout',
          color: '#a855f7',
          order: 4,
          skills: ['*'],
          apiGroups: ['*'],
        },
        admin: {
          name: 'Admin',
          agent: 'Admin',
          icon: 'clipboard',
          color: '#f97316',
          order: 5,
          skills: ['*'],
          apiGroups: ['*'],
        },
      },
      defaultDepartment: 'coo',
    };
    safeWriteFileSync(DEPT_CONFIG, JSON.stringify(defaultConfig, null, 2));
  }

  // Default status
  if (!fs.existsSync(DEPT_STATUS)) {
    const defaultStatus = { lastUpdated: new Date().toISOString(), agents: {} };
    safeWriteFileSync(DEPT_STATUS, JSON.stringify(defaultStatus, null, 2));
  }

  // Default bulletin
  if (!fs.existsSync(BULLETIN)) {
    safeWriteFileSync(BULLETIN, '# Bulletin Board\n\nWelcome to Command Center.\n');
  }
}

async function checkGateway() {
  try {
    const result = execFileSync('openclaw', ['health'], {
      encoding: 'utf8', timeout: 5000,
    });
    return result.includes('ok') || result.includes('running');
  } catch {
    return false;
  }
}

export default router;
export { checkSetupStatus };
