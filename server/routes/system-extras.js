import express from 'express';
import fs from 'fs';
import path from 'path';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { OPENCLAW_HOME, BASE_PATH, safeWriteFileSync, validateDepartmentId } from '../utils.js';
import { recordAudit } from './audit.js';
import { verifyPassword, getStoredPassword } from '../auth.js';
import { createLogger } from '../logger.js';

const log = createLogger('SystemExtras');
const router = express.Router();
const execFileAsync = promisify(execFile);

/**
 * Helper: Mask sensitive tokens (first 8 chars + "...")
 */
function maskToken(token) {
  if (!token || typeof token !== 'string') return null;
  if (token.length <= 12) return '***';
  return token.substring(0, 8) + '...';
}

/**
 * POST /system/observer
 * Trigger memory observer/reflector scripts
 */
router.post('/system/observer', async (req, res) => {
  try {
    log.info('POST /system/observer - triggering observer/reflector');

    const results = { success: true, output: [] };
    const observerPath = path.join(OPENCLAW_HOME, 'cron', 'observer.sh');
    const reflectorPath = path.join(OPENCLAW_HOME, 'cron', 'reflector.sh');

    // Run observer.sh if it exists
    if (fs.existsSync(observerPath)) {
      try {
        log.info(`Running observer: ${observerPath}`);
        const { stdout, stderr } = await execFileAsync('bash', [observerPath], {
          timeout: 30000,
          cwd: path.dirname(observerPath),
        });
        results.output.push({
          script: 'observer.sh',
          success: true,
          lines: stdout.trim().split('\n').length,
        });
      } catch (error) {
        log.error('observer.sh failed: ' + error.message);
        results.output.push({
          script: 'observer.sh',
          success: false,
          error: 'Script execution failed',
        });
        results.success = false;
      }
    } else {
      results.output.push({
        script: 'observer.sh',
        success: false,
        error: 'Script not found',
      });
    }

    // Run reflector.sh if it exists
    if (fs.existsSync(reflectorPath)) {
      try {
        log.info(`Running reflector: ${reflectorPath}`);
        const { stdout, stderr } = await execFileAsync('bash', [reflectorPath], {
          timeout: 30000,
          cwd: path.dirname(reflectorPath),
        });
        results.output.push({
          script: 'reflector.sh',
          success: true,
          lines: stdout.trim().split('\n').length,
        });
      } catch (error) {
        log.error('reflector.sh failed: ' + error.message);
        results.output.push({
          script: 'reflector.sh',
          success: false,
          error: 'Script execution failed',
        });
        results.success = false;
      }
    } else {
      results.output.push({
        script: 'reflector.sh',
        success: false,
        error: 'Script not found',
      });
    }

    res.json(results);
  } catch (error) {
    log.error('POST /system/observer error: ' + error.message);
    res.status(500).json({ success: false, error: 'Observer execution failed' });
  }
});

/**
 * GET /system/sessions
 * List active agent sessions
 */
