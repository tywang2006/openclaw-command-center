import express from 'express';
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import nodemailer from 'nodemailer';
import { google } from 'googleapis';
import crypto from 'node:crypto';
import {
  getEncryptionKey,
  encryptSensitiveFields,
  decryptSensitiveFields,
  migratePlaintextFields,
} from '../crypto.js';
import { recordAudit } from './audit.js';
import { BASE_PATH, OPENCLAW_HOME, readJsonFile, safeWriteFileSync } from '../utils.js';

// OAuth CSRF state tokens (expire after 10 minutes)
const oauthStates = new Map();

const router = express.Router();

const CONFIG_PATH = path.join(BASE_PATH, '..', 'command-center', 'integrations.json');
const OPENCLAW_CONFIG = path.join(OPENCLAW_HOME, 'openclaw.json');
const VALID_SERVICES = ['gmail', 'drive', 'voice', 'webhook', 'gogcli', 'google-sheets'];

// Default configuration structure
const DEFAULT_CONFIG = {
  gmail: { enabled: false, email: '', appPassword: '' },
  drive: { enabled: false, serviceAccountKey: null, folderId: null },
  voice: { enabled: true, source: 'openclaw', apiKeyOverride: null },
  webhook: { enabled: false, url: '', platform: 'custom', events: ['error', 'backup'] },
  gogcli: { enabled: false, clientCredentials: null, account: '' },
  'google-sheets': { enabled: false, serviceAccountKey: null, defaultSpreadsheetId: '' },
  autoBackup: { enabled: false, schedule: 'daily', time: '03:00', lastRun: null }
};

