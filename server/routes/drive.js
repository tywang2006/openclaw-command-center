import express from 'express';
import fs from 'fs';
import path from 'path';
import { google } from 'googleapis';
import { BASE_PATH, readJsonFile } from '../utils.js';
import { getEncryptionKey, decryptSensitiveFields, migratePlaintextFields } from '../crypto.js';

const router = express.Router();

const CONFIG_PATH = path.join(BASE_PATH, '..', 'command-center', 'integrations.json');
const DEPARTMENTS_PATH = path.join(BASE_PATH, 'departments');

/**
 * Helper: Write JSON file safely
 */
function writeJsonFile(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
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
 * Helper: Create Google Drive client
 */
function getDriveClient(driveConfig) {
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
    const configured = !!(driveConfig.serviceAccountKey);

    res.json({
      configured,
      enabled: driveConfig.enabled,
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

    const driveConfig = getDriveConfig();

    if (!driveConfig.enabled) {
      return res.status(400).json({ error: 'Google Drive integration is disabled' });
    }

    if (!driveConfig.serviceAccountKey) {
      return res.status(400).json({ error: 'Google Drive not configured' });
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
        body: buffer
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
    const { deptId } = req.body;

    const driveConfig = getDriveConfig();

    if (!driveConfig.enabled) {
      return res.status(400).json({ error: 'Google Drive integration is disabled' });
    }

    if (!driveConfig.serviceAccountKey) {
      return res.status(400).json({ error: 'Google Drive not configured' });
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
          body: buffer
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

    if (!driveConfig.enabled) {
      return res.status(400).json({ error: 'Google Drive integration is disabled' });
    }

    if (!driveConfig.serviceAccountKey) {
      return res.status(400).json({ error: 'Google Drive not configured' });
    }

    if (!driveConfig.folderId) {
      return res.json({ files: [] });
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

export default router;
