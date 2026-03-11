import express from 'express';
import fs from 'fs';
import path from 'path';
import nodemailer from 'nodemailer';
import { google } from 'googleapis';
import {
  getEncryptionKey,
  encryptSensitiveFields,
  decryptSensitiveFields,
  migratePlaintextFields,
} from '../crypto.js';
import { recordAudit } from './audit.js';
import { BASE_PATH, OPENCLAW_HOME, readJsonFile } from '../utils.js';

const router = express.Router();

const CONFIG_PATH = path.join(BASE_PATH, '..', 'command-center', 'integrations.json');
const OPENCLAW_CONFIG = path.join(OPENCLAW_HOME, 'openclaw.json');
const VALID_SERVICES = ['gmail', 'drive', 'voice', 'webhook'];

// Default configuration structure
const DEFAULT_CONFIG = {
  gmail: { enabled: false, email: '', appPassword: '' },
  drive: { enabled: false, serviceAccountKey: null, folderId: null },
  voice: { enabled: true, source: 'openclaw', apiKeyOverride: null },
  webhook: { enabled: false, url: '', platform: 'custom', events: ['error', 'backup'] },
  autoBackup: { enabled: false, schedule: 'daily', time: '03:00', lastRun: null }
};

/**
 * Helper: Write JSON file safely with optional backup rotation
 */
function writeJsonFile(filePath, data, { backup = false } = {}) {
  try {
    if (backup && fs.existsSync(filePath)) {
      const dir = path.dirname(filePath);
      const base = path.basename(filePath, '.json');
      // Rotate: .bak.3 → delete, .bak.2 → .bak.3, .bak.1 → .bak.2
      for (let i = 3; i >= 1; i--) {
        const bakPath = path.join(dir, `${base}.bak.${i}`);
        if (i === 3 && fs.existsSync(bakPath)) {
          fs.unlinkSync(bakPath);
        } else if (fs.existsSync(bakPath)) {
          fs.renameSync(bakPath, path.join(dir, `${base}.bak.${i + 1}`));
        }
      }
      // Current → .bak.1
      fs.copyFileSync(filePath, path.join(dir, `${base}.bak.1`));
    }
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error(`[IntegrationsConfig] Error writing JSON file ${filePath}:`, error.message);
    return false;
  }
}

/**
 * Helper: Get config with defaults — decrypts sensitive fields on read
 */
function getConfig() {
  let config = readJsonFile(CONFIG_PATH);
  if (!config) {
    config = DEFAULT_CONFIG;
    writeJsonFile(CONFIG_PATH, config);
  }
  // Ensure all services exist
  for (const service of VALID_SERVICES) {
    if (!config[service]) {
      config[service] = DEFAULT_CONFIG[service];
    }
  }

  // Auto-migrate any legacy plaintext credentials → encrypted
  const key = getEncryptionKey();
  const migrated = migratePlaintextFields(config, key);
  if (migrated > 0) {
    console.log(`[Crypto] Migrated ${migrated} plaintext credential(s) to encrypted storage`);
    writeJsonFile(CONFIG_PATH, config, { backup: true });
  }

  // Decrypt for in-memory use
  decryptSensitiveFields(config, key);
  return config;
}

/**
 * Helper: Encrypt sensitive fields and write config to disk with backup
 */
function saveConfig(config) {
  // Deep clone to avoid mutating the in-memory copy
  const toWrite = JSON.parse(JSON.stringify(config));
  const key = getEncryptionKey();
  encryptSensitiveFields(toWrite, key);
  return writeJsonFile(CONFIG_PATH, toWrite, { backup: true });
}

/**
 * Helper: Mask sensitive fields in response
 */
