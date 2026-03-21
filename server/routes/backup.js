import express from 'express';
import path from 'path';
import { backupAllCriticalFiles, listBackups, restoreFromBackup, BACKUP_DIR } from '../backup.js';
import { recordAudit } from './audit.js';
import { createLogger } from '../logger.js';

const log = createLogger('BackupRoutes');
const router = express.Router();

const OPENCLAW_HOME = process.env.OPENCLAW_HOME || path.join(process.env.HOME || '/root', '.openclaw');
const ALLOWED_RESTORE_DIRS = [
  OPENCLAW_HOME,
  path.join(OPENCLAW_HOME, 'workspace'),
];

function isPathConfined(targetPath, allowedDirs) {
  const resolved = path.resolve(targetPath);
  return allowedDirs.some(dir => resolved.startsWith(dir + path.sep) || resolved === dir);
}

function isSafeFilename(name) {
  return /^[a-zA-Z0-9._-]+$/.test(name) && !name.includes('..');
}

/**
 * POST /api/backup/create
 * Manually trigger a backup of all critical files
 */
router.post('/create', async (req, res) => {
  try {
    log.info('Manual backup requested', { user: req.user });

    const result = backupAllCriticalFiles();

    recordAudit({
      action: 'backup_create',
      user: req.user || 'system',
      timestamp: new Date().toISOString(),
      details: {
        success: result.success,
        failed: result.failed,
        skipped: result.skipped,
      },
    });

    res.json({
      success: true,
      result,
    });
  } catch (error) {
    log.error('Backup creation failed', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/backup/list
 * List all available backups
 */
router.get('/list', (req, res) => {
  try {
    const backups = listBackups();

    res.json({
      success: true,
      backups,
    });
  } catch (error) {
    log.error('Failed to list backups', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/backup/restore
 * Restore a file from backup
 * Body: { backupFilename, targetPath }
 */
router.post('/restore', (req, res) => {
  try {
    const { backupFilename, targetPath } = req.body;

    if (!backupFilename || !targetPath) {
      return res.status(400).json({
        success: false,
        error: 'Missing backupFilename or targetPath',
      });
    }

    if (!isSafeFilename(backupFilename)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid backup filename',
      });
    }

    if (!isPathConfined(targetPath, ALLOWED_RESTORE_DIRS)) {
      return res.status(403).json({
        success: false,
        error: 'Target path is outside allowed directories',
      });
    }

    log.info('Restore requested', {
      user: req.user,
      backupFilename,
      targetPath,
    });

    const result = restoreFromBackup(backupFilename, targetPath);

    recordAudit({
      action: 'backup_restore',
      user: req.user || 'system',
      timestamp: new Date().toISOString(),
      details: {
        backupFilename,
        targetPath,
        success: result.success,
      },
    });

    if (result.success) {
      res.json({
        success: true,
        message: 'Backup restored successfully',
        targetPath: result.targetPath,
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error,
      });
    }
  } catch (error) {
    log.error('Restore failed', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

export default router;
