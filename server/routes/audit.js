import express from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'node:crypto';
import { DATA_DIR } from '../utils.js';
import { createLogger } from '../logger.js';

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

let auditLog = [];

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

export function recordAudit({ action, target, deptId = null, details = null, ip = null }) {
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

  fs.appendFile(AUDIT_FILE, JSON.stringify(entry) + '\n', (err) => {
    if (err) log.error('Write failed: ' + err.message);
  });

  return entry;
}

router.get('/audit', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '50', 10), MAX_ENTRIES);
    const offset = parseInt(req.query.offset || '0', 10);
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