function maskSensitiveFields(config) {
  const masked = JSON.parse(JSON.stringify(config));

  // Gmail
  if (masked.gmail) {
    if (masked.gmail.appPassword) {
      masked.gmail.hasAppPassword = true;
      delete masked.gmail.appPassword;
    } else {
      masked.gmail.hasAppPassword = false;
    }
  }

  // Drive
  if (masked.drive) {
    if (masked.drive.serviceAccountKey) {
      masked.drive.hasServiceAccountKey = true;
      delete masked.drive.serviceAccountKey;
    } else {
      masked.drive.hasServiceAccountKey = false;
    }
  }

  // Voice
  if (masked.voice) {
    if (masked.voice.apiKeyOverride) {
      masked.voice.hasApiKeyOverride = true;
      delete masked.voice.apiKeyOverride;
    } else {
      masked.voice.hasApiKeyOverride = false;
    }
  }

  // Webhook
  if (masked.webhook) {
    if (masked.webhook.url) {
      masked.webhook.hasUrl = true;
      masked.webhook.urlPreview = masked.webhook.url.substring(0, 30) + (masked.webhook.url.length > 30 ? '...' : '');
      delete masked.webhook.url;
    } else {
      masked.webhook.hasUrl = false;
      masked.webhook.urlPreview = '';
    }
  }

  return masked;
}

/**
 * GET /integrations/config
 * Return all integration configurations with sensitive fields masked
 */
router.get('/integrations/config', (req, res) => {
  try {
    const config = getConfig();
    const masked = maskSensitiveFields(config);
    res.json(masked);
  } catch (error) {
    console.error('[IntegrationsConfig] Error in GET /integrations/config:', error);
    res.status(500).json({ error: 'Failed to fetch integrations config' });
  }
});

/**
 * PUT /integrations/config/:service
 * Update a specific integration service configuration
 */
router.put('/integrations/config/:service', (req, res) => {
  try {
    const { service } = req.params;

    if (!VALID_SERVICES.includes(service)) {
      return res.status(400).json({ error: `Invalid service. Must be one of: ${VALID_SERVICES.join(', ')}` });
    }

    const config = getConfig();
    const updates = req.body;

    // Validate based on service type
    if (service === 'gmail') {
      if (updates.email !== undefined && typeof updates.email !== 'string') {
        return res.status(400).json({ error: 'email must be a string' });
      }
      if (updates.appPassword !== undefined && typeof updates.appPassword !== 'string') {
        return res.status(400).json({ error: 'appPassword must be a string' });
      }
      if (updates.enabled !== undefined && typeof updates.enabled !== 'boolean') {
        return res.status(400).json({ error: 'enabled must be a boolean' });
      }
    } else if (service === 'drive') {
      if (updates.serviceAccountKey !== undefined && updates.serviceAccountKey !== null) {
        if (typeof updates.serviceAccountKey !== 'object') {
          return res.status(400).json({ error: 'serviceAccountKey must be an object' });
        }
        if (!updates.serviceAccountKey.client_email || !updates.serviceAccountKey.private_key) {
          return res.status(400).json({ error: 'serviceAccountKey must contain client_email and private_key' });
        }
      }
      if (updates.enabled !== undefined && typeof updates.enabled !== 'boolean') {
        return res.status(400).json({ error: 'enabled must be a boolean' });
      }
    } else if (service === 'voice') {
      if (updates.apiKeyOverride !== undefined && updates.apiKeyOverride !== null && typeof updates.apiKeyOverride !== 'string') {
        return res.status(400).json({ error: 'apiKeyOverride must be a string or null' });
      }
      if (updates.enabled !== undefined && typeof updates.enabled !== 'boolean') {
        return res.status(400).json({ error: 'enabled must be a boolean' });
      }
    } else if (service === 'webhook') {
      if (updates.url !== undefined && typeof updates.url !== 'string') {
        return res.status(400).json({ error: 'url must be a string' });
      }
      if (updates.platform !== undefined && !['discord', 'slack', 'feishu', 'custom'].includes(updates.platform)) {
        return res.status(400).json({ error: 'platform must be one of: discord, slack, feishu, custom' });
      }
      if (updates.events !== undefined && !Array.isArray(updates.events)) {
        return res.status(400).json({ error: 'events must be an array' });
      }
      if (updates.enabled !== undefined && typeof updates.enabled !== 'boolean') {
        return res.status(400).json({ error: 'enabled must be a boolean' });
      }
    }

    // Merge updates
    config[service] = { ...config[service], ...updates };

    // Write back to file
    const success = saveConfig(config);
    if (!success) {
      return res.status(500).json({ error: 'Failed to save configuration' });
    }

    recordAudit({ action: 'credential.update', target: service, details: { fields: Object.keys(updates) }, ip: req.ip });
    const masked = maskSensitiveFields(config);
    res.json({ success: true, config: masked[service] });
  } catch (error) {
    console.error(`[IntegrationsConfig] Error in PUT /integrations/config/${req.params.service}:`, error);
    res.status(500).json({ error: 'Failed to update integration config' });
  }
});

