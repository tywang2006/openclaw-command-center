import express from 'express';
import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import crypto from 'node:crypto';
import { DATA_DIR } from '../utils.js';
import { createLogger } from '../logger.js';
import { safeBroadcast } from '../broadcast.js';

const log = createLogger('Audit');
const router = express.Router();

/**
 * Sanitize a value for safe CSV export.
 * - Prefixes formula-injection characters (=, +, -, @) with a single quote
 *   to prevent spreadsheet formula execution (e.g. =HYPERLINK(), =CMD()).
 * - Wraps values in double quotes and escapes embedded double quotes.
 * - Handles values containing commas, newlines, or double quotes.
 */
function csvSafe(value) {
  let str = String(value);
  // Neutralize formula injection: prefix dangerous leading characters with a quote
  if (/^[=+\-@]/.test(str)) {
    str = "'" + str;
  }
  // Escape double quotes by doubling them, then wrap in double quotes
  return '"' + str.replace(/"/g, '""') + '"';
}

const AUDIT_FILE = path.join(DATA_DIR, 'audit.jsonl');
const MAX_ENTRIES = 500;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

let auditLog = [];
let wss = null;

/**
 * Set WebSocket server for real-time audit broadcasting
 */
export function setAuditWss(websocketServer) {
  wss = websocketServer;
}

// Load existing entries
try {
  if (fs.existsSync(AUDIT_FILE)) {
    const content = fs.readFileSync(AUDIT_FILE, 'utf8').trim();
    if (content) {
      const allLines = content.split('\n');
      const recentLines = allLines.slice(-MAX_ENTRIES);
      for (const line of recentLines) {
        try { auditLog.push(JSON.parse(line)); } catch { /* skip */ }
      }
      log.info(`Loaded ${auditLog.length} entries from audit.jsonl`);
    }
  }
} catch (err) {
  log.error('Failed to load: ' + err.message);
}

/**
 * Rotate audit file if it exceeds MAX_FILE_SIZE.
 * Renames audit.jsonl to audit.jsonl.1 (overwrites old backup).
 */
async function rotateAuditFile() {
  try {
    const stats = await fsPromises.stat(AUDIT_FILE);
    if (stats.size >= MAX_FILE_SIZE) {
      const backupFile = AUDIT_FILE + '.1';
      await fsPromises.rename(AUDIT_FILE, backupFile);
      log.info(`Rotated audit.jsonl (${(stats.size / 1024 / 1024).toFixed(2)}MB) to audit.jsonl.1`);
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      log.error('Rotation check failed: ' + err.message);
    }
  }
}

export async function recordAudit({ action, target, deptId = null, details = null, ip = null }) {
  const entry = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    action,
    target,
    deptId,
    details,
    ip,
  };

  auditLog.push(entry);
  if (auditLog.length > MAX_ENTRIES) {
    auditLog = auditLog.slice(-MAX_ENTRIES);
  }

  // Broadcast to connected WebSocket clients in real-time
  if (wss) {
    safeBroadcast(wss, {
      event: 'audit:new',
      data: entry,
      timestamp: new Date().toISOString()
    });
  }

  // Async file I/O to avoid blocking event loop
  try {
    await rotateAuditFile();
    await fsPromises.appendFile(AUDIT_FILE, JSON.stringify(entry) + '\n', { encoding: 'utf8', mode: 0o600 });
  } catch (err) {
    log.error('Write failed: ' + err.message);
  }

  return entry;
}

router.get('/audit', (req, res) => {
  try {
    const parsedLimit = parseInt(req.query.limit || '50', 10);
    const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(1, parsedLimit), MAX_ENTRIES) : 50;
    const parsedOffset = parseInt(req.query.offset || '0', 10);
    const offset = Number.isFinite(parsedOffset) ? Math.max(0, parsedOffset) : 0;
    const actionFilter = req.query.action || null;
    const deptFilter = req.query.deptId || null;

    let filtered = auditLog;
    if (actionFilter) filtered = filtered.filter(e => e.action === actionFilter);
    if (deptFilter) filtered = filtered.filter(e => e.deptId === deptFilter);

    const sorted = [...filtered].reverse();
    const entries = sorted.slice(offset, offset + limit);

    res.json({ entries, total: filtered.length });
  } catch (error) {
    log.error('GET /audit error: ' + error.message);
    res.status(500).json({ error: 'Failed to fetch audit log' });
  }
});

router.get('/audit/export', (req, res) => {
  try {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="audit-log.csv"');

    const header = 'timestamp,action,target,deptId,details,ip\n';
    const rows = [...auditLog].reverse().map(e => {
      const details = e.details ? JSON.stringify(e.details).replace(/"/g, '""') : '';
      return [
        csvSafe(e.timestamp || ''),
        csvSafe(e.action || ''),
        csvSafe(e.target || ''),
        csvSafe(e.deptId || ''),
        csvSafe(details),
        csvSafe(e.ip || ''),
      ].join(',');
    }).join('\n');

    res.send(header + rows);
  } catch (error) {
    log.error('Export error: ' + error.message);
    res.status(500).json({ error: 'Export failed' });
  }
});

router.get('/audit/stats', (req, res) => {
  try {
    const byAction = {};
    const byDepartment = {};
    const oneHourAgo = Date.now() - 3600000;
    let recentHour = 0;

    for (const entry of auditLog) {
      byAction[entry.action] = (byAction[entry.action] || 0) + 1;
      if (entry.deptId) {
        byDepartment[entry.deptId] = (byDepartment[entry.deptId] || 0) + 1;
      }
      if (new Date(entry.timestamp).getTime() > oneHourAgo) recentHour++;
    }

    res.json({ totalEntries: auditLog.length, byAction, byDepartment, recentHour });
  } catch (error) {
    log.error('Stats error: ' + error.message);
    res.status(500).json({ error: 'Stats failed' });
  }
});

export default router;
