import fs from 'fs';
import path from 'path';
import { BASE_PATH, OPENCLAW_HOME } from './utils.js';
import { createLogger } from './logger.js';

const log = createLogger('Backup');

// Backup directory
export const BACKUP_DIR = path.join(OPENCLAW_HOME, 'command-center', 'backups');

// Keep last N backups per file
const MAX_BACKUPS_PER_FILE = 5;

// Critical data files to backup (relative to their base paths)
const CRITICAL_FILES = [
  // Department config and status
  { path: path.join(BASE_PATH, 'departments', 'config.json'), category: 'departments' },
  { path: path.join(BASE_PATH, 'departments', 'status.json'), category: 'departments' },

  // Integration configs (contains encrypted credentials)
  { path: path.join(OPENCLAW_HOME, 'command-center', 'integrations.json'), category: 'integrations' },

  // Cron jobs
  { path: path.join(OPENCLAW_HOME, 'cron', 'jobs.json'), category: 'cron' },
];

/**
 * Ensure backup directory exists with secure permissions
 */
function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true, mode: 0o700 });
    log.info('Created backup directory', { dir: BACKUP_DIR });
  }
}

/**
 * Generate backup filename with timestamp
 */
function getBackupFilename(originalPath, timestamp) {
  const basename = path.basename(originalPath, '.json');
  const category = CRITICAL_FILES.find(f => f.path === originalPath)?.category || 'misc';
  return `${category}_${basename}_${timestamp}.json`;
}

/**
 * Parse timestamp from backup filename
 */
function parseBackupTimestamp(filename) {
  const match = filename.match(/_(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})\.json$/);
  return match ? match[1] : null;
}

/**
 * Rotate old backups - keep only last N backups per file
 */
function rotateBackups(originalPath) {
  try {
    const basename = path.basename(originalPath, '.json');
    const category = CRITICAL_FILES.find(f => f.path === originalPath)?.category || 'misc';
    const prefix = `${category}_${basename}_`;

    // Find all backups for this file
    const backups = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith(prefix) && f.endsWith('.json'))
      .map(f => ({
        name: f,
        path: path.join(BACKUP_DIR, f),
        timestamp: parseBackupTimestamp(f),
      }))
      .filter(b => b.timestamp) // Only valid timestamped backups
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp)); // Newest first

    // Delete old backups beyond MAX_BACKUPS_PER_FILE
    const toDelete = backups.slice(MAX_BACKUPS_PER_FILE);
    for (const backup of toDelete) {
      try {
        fs.unlinkSync(backup.path);
        log.info('Deleted old backup', { file: backup.name });
      } catch (err) {
        log.warn('Failed to delete old backup', { file: backup.name, error: err.message });
      }
    }

    return backups.length - toDelete.length; // Remaining backup count
  } catch (err) {
    log.error('Error rotating backups', { originalPath, error: err.message });
    return 0;
  }
}

/**
 * Backup a single file
 */
function backupFile(filePath) {
  try {
    // Skip if file doesn't exist
    if (!fs.existsSync(filePath)) {
      log.debug('Skipping non-existent file', { filePath });
      return { success: false, reason: 'not_found' };
    }

    // Generate timestamp (ISO 8601 compatible with filesystem)
    const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
    const backupFilename = getBackupFilename(filePath, timestamp);
    const backupPath = path.join(BACKUP_DIR, backupFilename);

    // Copy file to backup directory
    fs.copyFileSync(filePath, backupPath);

    // Secure permissions for sensitive files (integrations.json)
    if (filePath.includes('integrations.json')) {
      fs.chmodSync(backupPath, 0o600);
    }

    // Rotate old backups
    const remainingBackups = rotateBackups(filePath);

    log.info('Backup created', {
      file: path.basename(filePath),
      backupFilename,
      remainingBackups,
    });

    return { success: true, backupPath, remainingBackups };
  } catch (err) {
    log.error('Backup failed', { filePath, error: err.message });
    return { success: false, error: err.message };
  }
}

/**
 * Backup all critical files
 */
export function backupAllCriticalFiles() {
  try {
    ensureBackupDir();

    const results = {
      timestamp: new Date().toISOString(),
      success: 0,
      failed: 0,
      skipped: 0,
      files: [],
    };

    log.info('Starting backup of critical files', { fileCount: CRITICAL_FILES.length });

    for (const { path: filePath, category } of CRITICAL_FILES) {
      const result = backupFile(filePath);

      if (result.success) {
        results.success++;
        results.files.push({
          path: filePath,
          category,
          status: 'success',
          backupPath: result.backupPath,
        });
      } else if (result.reason === 'not_found') {
        results.skipped++;
        results.files.push({
          path: filePath,
          category,
          status: 'skipped',
          reason: 'File does not exist',
        });
      } else {
        results.failed++;
        results.files.push({
          path: filePath,
          category,
          status: 'failed',
          error: result.error,
        });
      }
    }

    // Also backup meeting files
    const meetingsBackup = backupMeetingFiles();
    results.meetings = meetingsBackup;

    log.info('Backup completed', {
      success: results.success,
      failed: results.failed,
      skipped: results.skipped,
      meetings: meetingsBackup.count,
    });

    return results;
  } catch (err) {
    log.error('Backup process failed', { error: err.message });
    return {
      timestamp: new Date().toISOString(),
      success: 0,
      failed: 1,
      error: err.message,
    };
  }
}