// Simple write lock to prevent concurrent file corruption
let _writeLock = Promise.resolve();

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
  // Serialize writes to prevent concurrent corruption
  _writeLock = _writeLock.then(() => {
    const toWrite = JSON.parse(JSON.stringify(config));
    const key = getEncryptionKey();
    encryptSensitiveFields(toWrite, key);
    return writeJsonFile(CONFIG_PATH, toWrite, { backup: true });
  }).catch(err => {
    console.error('[IntegrationsConfig] saveConfig lock error:', err.message);
    return false;
  });
  return _writeLock;
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

  // gogcli
  if (masked.gogcli) {
    if (masked.gogcli.clientCredentials) {
      masked.gogcli.hasClientCredentials = true;
      delete masked.gogcli.clientCredentials;
    } else {
      masked.gogcli.hasClientCredentials = false;
    }
  }

  // google-sheets
  if (masked['google-sheets']) {
    if (masked['google-sheets'].serviceAccountKey) {
      masked['google-sheets'].hasServiceAccountKey = true;
      delete masked['google-sheets'].serviceAccountKey;
    } else {
      masked['google-sheets'].hasServiceAccountKey = false;
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

    console.log(`[IntegrationsConfig] PUT ${service}:`, JSON.stringify(Object.keys(updates)), 'serviceAccountKey type:', typeof updates.serviceAccountKey);

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
    } else if (service === 'gogcli') {
      if (updates.clientCredentials !== undefined && updates.clientCredentials !== null) {
        if (typeof updates.clientCredentials !== 'object') {
          return res.status(400).json({ error: 'clientCredentials must be an object (OAuth client JSON)' });
        }
      }
      if (updates.account !== undefined && typeof updates.account !== 'string') {
        return res.status(400).json({ error: 'account must be a string (email)' });
      }
      if (updates.enabled !== undefined && typeof updates.enabled !== 'boolean') {
        return res.status(400).json({ error: 'enabled must be a boolean' });
      }
    } else if (service === 'google-sheets') {
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

      // Try multiple SMTP configurations (465 may be blocked by firewall)
      const smtpConfigs = [
        { host: 'smtp.gmail.com', port: 587, secure: false, label: 'port 587 (STARTTLS)' },
        { host: 'smtp.gmail.com', port: 465, secure: true, label: 'port 465 (SSL)' },
      ];

      let lastError = null;
      for (const smtp of smtpConfigs) {
        try {
          const transporter = nodemailer.createTransport({
            host: smtp.host,
            port: smtp.port,
            secure: smtp.secure,
            auth: { user: email, pass: appPassword },
            connectionTimeout: 10000,
          });
          await transporter.verify();
          return res.json({ success: true, message: `Gmail connection successful (${smtp.label})` });
        } catch (error) {
          console.log(`[IntegrationsConfig] Gmail test via ${smtp.label} failed: ${error.message}`);
          lastError = error;
        }
      }
      console.error('[IntegrationsConfig] Gmail test failed on all ports:', lastError);
      res.status(502).json({ error: 'Gmail connection failed', detail: lastError.message });
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
    } else if (service === 'gogcli') {
      const { clientCredentials } = config.gogcli || {};
      if (!clientCredentials) {
        return res.status(400).json({ error: 'Please upload OAuth Client Credentials JSON first', detail: 'step:upload' });
      }
      // Check if we already have tokens
      const tokenPath = path.join(OPENCLAW_HOME, 'gogcli-tokens.json');
      if (fs.existsSync(tokenPath)) {
        try {
          const tokens = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
          if (tokens.access_token) {
            // Verify token still works
            const resp = await fetch('https://www.googleapis.com/oauth2/v1/userinfo?alt=json', {
              headers: { 'Authorization': `Bearer ${tokens.access_token}` }
            });
            if (resp.ok) {
              const info = await resp.json();
              return res.json({ success: true, message: `Authenticated as ${info.email || info.name || 'OK'}` });
            }
            // Token expired, try refresh
            if (tokens.refresh_token) {
              const cred = clientCredentials.installed || clientCredentials.web || clientCredentials;
              const refreshResp = await fetch('https://oauth2.googleapis.com/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                  client_id: cred.client_id,
                  client_secret: cred.client_secret,
                  refresh_token: tokens.refresh_token,
                  grant_type: 'refresh_token',
                }).toString()
              });
              if (refreshResp.ok) {
                const newTokens = await refreshResp.json();
                tokens.access_token = newTokens.access_token;
                fs.writeFileSync(tokenPath, JSON.stringify(tokens, null, 2));
                return res.json({ success: true, message: 'Token refreshed successfully' });
              }
            }
          }
        } catch {}
      }
      res.status(502).json({ error: 'Not authorized yet. Click "Authorize" to start OAuth flow.', detail: 'step:authorize' });
    } else if (service === 'google-sheets') {
      const { serviceAccountKey } = config['google-sheets'] || {};
      if (!serviceAccountKey) {
        return res.status(400).json({ error: 'Google Sheets not configured. Please upload a Service Account Key.' });
      }

      try {
        const auth = new google.auth.GoogleAuth({
          credentials: serviceAccountKey,
          scopes: ['https://www.googleapis.com/auth/spreadsheets']
        });
        await auth.getClient();
        res.json({ success: true, message: 'Google Sheets API connection successful' });
      } catch (error) {
        console.error('[IntegrationsConfig] Google Sheets test failed:', error);
        res.status(502).json({ error: 'Google Sheets connection failed', detail: error.message });
      }
    }
  } catch (error) {
    console.error(`[IntegrationsConfig] Error in POST /integrations/config/${req.params.service}/test:`, error);
    res.status(500).json({ error: 'Test connection failed' });
  }
});

/**
 * Build the OAuth redirect URI from the incoming request.
 * Uses the same host the user is accessing Command Center from.
 */
function getOAuthRedirectUri(req) {
  const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
  const host = req.get('x-forwarded-host') || req.get('host');
  return `${proto}://${host}/api/integrations/config/gogcli/oauth-redirect`;
}

/**
 * POST /integrations/config/gogcli/authorize
 * Start OAuth flow — returns a URL for the user to visit
 */
router.post('/integrations/config/gogcli/authorize', (req, res) => {
  try {
    const config = getConfig();
    const { clientCredentials } = config.gogcli || {};
    if (!clientCredentials) {
      return res.status(400).json({ error: 'Upload OAuth Client Credentials JSON first' });
    }
    const isInstalled = !!clientCredentials.installed;
    const cred = clientCredentials.installed || clientCredentials.web || clientCredentials;
    if (!cred.client_id || !cred.client_secret) {
      return res.status(400).json({ error: 'Invalid credentials: missing client_id or client_secret' });
    }
    const scopes = [
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/userinfo.email',
    ].join(' ');

    // For "installed" type (desktop app), use http://localhost redirect
    // User must copy the code from the redirect URL and paste it back
    const redirectUri = isInstalled ? 'http://localhost' : getOAuthRedirectUri(req);
    const flowType = isInstalled ? 'manual' : 'redirect';
    const state = crypto.randomBytes(32).toString('hex');
    oauthStates.set(state, Date.now());
    // Clean expired states (older than 10 minutes)
    for (const [k, v] of oauthStates) {
      if (Date.now() - v > 600000) oauthStates.delete(k);
    }
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
      `client_id=${encodeURIComponent(cred.client_id)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&response_type=code` +
      `&scope=${encodeURIComponent(scopes)}` +
      `&access_type=offline` +
      `&prompt=consent` +
      `&state=${encodeURIComponent(state)}`;
    res.json({ success: true, authUrl, redirectUri, flowType });
  } catch (error) {
    console.error('[IntegrationsConfig] gogcli authorize error:', error);
    res.status(500).json({ error: 'Failed to generate auth URL' });
  }
});

