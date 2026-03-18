import express from 'express';
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { google } from 'googleapis';
import { BASE_PATH, OPENCLAW_HOME, readJsonFile, safeWriteFileSync } from '../utils.js';
import { getEncryptionKey, decryptSensitiveFields, migratePlaintextFields } from '../crypto.js';

const router = express.Router();

const VALID_FOLDER_ID = /^[a-zA-Z0-9_-]+$/;

const CONFIG_PATH = path.join(BASE_PATH, '..', 'command-center', 'integrations.json');
const DEPARTMENTS_PATH = path.join(BASE_PATH, 'departments');

/**
 * Helper: Write JSON file safely
 */
function writeJsonFile(filePath, data) {
  try {
    safeWriteFileSync(filePath, JSON.stringify(data, null, 2));
    return true;
  } catch (error) {
    console.error(`[Drive] Error writing JSON file ${filePath}:`, error.message);
    return false;
  }
}

/**
 * Helper: Get Drive configuration (with decryption)
 */
function getDriveConfig() {
  const config = readJsonFile(CONFIG_PATH);
  if (!config) return { enabled: false, serviceAccountKey: null, folderId: null };
  const key = getEncryptionKey();
  migratePlaintextFields(config, key);
  decryptSensitiveFields(config, key);
  return config?.drive || { enabled: false, serviceAccountKey: null, folderId: null };
}

/**
 * Helper: Update Drive configuration
 */
function updateDriveConfig(updates) {
  const config = readJsonFile(CONFIG_PATH) || {};
  config.drive = { ...config.drive, ...updates };
  return writeJsonFile(CONFIG_PATH, config);
}

/**
 * Helper: Check if any Drive auth is available (OAuth or service account)
 */
function hasDriveAuth() {
  const fullConfig = readJsonFile(CONFIG_PATH) || {};
  const key = getEncryptionKey();
  decryptSensitiveFields(fullConfig, key);
  const driveConfig = fullConfig.drive || {};
  const gogcli = fullConfig.gogcli || {};
  const tokenPath = path.join(OPENCLAW_HOME, 'gogcli-tokens.json');
  // OAuth available?
  if (gogcli.enabled && gogcli.clientCredentials && fs.existsSync(tokenPath)) return true;
  // Service account available?
  if (driveConfig.enabled && driveConfig.serviceAccountKey) return true;
  return false;
}

/**
 * Helper: Create Google Drive client (prefers OAuth over service account)
 */
function getDriveClient(driveConfig) {
  // 1) Try OAuth (gogcli) — user's Drive with real storage quota
  const tokenPath = path.join(OPENCLAW_HOME, 'gogcli-tokens.json');
  const fullConfig = readJsonFile(CONFIG_PATH) || {};
  // Decrypt gogcli credentials if encrypted
  const key = getEncryptionKey();
  decryptSensitiveFields(fullConfig, key);
  const gogcli = fullConfig.gogcli || {};
  if (fs.existsSync(tokenPath) && gogcli.clientCredentials) {
    try {
      const tokens = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
      if (tokens.access_token) {
        let clientCreds = gogcli.clientCredentials;
        if (typeof clientCreds === 'string') {
          try { clientCreds = JSON.parse(clientCreds); } catch { /* keep as-is */ }
        }
        const cred = (typeof clientCreds === 'object' && clientCreds !== null)
          ? (clientCreds.installed || clientCreds.web || clientCreds)
          : {};
        if (!cred.client_id || !cred.client_secret) {
          console.error('[Drive] OAuth credentials missing client_id or client_secret');
          throw new Error('Invalid OAuth credentials');
        }
        const oauth2 = new google.auth.OAuth2(cred.client_id, cred.client_secret);
        oauth2.setCredentials(tokens);
        oauth2.on('tokens', (newTokens) => {
          const merged = { ...tokens, ...newTokens };
          safeWriteFileSync(tokenPath, JSON.stringify(merged, null, 2), { mode: 0o600 });
        });
        return google.drive({ version: 'v3', auth: oauth2 });
      }
    } catch (e) {
      console.warn('[Drive] OAuth token load failed, falling back to service account:', e.message);
    }
  }

  // 2) Fallback to service account
  const auth = new google.auth.GoogleAuth({
    credentials: driveConfig.serviceAccountKey,
    scopes: ['https://www.googleapis.com/auth/drive.file']
  });
  return google.drive({ version: 'v3', auth });
}

