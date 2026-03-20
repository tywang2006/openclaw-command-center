import express from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'node:crypto';
import { DATA_DIR, safeWriteFileSync } from '../utils.js';
import { createLogger } from '../logger.js';

const log = createLogger('Notifications');
const router = express.Router();

const STORE_PATH = path.join(DATA_DIR, 'notifications.json');
const MAX_NOTIFICATIONS = 200;

let notifications = [];

try {
  if (fs.existsSync(STORE_PATH)) {
    const data = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
    notifications = (data.notifications || []).slice(-MAX_NOTIFICATIONS);
    log.info(`Loaded ${notifications.length} notifications`);
  }
} catch (err) {
  log.error(`Failed to load: ${err.message}`);
}

let _dirty = false;
setInterval(() => {
  if (_dirty) { persistSync(); _dirty = false; }
}, 60000);

function persistSync() {
  try {
    safeWriteFileSync(STORE_PATH, JSON.stringify({ notifications }, null, 2));
  } catch (err) {
    log.error(`Persist failed: ${err.message}`);
  }
}

process.on('beforeExit', persistSync);

export function notify({ severity = 'info', category = 'system', title, body = '', deptId = null, actionUrl = null }) {
  const notif = {
    id: `notif_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
    timestamp: new Date().toISOString(),
    severity,
    category,
    title,
    body,
    deptId,
    read: false,
    actionUrl,
  };

  notifications.push(notif);
  if (notifications.length > MAX_NOTIFICATIONS) {
    notifications = notifications.slice(-MAX_NOTIFICATIONS);
  }
  _dirty = true;

  // Send web push for critical/error notifications
  if (severity === 'error' || severity === 'critical') {
    import('./push.js').then(({ sendPush }) => {
      sendPush({
        title: `[${severity.toUpperCase()}] ${category}`,
        body: title,
        category: severity
      }).catch(() => {});
    }).catch(() => {});
  }

  return notif;
}

export function notifyError(category, title, body = '') {
  return notify({ severity: 'error', category, title, body });
}
export function notifyWarning(category, title, body = '') {
  return notify({ severity: 'warning', category, title, body });
}
export function notifyInfo(category, title, body = '') {
  return notify({ severity: 'info', category, title, body });
}

router.get('/notifications', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '50', 10), MAX_NOTIFICATIONS);
    const unreadOnly = req.query.unreadOnly === 'true';
    const severityFilter = req.query.severity || null;
    const categoryFilter = req.query.category || null;

    let filtered = notifications;
    if (unreadOnly) filtered = filtered.filter(n => !n.read);
    if (severityFilter) filtered = filtered.filter(n => n.severity === severityFilter);
    if (categoryFilter) filtered = filtered.filter(n => n.category === categoryFilter);

    const sorted = [...filtered].reverse().slice(0, limit);
    const unreadCount = notifications.filter(n => !n.read).length;

    res.json({ notifications: sorted, unreadCount, total: filtered.length });
  } catch (error) {
    log.error(`GET error: ${error.message}`);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

router.get('/notifications/summary', (req, res) => {
  try {
    const unreadCount = notifications.filter(n => !n.read).length;
    const criticalCount = notifications.filter(n => !n.read && n.severity === 'critical').length;
    const latest = notifications.length > 0 ? notifications[notifications.length - 1].timestamp : null;
    res.json({ unreadCount, criticalCount, latestTimestamp: latest });
  } catch (error) {
    log.error(`Summary error: ${error.message}`);
    res.status(500).json({ error: 'Failed' });
  }
});

router.put('/notifications/:id/read', (req, res) => {
  const notif = notifications.find(n => n.id === req.params.id);
  if (!notif) return res.status(404).json({ error: 'Not found' });
  notif.read = true;
  _dirty = true;
  res.json({ success: true });
});

router.put('/notifications/read-all', (req, res) => {
  let count = 0;
  for (const n of notifications) {
    if (!n.read) { n.read = true; count++; }
  }
  _dirty = true;
  res.json({ success: true, count });
});

router.delete('/notifications/:id', (req, res) => {
  const idx = notifications.findIndex(n => n.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  notifications.splice(idx, 1);
  _dirty = true;
  res.json({ success: true });
});

export default router;