/**
 * POST /integrations/config/:service/test
 * Test connection for a specific integration service
 */
router.post('/integrations/config/:service/test', async (req, res) => {
  try {
    const { service } = req.params;

    if (!VALID_SERVICES.includes(service)) {
      return res.status(400).json({ error: `Invalid service. Must be one of: ${VALID_SERVICES.join(', ')}` });
    }

    const config = getConfig();

    if (service === 'gmail') {
      const { email, appPassword } = config.gmail;
      if (!email || !appPassword) {
        return res.status(400).json({ error: 'Gmail not configured. Please set email and appPassword.' });
      }

      try {
        const transporter = nodemailer.createTransport({
          service: 'gmail',
          auth: {
            user: email,
            pass: appPassword
          }
        });

        await transporter.verify();
        res.json({ success: true, message: 'Gmail connection successful' });
      } catch (error) {
        console.error('[IntegrationsConfig] Gmail test failed:', error);
        res.status(502).json({ error: 'Gmail connection failed', detail: error.message });
      }
    } else if (service === 'drive') {
      const { serviceAccountKey } = config.drive;
      if (!serviceAccountKey) {
        return res.status(400).json({ error: 'Drive not configured. Please set serviceAccountKey.' });
      }

      try {
        const auth = new google.auth.GoogleAuth({
          credentials: serviceAccountKey,
          scopes: ['https://www.googleapis.com/auth/drive.file']
        });

        await auth.getClient();
        res.json({ success: true, message: 'Google Drive connection successful' });
      } catch (error) {
        console.error('[IntegrationsConfig] Drive test failed:', error);
        res.status(502).json({ error: 'Drive connection failed', detail: error.message });
      }
    } else if (service === 'webhook') {
      const { url, platform } = config.webhook || {};
      if (!url) {
        return res.status(400).json({ error: 'Webhook URL not configured' });
      }

      try {
        let body;
        const p = platform || 'custom';
        if (p === 'discord') {
          body = JSON.stringify({ content: '[Command Center] Test notification' });
        } else if (p === 'slack') {
          body = JSON.stringify({ text: '[Command Center] Test notification' });
        } else if (p === 'feishu') {
          body = JSON.stringify({ msg_type: 'text', content: { text: '[Command Center] Test notification' } });
        } else {
          body = JSON.stringify({ event: 'test', message: '[Command Center] Test notification', timestamp: new Date().toISOString() });
        }

        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        });

        if (!response.ok && response.status !== 204) {
          throw new Error(`Webhook returned ${response.status}`);
        }
        res.json({ success: true, message: 'Webhook test sent successfully' });
      } catch (error) {
        console.error('[IntegrationsConfig] Webhook test failed:', error);
        res.status(502).json({ error: 'Webhook test failed', detail: error.message });
      }
    } else if (service === 'voice') {
      // Get API key (from config override or openclaw.json)
      let apiKey = config.voice.apiKeyOverride;
      if (!apiKey) {
        const openclawConfig = readJsonFile(OPENCLAW_CONFIG);
        apiKey = openclawConfig?.skills?.entries?.['openai-whisper-api']?.apiKey;
      }

      if (!apiKey) {
        return res.status(400).json({ error: 'Voice API key not found. Set apiKeyOverride or configure openai-whisper-api skill.' });
      }

      try {
        // Make a small test request to OpenAI API
        const response = await fetch('https://api.openai.com/v1/models', {
          headers: {
            'Authorization': `Bearer ${apiKey}`
          }
        });

        if (!response.ok) {
          throw new Error(`API returned ${response.status}: ${response.statusText}`);
        }

        res.json({ success: true, message: 'OpenAI Whisper API connection successful' });
      } catch (error) {
        console.error('[IntegrationsConfig] Voice test failed:', error);
        res.status(502).json({ error: 'Voice API connection failed', detail: error.message });
      }
    }
  } catch (error) {
    console.error(`[IntegrationsConfig] Error in POST /integrations/config/${req.params.service}/test:`, error);
    res.status(500).json({ error: 'Test connection failed' });
  }
});