/**
 * Helper: Get or create backup folder
 */
async function getOrCreateBackupFolder(drive, driveConfig) {
  let folderId = driveConfig.folderId;

  if (folderId && !VALID_FOLDER_ID.test(folderId)) {
    console.error('[Drive] Invalid folder ID format:', folderId);
    throw new Error('Invalid folder ID format');
  }

  if (folderId) {
    // Verify folder exists
    try {
      await drive.files.get({ fileId: folderId });
      return folderId;
    } catch (error) {
      console.log('[Drive] Folder not found, creating new one');
      folderId = null;
    }
  }

  // Create new folder
  const folderMetadata = {
    name: 'CommandCenter-Backups',
    mimeType: 'application/vnd.google-apps.folder'
  };

  const folder = await drive.files.create({
    resource: folderMetadata,
    fields: 'id'
  });

  folderId = folder.data.id;

  // Save folder ID to config
  updateDriveConfig({ folderId });

  return folderId;
}

/**
 * GET /drive/status
 * Return Google Drive integration status
 */
router.get('/drive/status', (req, res) => {
  try {
    const driveConfig = getDriveConfig();
    const configured = !!(driveConfig.serviceAccountKey) || hasDriveAuth();

    res.json({
      configured,
      enabled: driveConfig.enabled || configured,
      folderId: driveConfig.folderId || null
    });
  } catch (error) {
    console.error('[Drive] Error in GET /drive/status:', error);
    res.status(500).json({ error: 'Failed to fetch drive status' });
  }
});

/**
 * POST /drive/upload
 * Upload a file to Google Drive
 * Body: { filename, content, mimeType? }
 */
router.post('/drive/upload', async (req, res) => {
  try {
    const { filename, content, mimeType } = req.body;

    if (!filename || !content) {
      return res.status(400).json({ error: 'filename and content are required' });
    }

    if (typeof content === 'string' && content.length > 10 * 1024 * 1024) {
      return res.status(413).json({ error: 'Content exceeds 10MB limit' });
    }

    const driveConfig = getDriveConfig();

    if (!driveConfig.enabled && !hasDriveAuth()) {
      return res.status(400).json({ error: 'Google Drive integration is disabled' });
    }

    if (!driveConfig.serviceAccountKey && !hasDriveAuth()) {
      return res.status(400).json({ error: 'Google Drive not configured' });
    }

    if (driveConfig.folderId && !VALID_FOLDER_ID.test(driveConfig.folderId)) {
      return res.status(400).json({ error: 'Invalid folder ID format' });
    }

    try {
      const drive = getDriveClient(driveConfig);
      const folderId = await getOrCreateBackupFolder(drive, driveConfig);

      // Prepare file content
      const buffer = Buffer.from(content, 'utf8');

      const fileMetadata = {
        name: filename,
        parents: [folderId]
      };

      const media = {
        mimeType: mimeType || 'text/markdown',
        body: Readable.from(buffer)
      };

      const file = await drive.files.create({
        resource: fileMetadata,
        media: media,
        fields: 'id, name, webViewLink'
      });

      console.log(`[Drive] Uploaded file: ${filename} (${file.data.id})`);

      res.json({
        success: true,
        fileId: file.data.id,
        fileName: file.data.name,
        webViewLink: file.data.webViewLink
      });
    } catch (error) {
      console.error('[Drive] Upload failed:', error);
      res.status(502).json({ error: 'Failed to upload to Drive', detail: error.message });
    }
  } catch (error) {
    console.error('[Drive] Error in POST /drive/upload:', error);
    res.status(500).json({ error: 'Failed to upload file' });
  }
});

/**
 * POST /drive/backup
 * Backup department files to Google Drive
 * Body: { deptId? } - if omitted, backs up all departments
 */