/**
 * Backup all meeting files (separate category due to multiple files)
 */
function backupMeetingFiles() {
  try {
    const meetingsDir = path.join(BASE_PATH, 'departments', 'meetings');

    if (!fs.existsSync(meetingsDir)) {
      return { count: 0, status: 'no_meetings_dir' };
    }

    const meetingFiles = fs.readdirSync(meetingsDir)
      .filter(f => f.endsWith('.json'))
      .map(f => path.join(meetingsDir, f));

    if (meetingFiles.length === 0) {
      return { count: 0, status: 'no_meetings' };
    }

    // Create timestamped meetings backup directory
    const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
    const meetingsBackupDir = path.join(BACKUP_DIR, `meetings_${timestamp}`);
    fs.mkdirSync(meetingsBackupDir, { recursive: true, mode: 0o700 });

    let backed = 0;
    for (const filePath of meetingFiles) {
      try {
        const filename = path.basename(filePath);
        fs.copyFileSync(filePath, path.join(meetingsBackupDir, filename));
        backed++;
      } catch (err) {
        log.warn('Failed to backup meeting file', { filePath, error: err.message });
      }
    }

    // Rotate old meeting backups
    rotateMeetingBackups();

    log.info('Meeting files backed up', { count: backed, dir: meetingsBackupDir });

    return { count: backed, dir: meetingsBackupDir, status: 'success' };
  } catch (err) {
    log.error('Meeting backup failed', { error: err.message });
    return { count: 0, status: 'failed', error: err.message };
  }
}

/**
 * Rotate meeting backup directories - keep only last N
 */
function rotateMeetingBackups() {
  try {
    const meetingBackups = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('meetings_') && fs.statSync(path.join(BACKUP_DIR, f)).isDirectory())
      .map(f => ({
        name: f,
        path: path.join(BACKUP_DIR, f),
        timestamp: f.replace('meetings_', ''),
      }))
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp)); // Newest first

    const toDelete = meetingBackups.slice(MAX_BACKUPS_PER_FILE);
    for (const backup of toDelete) {
      try {
        fs.rmSync(backup.path, { recursive: true, force: true });
        log.info('Deleted old meeting backup', { dir: backup.name });
      } catch (err) {
        log.warn('Failed to delete old meeting backup', { dir: backup.name, error: err.message });
      }
    }
  } catch (err) {
    log.error('Error rotating meeting backups', { error: err.message });
  }
}

/**
 * List all available backups
 */
export function listBackups() {
  try {
    ensureBackupDir();

    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.endsWith('.json') || f.startsWith('meetings_'))
      .map(f => {
        const filePath = path.join(BACKUP_DIR, f);
        const stat = fs.statSync(filePath);
        return {
          name: f,
          path: filePath,
          size: stat.size,
          created: stat.birthtime.toISOString(),
          modified: stat.mtime.toISOString(),
          isDirectory: stat.isDirectory(),
        };
      })
      .sort((a, b) => b.modified.localeCompare(a.modified)); // Newest first

    return {
      backupDir: BACKUP_DIR,
      files,
      totalSize: files.reduce((sum, f) => sum + f.size, 0),
    };
  } catch (err) {
    log.error('Failed to list backups', { error: err.message });
    return {
      backupDir: BACKUP_DIR,
      files: [],
      error: err.message,
    };
  }
}

/**
 * Restore a file from backup
 */
export function restoreFromBackup(backupFilename, targetPath) {
  try {
    const backupPath = path.join(BACKUP_DIR, backupFilename);

    if (!fs.existsSync(backupPath)) {
      return { success: false, error: 'Backup file not found' };
    }

    // Create backup of current file before restoring
    if (fs.existsSync(targetPath)) {
      const preRestoreBackup = targetPath + '.pre-restore.' + Date.now();
      fs.copyFileSync(targetPath, preRestoreBackup);
      log.info('Created pre-restore backup', { file: preRestoreBackup });
    }

    // Restore the backup
    fs.copyFileSync(backupPath, targetPath);

    log.info('Restored from backup', { backupFilename, targetPath });

    return { success: true, targetPath };
  } catch (err) {
    log.error('Restore failed', { backupFilename, targetPath, error: err.message });
    return { success: false, error: err.message };
  }
}

/**
 * Start periodic backup scheduler
 * Returns interval handle for cleanup on shutdown
 */
export function startPeriodicBackup(intervalMs = 60 * 60 * 1000) {
  // Backup on startup
  log.info('Running startup backup');
  backupAllCriticalFiles();

  // Schedule periodic backups
  const interval = setInterval(() => {
    log.info('Running scheduled backup');
    backupAllCriticalFiles();
  }, intervalMs);

  log.info('Periodic backup scheduler started', {
    intervalMs,
    intervalHours: intervalMs / (60 * 60 * 1000),
  });

  return interval;
}

/**
 * Stop periodic backup scheduler
 */
export function stopPeriodicBackup(intervalHandle) {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    log.info('Periodic backup scheduler stopped');
  }
}