/**
 * DELETE /integrations/config/:service
 * Reset service configuration to defaults
 */
router.delete('/integrations/config/:service', (req, res) => {
  try {
    const { service } = req.params;

    if (!VALID_SERVICES.includes(service)) {
      return res.status(400).json({ error: `Invalid service. Must be one of: ${VALID_SERVICES.join(', ')}` });
    }

    const config = getConfig();
    config[service] = DEFAULT_CONFIG[service];

    const success = saveConfig(config);
    if (!success) {
      return res.status(500).json({ error: 'Failed to reset configuration' });
    }

    res.json({ success: true, message: `${service} configuration reset to defaults` });
  } catch (error) {
    console.error(`[IntegrationsConfig] Error in DELETE /integrations/config/${req.params.service}:`, error);
    res.status(500).json({ error: 'Failed to reset integration config' });
  }
});

// ================================================
// Feature 5: Auto Backup Schedule
// ================================================

/**
 * GET /integrations/autobackup
 * Return autobackup config + lastRun/nextRun
 */
router.get('/integrations/autobackup', (req, res) => {
  try {
    const config = getConfig();
    const ab = config.autoBackup || DEFAULT_CONFIG.autoBackup;

    // Calculate nextRun
    let nextRun = null;
    if (ab.enabled && ab.time) {
      const [hh, mm] = ab.time.split(':').map(Number);
      const now = new Date();
      const next = new Date(now);
      next.setHours(hh, mm, 0, 0);
      if (next <= now) next.setDate(next.getDate() + 1);
      if (ab.schedule === 'weekly') {
        // Next Monday
        while (next.getDay() !== 1) next.setDate(next.getDate() + 1);
      }
      nextRun = next.toISOString();
    }

    res.json({
      enabled: ab.enabled || false,
      schedule: ab.schedule || 'daily',
      time: ab.time || '03:00',
      lastRun: ab.lastRun || null,
      nextRun,
    });
  } catch (error) {
    console.error('[IntegrationsConfig] GET /integrations/autobackup error:', error);
    res.status(500).json({ error: 'Failed to fetch autobackup config' });
  }
});

/**
 * PUT /integrations/autobackup
 * Update autobackup config
 */