router.post('/drive/backup', async (req, res) => {
  try {
    const { deptId } = req.body || {};

    const driveConfig = getDriveConfig();

    if (!driveConfig.enabled && !hasDriveAuth()) {
      return res.status(400).json({ error: 'Google Drive integration is disabled' });
    }

    if (!driveConfig.serviceAccountKey && !hasDriveAuth()) {
      return res.status(400).json({ error: 'Google Drive not configured' });
    }

    if (driveConfig.folderId && !VALID_FOLDER_ID.test(driveConfig.folderId)) {
      return res.status(400).json({ error: 'Invalid folder ID format' });
    }

    try {
      const drive = getDriveClient(driveConfig);
      const folderId = await getOrCreateBackupFolder(drive, driveConfig);

      // Get department list
      const configPath = path.join(DEPARTMENTS_PATH, 'config.json');
      const deptConfig = readJsonFile(configPath);
      const departments = deptConfig?.departments || {};

      let deptIds = [];
      if (deptId) {
        // Validate department exists
        if (!departments[deptId]) {
          return res.status(404).json({ error: `Department ${deptId} not found` });
        }
        deptIds = [deptId];
      } else {
        // Backup all departments
        deptIds = Object.keys(departments);
      }

      const files = [];
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

      for (const id of deptIds) {
        const deptPath = path.join(DEPARTMENTS_PATH, id);
        if (!fs.existsSync(deptPath)) continue;

        // Read MEMORY.md
        const memoryPath = path.join(deptPath, 'memory', 'MEMORY.md');
        let content = `# Backup for ${id} - ${timestamp}\n\n`;

        if (fs.existsSync(memoryPath)) {
          content += `## MEMORY.md\n\n`;
          content += fs.readFileSync(memoryPath, 'utf8');
          content += '\n\n---\n\n';
        }

        // Read daily logs
        const dailyPath = path.join(deptPath, 'daily');
        if (fs.existsSync(dailyPath)) {
          const dailyFiles = fs.readdirSync(dailyPath)
            .filter(f => f.endsWith('.md'))
            .sort()
            .reverse()
            .slice(0, 10); // Last 10 daily logs

          for (const dailyFile of dailyFiles) {
            content += `## Daily Log: ${dailyFile}\n\n`;
            content += fs.readFileSync(path.join(dailyPath, dailyFile), 'utf8');
            content += '\n\n---\n\n';
          }
        }

        // Upload to Drive
        const filename = `${id}_backup_${timestamp}.md`;
        const buffer = Buffer.from(content, 'utf8');

        const fileMetadata = {
          name: filename,
          parents: [folderId]
        };

        const media = {
          mimeType: 'text/markdown',
          body: Readable.from(buffer)
        };

        const file = await drive.files.create({
          resource: fileMetadata,
          media: media,
          fields: 'id, name'
        });

        files.push({
          deptId: id,
          fileId: file.data.id,
          fileName: file.data.name
        });

        console.log(`[Drive] Backed up ${id}: ${file.data.id}`);
      }

      res.json({ success: true, files });
    } catch (error) {
      console.error('[Drive] Backup failed:', error);
      res.status(502).json({ error: 'Failed to backup to Drive', detail: error.message });
    }
  } catch (error) {
    console.error('[Drive] Error in POST /drive/backup:', error);
    res.status(500).json({ error: 'Failed to backup files' });
  }
});

/**
 * GET /drive/files
 * List files in backup folder
 */
router.get('/drive/files', async (req, res) => {
  try {
    const driveConfig = getDriveConfig();

    if (!driveConfig.enabled && !hasDriveAuth()) {
      return res.status(400).json({ error: 'Google Drive integration is disabled' });
    }

    if (!driveConfig.serviceAccountKey && !hasDriveAuth()) {
      return res.status(400).json({ error: 'Google Drive not configured' });
    }

    if (!driveConfig.folderId) {
      return res.json({ files: [] });
    }

    if (driveConfig.folderId && !VALID_FOLDER_ID.test(driveConfig.folderId)) {
      return res.status(400).json({ error: 'Invalid folder ID format' });
    }

    try {
      const drive = getDriveClient(driveConfig);

      const response = await drive.files.list({
        q: `'${driveConfig.folderId}' in parents and trashed=false`,
        fields: 'files(id, name, size, createdTime, webViewLink)',
        orderBy: 'createdTime desc',
        pageSize: 100
      });

      const files = response.data.files.map(f => ({
        id: f.id,
        name: f.name,
        size: parseInt(f.size) || 0,
        createdTime: f.createdTime,
        webViewLink: f.webViewLink
      }));

      res.json({ files });
    } catch (error) {
      console.error('[Drive] List files failed:', error);
      res.status(502).json({ error: 'Failed to list Drive files', detail: error.message });
    }
  } catch (error) {
    console.error('[Drive] Error in GET /drive/files:', error);
    res.status(500).json({ error: 'Failed to list files' });
  }
});

// Export helper functions for use in other modules
export { getDriveConfig, hasDriveAuth, getDriveClient, getOrCreateBackupFolder };

export default router;