/**
 * GET /integrations/config/gogcli/oauth-redirect
 * Google redirects here after user authorizes. No auth required (it's a browser redirect).
 */
router.get('/integrations/config/gogcli/oauth-redirect', async (req, res) => {
  const { code, error: oauthError, state } = req.query;
  const pageHtml = (title, body) => `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
    <style>body{font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#1a1a2e;color:#e0e0e0}
    .card{background:#16213e;padding:40px;border-radius:12px;text-align:center;max-width:400px;box-shadow:0 4px 20px rgba(0,0,0,.3)}
    h2{margin:0 0 12px;color:#4fc3f7} p{color:#aaa;margin:8px 0} .ok{color:#66bb6a} .err{color:#ef5350}</style>
    </head><body><div class="card">${body}</div></body></html>`;

  if (oauthError) {
    const safeError = String(oauthError).replace(/[<>&"']/g, '');
    return res.send(pageHtml('Authorization Failed', `<h2 class="err">Authorization Failed</h2><p>${safeError}</p>`));
  }
  if (!code) {
    return res.send(pageHtml('Error', `<h2 class="err">Error</h2><p>No authorization code received</p>`));
  }
  // Validate CSRF state
  if (!state || !oauthStates.has(state)) {
    return res.send(pageHtml('Error', `<h2 class="err">Error</h2><p>Invalid or expired OAuth state</p>`));
  }
  oauthStates.delete(state);

  try {
    const config = getConfig();
    const { clientCredentials } = config.gogcli || {};
    if (!clientCredentials) {
      return res.send(pageHtml('Error', `<h2 class="err">Error</h2><p>No client credentials configured</p>`));
    }
    const cred = clientCredentials.installed || clientCredentials.web || clientCredentials;
    const redirectUri = getOAuthRedirectUri(req);

    const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: cred.client_id,
        client_secret: cred.client_secret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }).toString()
    });

    const tokens = await tokenResp.json();
    if (tokens.error) {
      return res.send(pageHtml('Error', `<h2 class="err">OAuth Error</h2><p>${tokens.error_description || tokens.error}</p>`));
    }

    // Save tokens
    const tokenPath = path.join(OPENCLAW_HOME, 'gogcli-tokens.json');
    fs.writeFileSync(tokenPath, JSON.stringify(tokens, null, 2), { mode: 0o600 });

    // Get user info
    let email = '';
    try {
      const infoResp = await fetch('https://www.googleapis.com/oauth2/v1/userinfo?alt=json', {
        headers: { 'Authorization': `Bearer ${tokens.access_token}` }
      });
      if (infoResp.ok) {
        const info = await infoResp.json();
        email = info.email || '';
      }
    } catch {}

    // Update account in config
    if (email) {
      config.gogcli.account = email;
      config.gogcli.enabled = true;
      saveConfig(config);
    }

    recordAudit({ action: 'gogcli.authorized', target: 'gogcli', details: { email }, ip: req.ip });
    res.send(pageHtml('Authorization Successful',
      `<h2 class="ok">Authorization Successful!</h2><p>Logged in as <strong>${email || 'OK'}</strong></p><p>You can close this tab and return to Command Center.</p>`));
  } catch (error) {
    console.error('[IntegrationsConfig] OAuth redirect error:', error);
    const safeMsg = String(error.message).replace(/[<>&"']/g, '');
    res.send(pageHtml('Error', `<h2 class="err">Error</h2><p>${safeMsg}</p>`));
  }
});

/**
 * POST /integrations/config/gogcli/callback
 * Exchange auth code for tokens (manual code paste fallback)
 */