router.put('/integrations/autobackup', (req, res) => {
  try {
    const config = getConfig();
    if (!config.autoBackup) config.autoBackup = { ...DEFAULT_CONFIG.autoBackup };

    const { enabled, schedule, time } = req.body;

    if (enabled !== undefined) config.autoBackup.enabled = !!enabled;
    if (schedule !== undefined) {
      if (!['daily', 'weekly'].includes(schedule)) {
        return res.status(400).json({ error: 'schedule must be "daily" or "weekly"' });
      }
      config.autoBackup.schedule = schedule;
    }
    if (time !== undefined) {
      if (typeof time !== 'string' || !/^\d{2}:\d{2}$/.test(time)) {
        return res.status(400).json({ error: 'time must be in HH:MM format' });
      }
      config.autoBackup.time = time;
    }

    if (!saveConfig(config)) {
      return res.status(500).json({ error: 'Failed to save config' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('[IntegrationsConfig] PUT /integrations/autobackup error:', error);
    res.status(500).json({ error: 'Failed to update autobackup config' });
  }
});

/**
 * POST /integrations/autobackup/run
 * Execute backup now
 */
router.post('/integrations/autobackup/run', async (req, res) => {
  try {
    const result = await runAutoBackup();
    if (result.success) {
      res.json(result);
    } else {
      res.status(500).json(result);
    }
  } catch (error) {
    console.error('[IntegrationsConfig] POST /integrations/autobackup/run error:', error);
    res.status(500).json({ error: 'Backup failed' });
  }
});

/**
 * Execute auto backup using existing Drive backup logic
 */
async function runAutoBackup() {
  const config = getConfig();
  const driveConfig = config.drive;

  if (!driveConfig?.enabled || !driveConfig?.serviceAccountKey) {
    return { success: false, error: 'Google Drive not configured or disabled' };
  }

  try {
    // Call the drive backup endpoint internally
    const { google: googleapis } = await import('googleapis');
    const auth = new googleapis.auth.GoogleAuth({
      credentials: driveConfig.serviceAccountKey,
      scopes: ['https://www.googleapis.com/auth/drive.file'],
    });
    const drive = googleapis.drive({ version: 'v3', auth });

    // Get or create backup folder
    let folderId = driveConfig.folderId;
    if (!folderId) {
      const folder = await drive.files.create({
        resource: { name: 'CommandCenter-Backups', mimeType: 'application/vnd.google-apps.folder' },
        fields: 'id',
      });
      folderId = folder.data.id;
      config.drive.folderId = folderId;
    }

    const deptConfigPath = path.join(BASE_PATH, 'departments', 'config.json');
    const deptConfig = readJsonFile(deptConfigPath);
    const departments = deptConfig?.departments || {};
    const deptIds = Object.keys(departments);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const files = [];

    const DEPARTMENTS_PATH = path.join(BASE_PATH, 'departments');

    for (const id of deptIds) {
      const deptPath = `${DEPARTMENTS_PATH}/${id}`;
      if (!fs.existsSync(deptPath)) continue;

      let content = `# Backup for ${id} - ${timestamp}\n\n`;
      const memoryPath = `${deptPath}/memory/MEMORY.md`;
      if (fs.existsSync(memoryPath)) {
        content += `## MEMORY.md\n\n${fs.readFileSync(memoryPath, 'utf8')}\n\n---\n\n`;
      }

      const dailyPath = `${deptPath}/daily`;
      if (fs.existsSync(dailyPath)) {
        const dailyFiles = fs.readdirSync(dailyPath).filter(f => f.endsWith('.md')).sort().reverse().slice(0, 10);
        for (const df of dailyFiles) {
          content += `## Daily Log: ${df}\n\n${fs.readFileSync(`${dailyPath}/${df}`, 'utf8')}\n\n---\n\n`;
        }
      }

      const filename = `${id}_backup_${timestamp}.md`;
      const file = await drive.files.create({
        resource: { name: filename, parents: [folderId] },
        media: { mimeType: 'text/markdown', body: Buffer.from(content, 'utf8') },
        fields: 'id, name',
      });

      files.push({ deptId: id, fileId: file.data.id, fileName: file.data.name });
    }

    // Update lastRun
    if (!config.autoBackup) config.autoBackup = { ...DEFAULT_CONFIG.autoBackup };
    config.autoBackup.lastRun = new Date().toISOString();
    saveConfig(config);

    console.log(`[AutoBackup] Completed: ${files.length} departments backed up`);
    return { success: true, files };
  } catch (error) {
    console.error('[AutoBackup] Failed:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Check if it's time to run auto backup (called every 60s from index.js)
 */
export async function checkAutoBackup() {
  try {
    const config = getConfig();
    const ab = config.autoBackup;
    if (!ab?.enabled || !ab?.time) return;

    const now = new Date();
    const [hh, mm] = ab.time.split(':').map(Number);

    if (now.getHours() !== hh || now.getMinutes() !== mm) return;

    // Weekly: only on Monday (day 1)
    if (ab.schedule === 'weekly' && now.getDay() !== 1) return;

    // Prevent running twice in the same minute
    if (ab.lastRun) {
      const lastRun = new Date(ab.lastRun);
      const diffMs = now.getTime() - lastRun.getTime();
      if (diffMs < 120000) return; // Less than 2 minutes since last run
    }

    console.log('[AutoBackup] Scheduled backup starting...');
    await runAutoBackup();
  } catch (error) {
    console.error('[AutoBackup] Check failed:', error.message);
  }
}

export default router;