router.get('/system/sessions', (req, res) => {
  try {
    log.info('GET /system/sessions');

    const sessionsDir = path.join(OPENCLAW_HOME, 'agents', 'main', 'sessions');
    const sessions = [];

    if (!fs.existsSync(sessionsDir)) {
      log.warn('Sessions directory does not exist: ' + sessionsDir);
      return res.json({ sessions: [] });
    }

    const entries = fs.readdirSync(sessionsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const sessionId = entry.name;
      const sessionPath = path.join(sessionsDir, sessionId);

      // Get directory stats
      const stats = fs.statSync(sessionPath);

      // Look for metadata files (.json or .md)
      const files = fs.readdirSync(sessionPath);
      let name = sessionId;
      let metadata = {};

      for (const file of files) {
        if (file.endsWith('.json')) {
          try {
            const jsonPath = path.join(sessionPath, file);
            const content = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
            metadata = { ...metadata, ...content };
            if (content.name) name = content.name;
          } catch (err) {
            log.error(`Error reading ${file}: ` + err.message);
          }
        } else if (file.endsWith('.md')) {
          try {
            const mdPath = path.join(sessionPath, file);
            const content = fs.readFileSync(mdPath, 'utf8');
            // Extract title from markdown if present
            const titleMatch = content.match(/^#\s+(.+)$/m);
            if (titleMatch && !metadata.name) {
              name = titleMatch[1];
            }
          } catch (err) {
            log.error(`Error reading ${file}: ` + err.message);
          }
        }
      }

      sessions.push({
        id: sessionId,
        name,
        lastModified: stats.mtime.toISOString(),
        size: stats.size,
        metadata,
      });
    }

    // Sort by lastModified descending
    sessions.sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));

    log.info(`Found ${sessions.length} sessions`);
    res.json({ sessions });
  } catch (error) {
    log.error('GET /system/sessions error: ' + error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /system/devices
 * List paired devices with masked tokens
 */
router.get('/system/devices', (req, res) => {
  try {
    log.info('GET /system/devices');

    const devicesPath = path.join(OPENCLAW_HOME, 'devices', 'paired.json');

    if (!fs.existsSync(devicesPath)) {
      log.warn('Devices file does not exist: ' + devicesPath);
      return res.json({ devices: [] });
    }

    const content = fs.readFileSync(devicesPath, 'utf8');
    const devicesData = JSON.parse(content);

    // Handle array, { devices: [...] }, and { hash: device, ... } formats
    let devicesList;
    if (Array.isArray(devicesData)) {
      devicesList = devicesData;
    } else if (Array.isArray(devicesData.devices)) {
      devicesList = devicesData.devices;
    } else {
      // Object keyed by device hash — extract values
      devicesList = Object.values(devicesData);
    }

    // Normalize and mask sensitive fields
    const maskedDevices = devicesList.map(device => ({
      id: device.clientId || device.id || device.deviceId || 'unknown',
      name: device.displayName || device.clientId || device.name || device.id || 'unknown',
      mode: device.clientMode || device.mode || '',
      protocol: device.protocol || 0,
      tokenPreview: device.token ? maskToken(device.token) : undefined,
    }));

    log.info(`Found ${maskedDevices.length} devices`);
    res.json({ devices: maskedDevices });
  } catch (error) {
    log.error('GET /system/devices error: ' + error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /departments/:id/persona
 * Read department persona markdown
 */
router.get('/departments/:id/persona', (req, res) => {
  try {
    const { id } = req.params;
    // H17 Fix: Use shared validation
    if (!validateDepartmentId(id)) {
      return res.status(400).json({ error: 'Invalid department ID' });
    }
    log.info(`GET /departments/${id}/persona`);

    // Try canonical path first (what agent.js reads from)
    let personaPath = path.join(BASE_PATH, 'departments', 'personas', `${id}.md`);

    if (!fs.existsSync(personaPath)) {
      // Try fallback path
      personaPath = path.join(BASE_PATH, 'departments', id, 'personas', 'persona.md');
    }

    if (!fs.existsSync(personaPath)) {
      log.warn('Persona not found: ' + personaPath);
      return res.status(404).json({ error: 'Persona not found' });
    }

    const content = fs.readFileSync(personaPath, 'utf8');
    log.info(`Read persona from ${personaPath} (${content.length} chars)`);

    res.json({ content });
  } catch (error) {
    log.error('GET /departments/:id/persona error: ' + error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PUT /departments/:id/persona
 * Save department persona markdown
 */
router.put('/departments/:id/persona', (req, res) => {
  try {
    const { id } = req.params;
    // H17 Fix: Use shared validation
    if (!validateDepartmentId(id)) {
      return res.status(400).json({ error: 'Invalid department ID' });
    }
    const { content } = req.body;

    if (typeof content !== 'string') {
      return res.status(400).json({ error: 'content must be a string' });
    }
    const size = Buffer.byteLength(content, 'utf8');
    if (size > 10240) {
      return res.status(413).json({
        error: `Persona content too large: ${(size / 1024).toFixed(2)} KB exceeds 10 KB limit`
      });
    }

    log.info(`PUT /departments/${id}/persona (${content.length} chars)`);

    // Always write to the canonical path that agent.js reads from
    const personaPath = path.join(BASE_PATH, 'departments', 'personas', `${id}.md`);
    const personaDir = path.dirname(personaPath);
    if (!fs.existsSync(personaDir)) {
      fs.mkdirSync(personaDir, { recursive: true });
    }

    safeWriteFileSync(personaPath, content);
    log.info(`Wrote persona to ${personaPath}`);

    recordAudit({ action: 'persona:update', target: id, deptId: id, ip: req.ip });
    res.json({ success: true });
  } catch (error) {
    log.error('PUT /departments/:id/persona error: ' + error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /system/openclaw/version
 * Check current and latest OpenClaw version
 */
router.get('/system/openclaw/version', async (req, res) => {
  try {
    let current = null;
    try {
      const { stdout } = await execFileAsync('openclaw', ['--version'], { timeout: 5000 });
      // Parse "OpenClaw 2026.3.11 (29dc654)" → "2026.3.11"
      const match = stdout.trim().match(/(\d+\.\d+\.\d+)/);
      current = match ? match[1] : stdout.trim();
    } catch {
      // Version check failed — non-critical
    }

    let latest = null;
    try {
      const { stdout } = await execFileAsync('npm', ['view', 'openclaw', 'version'], { timeout: 10000 });
      latest = stdout.trim();
    } catch {
      // npm registry check failed — non-critical
    }

    const updateAvailable = !!(current && latest && current !== latest);
    res.json({ current, latest, updateAvailable });
  } catch (error) {
    log.error('GET /system/openclaw/version error: ' + error.message);
    res.status(500).json({ error: 'Failed to check version' });
  }
});

/**
 * POST /system/openclaw/update
 * Update OpenClaw via `openclaw update --yes --json`
 * Streams progress via WebSocket broadcast
 */
router.post('/system/openclaw/update', async (req, res) => {
  const wss = req.app.locals.wss;
  const broadcast = (message, done = false, error = false) => {
    const payload = JSON.stringify({
      event: 'openclaw:update',
      data: { message, done, error },
      timestamp: new Date().toISOString(),
    });
    wss?.clients?.forEach(c => {
      if (c.readyState === 1 && c._authenticated) try { c.send(payload); } catch {
        // client disconnected — expected
      }
    });
  };

  try {
    broadcast('Starting OpenClaw update...');

    const result = await new Promise((resolve, reject) => {
      const proc = spawn('openclaw', ['update', '--yes', '--no-restart'], {
        env: { ...process.env, FORCE_COLOR: '0' },
        timeout: 300000,
      });

      let output = '';
      proc.stdout?.on('data', (d) => {
        const line = d.toString().trim();
        if (line) {
          output += line + '\n';
          broadcast(line);
        }
      });
      proc.stderr?.on('data', (d) => {
        const line = d.toString().trim();
        if (line) {
          output += line + '\n';
          broadcast(line);
        }
      });
      proc.on('close', (code) => {
        if (code === 0) resolve(output);
        else reject(new Error(`openclaw update exited with code ${code}`));
      });
      proc.on('error', (err) => reject(err));
    });

    // Get new version after update
    let newVersion = null;
    try {
      const { stdout } = await execFileAsync('openclaw', ['--version'], { timeout: 5000 });
      newVersion = stdout.trim();
    } catch {
      // Version check failed — non-critical
    }

    // Restart gateway separately (we used --no-restart to avoid killing PM2)
    broadcast('Restarting gateway...');
    try {
      await execFileAsync('openclaw', ['gateway', 'restart'], { timeout: 30000 });
      broadcast('Gateway restarted.');
    } catch (gwErr) {
      broadcast(`Gateway restart failed: ${gwErr.message}`);
    }

    // Reconnect command-center's gateway client
    try {
      const { getGateway } = await import('../gateway.js');
      const gw = getGateway();
      gw.disconnect();
      gw.shutdownRequested = false;
      await new Promise(r => setTimeout(r, 2000));
      await gw.connect();
      broadcast('Gateway client reconnected.');
    } catch (gwErr) {
      log.warn('Gateway reconnect failed: ' + gwErr.message);
    }

    broadcast(`Update complete! Version: ${newVersion || 'unknown'}`, true);
    res.json({ success: true, version: newVersion, output: result });
  } catch (error) {
    log.error('POST /system/openclaw/update error: ' + error.message);
    broadcast(`Update failed: ${error.message}`, true, true);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /system/shutdown
 * Gracefully shut down the Command Center server.
 * Sends a response first, then exits after a short delay.
 */
router.post('/system/shutdown', async (req, res) => {
  const { confirm, password } = req.body || {};
  if (confirm !== 'SHUTDOWN') {
    return res.status(400).json({ error: 'Must send { "confirm": "SHUTDOWN" } to confirm' });
  }

  // H26 Fix: Require password re-confirmation for shutdown
  if (!password || typeof password !== 'string') {
    return res.status(400).json({ error: 'Password required for shutdown confirmation' });
  }
  const storedPassword = getStoredPassword();
  if (!storedPassword || !verifyPassword(password, storedPassword)) {
    return res.status(403).json({ error: 'Invalid password' });
  }

  log.info('POST /system/shutdown — shutting down server');
  recordAudit({ action: 'system:shutdown', target: 'server', ip: req.ip });
  res.json({ success: true, message: 'Server shutting down' });

  // Give time for the response to flush, then exit
  setTimeout(() => {
    log.info('Shutdown requested via API, exiting...');
    process.exit(0);
  }, 500);
});

export default router;