router.post('/integrations/config/gogcli/callback', async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) {
      return res.status(400).json({ error: 'Authorization code is required' });
    }
    const config = getConfig();
    const { clientCredentials } = config.gogcli || {};
    if (!clientCredentials) {
      return res.status(400).json({ error: 'No client credentials configured' });
    }
    const isInstalled = !!clientCredentials.installed;
    const cred = clientCredentials.installed || clientCredentials.web || clientCredentials;
    // Must match the redirect_uri used in the authorize step
    const redirectUri = isInstalled ? 'http://localhost' : getOAuthRedirectUri(req);

    const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: cred.client_id,
        client_secret: cred.client_secret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }).toString()
    });

    const tokens = await tokenResp.json();
    if (tokens.error) {
      return res.status(400).json({ error: `Google OAuth error: ${tokens.error_description || tokens.error}` });
    }

    const tokenPath = path.join(OPENCLAW_HOME, 'gogcli-tokens.json');
    fs.writeFileSync(tokenPath, JSON.stringify(tokens, null, 2), { mode: 0o600 });

    let email = '';
    try {
      const infoResp = await fetch('https://www.googleapis.com/oauth2/v1/userinfo?alt=json', {
        headers: { 'Authorization': `Bearer ${tokens.access_token}` }
      });
      if (infoResp.ok) {
        const info = await infoResp.json();
        email = info.email || '';
      }
    } catch {}

    if (email) {
      config.gogcli.account = email;
      config.gogcli.enabled = true;
      saveConfig(config);
    }

    recordAudit({ action: 'gogcli.authorized', target: 'gogcli', details: { email }, ip: req.ip });
    res.json({ success: true, message: `Authorized as ${email || 'OK'}`, email });
  } catch (error) {
    console.error('[IntegrationsConfig] gogcli callback error:', error);
    res.status(500).json({ error: 'Failed to exchange auth code for tokens' });
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

    // Sync to OpenClaw cron system
    syncAutoBackupCronJob();

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
 * Build a Google Drive client, preferring OAuth (gogcli) over service account.
 * Service accounts have 0 storage quota so OAuth is required for uploads.
 */
async function buildDriveClient(config) {
  const { google: googleapis } = await import('googleapis');

  // 1) Try OAuth tokens (gogcli) — user's Drive with real quota
  const tokenPath = path.join(OPENCLAW_HOME, 'gogcli-tokens.json');
  const gogcli = config.gogcli || {};
  if (fs.existsSync(tokenPath) && gogcli.clientCredentials) {
    try {
      const tokens = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
      if (tokens.access_token) {
        let clientCreds = gogcli.clientCredentials;
        // If clientCredentials is still a string (encryption issue), try to parse it
        if (typeof clientCreds === 'string') {
          try { clientCreds = JSON.parse(clientCreds); } catch { /* keep as-is */ }
        }
        const cred = (typeof clientCreds === 'object' && clientCreds !== null)
          ? (clientCreds.installed || clientCreds.web || clientCreds)
          : {};
        if (!cred.client_id || !cred.client_secret) {
          console.error('[Drive] OAuth credentials missing client_id or client_secret. Type:', typeof clientCreds);
          throw new Error('Invalid OAuth credentials');
        }
        console.log('[Drive] Using OAuth client_id:', cred.client_id.substring(0, 20) + '...');
        const oauth2 = new googleapis.auth.OAuth2(cred.client_id, cred.client_secret);
        oauth2.setCredentials(tokens);
        // Auto-refresh: listen for new tokens
        oauth2.on('tokens', (newTokens) => {
          const merged = { ...tokens, ...newTokens };
          fs.writeFileSync(tokenPath, JSON.stringify(merged, null, 2));
        });
        return { drive: googleapis.drive({ version: 'v3', auth: oauth2 }), method: 'oauth' };
      }
    } catch (e) {
      console.warn('[Drive] OAuth token load failed, trying service account:', e.message);
    }
  }

  // 2) Fallback to service account (only works with shared drives / shared folders)
  const driveConfig = config.drive || {};
  if (driveConfig.serviceAccountKey) {
    const auth = new googleapis.auth.GoogleAuth({
      credentials: driveConfig.serviceAccountKey,
      scopes: ['https://www.googleapis.com/auth/drive.file'],
    });
    return { drive: googleapis.drive({ version: 'v3', auth }), method: 'service-account' };
  }

  return null;
}

/**
 * Execute auto backup using existing Drive backup logic
 */
async function runAutoBackup() {
  const config = getConfig();

  const client = await buildDriveClient(config);
  if (!client) {
    return { success: false, error: 'Google Drive not configured. Set up Google Workspace (OAuth) in Capabilities tab, or configure a Drive service account.' };
  }
  const { drive } = client;

  try {
    // Get or create backup folder
    const driveConfig = config.drive || {};
    let folderId = driveConfig.folderId;
    if (!folderId) {
      const folder = await drive.files.create({
        resource: { name: 'CommandCenter-Backups', mimeType: 'application/vnd.google-apps.folder' },
        fields: 'id',
      });
      folderId = folder.data.id;
      if (!config.drive) config.drive = {};
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
        media: { mimeType: 'text/markdown', body: Readable.from(Buffer.from(content, 'utf8')) },
        fields: 'id, name',
      });

      files.push({ deptId: id, fileId: file.data.id, fileName: file.data.name });
    }

    // Update lastRun
    if (!config.autoBackup) config.autoBackup = { ...DEFAULT_CONFIG.autoBackup };
    config.autoBackup.lastRun = new Date().toISOString();
    saveConfig(config);

    console.log(`[AutoBackup] Completed (${client.method}): ${files.length} departments backed up`);
    return { success: true, files };
  } catch (error) {
    console.error('[AutoBackup] Failed:', error);
    return { success: false, error: error.message };
  }
}

// ---- OpenClaw Cron Sync for Auto Backup ----

const CRON_FILE_PATH = path.join(OPENCLAW_HOME, 'cron', 'jobs.json');
const AUTOBACKUP_JOB_NAME = '[系统] 自动备份到 Google Drive';

function readCronJobs() {
  try {
    if (fs.existsSync(CRON_FILE_PATH)) {
      return JSON.parse(fs.readFileSync(CRON_FILE_PATH, 'utf8'));
    }
  } catch {}
  return { version: 1, jobs: [] };
}

function writeCronJobs(data) {
  try {
    const dir = path.dirname(CRON_FILE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    safeWriteFileSync(CRON_FILE_PATH, JSON.stringify(data, null, 2));
    return true;
  } catch (err) {
    console.error('[AutoBackup] Failed to write cron jobs:', err.message);
    return false;
  }
}

/**
 * Convert autoBackup config (schedule + time) to a cron expression.
 *   daily  03:00  → "0 3 * * *"
 *   weekly 03:00  → "0 3 * * 1"
 */
function buildCronExpr(schedule, time) {
  const [hh, mm] = (time || '03:00').split(':').map(Number);
  if (schedule === 'weekly') return `${mm} ${hh} * * 1`;
  return `${mm} ${hh} * * *`;
}

/**
 * Sync autoBackup settings to an OpenClaw cron job.
 * Creates, updates, or disables the job to match the current config.
 * Called on startup and whenever autoBackup settings change.
 */
export function syncAutoBackupCronJob() {
  try {
    const config = getConfig();
    const ab = config.autoBackup || {};
    const data = readCronJobs();

    // Find existing auto-backup job by name
    let job = data.jobs.find(j => j.name === AUTOBACKUP_JOB_NAME);
    const cronExpr = buildCronExpr(ab.schedule, ab.time);
    const now = Date.now();

    if (job) {
      // Update existing job
      job.enabled = !!ab.enabled;
      job.schedule = { kind: 'cron', expr: cronExpr };
      job.updatedAtMs = now;
      console.log(`[AutoBackup] Synced cron job: enabled=${job.enabled}, expr=${cronExpr}`);
    } else {
      // Create new job
      job = {
        id: crypto.randomUUID(),
        agentId: 'main',
        name: AUTOBACKUP_JOB_NAME,
        enabled: !!ab.enabled,
        createdAtMs: now,
        updatedAtMs: now,
        deptId: 'admin',
        schedule: { kind: 'cron', expr: cronExpr },
        sessionTarget: 'isolated',
        wakeMode: 'now',
        payload: {
          kind: 'agentTurn',
          message: `执行自动备份: bash /root/.openclaw/workspace/skills/cmd-center/cmd-api.sh POST /integrations/autobackup/run`,
        },
        delivery: { mode: 'none' },
        state: { consecutiveErrors: 0 },
      };
      data.jobs.push(job);
      console.log(`[AutoBackup] Created cron job: id=${job.id}, expr=${cronExpr}`);
    }

    writeCronJobs(data);
  } catch (error) {
    console.error('[AutoBackup] Cron sync failed:', error.message);
  }
}

export default router;
