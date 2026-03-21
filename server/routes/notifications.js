import express from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'node:crypto';
import { DATA_DIR, safeWriteFileSync } from '../utils.js';
import { createLogger } from '../logger.js';
import { safeBroadcast } from '../broadcast.js';

const log = createLogger('Notifications');
const router = express.Router();

const STORE_PATH = path.join(DATA_DIR, 'notifications.json');
const MAX_NOTIFICATIONS = 200;

let notifications = [];
let _wss = null;

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
const _persistTimer = setInterval(() => {
  if (_dirty) { persistSync(); _dirty = false; }
}, 60000);

/** Stop the persist timer (call during graceful shutdown) */
export function stopNotificationPersist() {
  clearInterval(_persistTimer);
  if (_dirty) { persistSync(); _dirty = false; }
}

function persistSync() {
  try {
    safeWriteFileSync(STORE_PATH, JSON.stringify({ notifications }, null, 2));
  } catch (err) {
    log.error(`Persist failed: ${err.message}`);
  }
}

process.on('beforeExit', persistSync);

export function setWss(wss) { _wss = wss; }

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

  // Broadcast notification:new event to WebSocket clients
  if (_wss) {
    const { sent } = safeBroadcast(_wss, {
      event: 'notification:new',
      data: notif,
      timestamp: notif.timestamp
    });
    log.info(`Broadcast notification:new to ${sent} WS clients`, { severity, category, title });
  }

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

// Notification ID format: notif_{timestamp}_{uuid-prefix}
const VALID_NOTIF_ID = /^notif_\d+_[a-f0-9]{8}$/;
const VALID_SEVERITY = new Set(['info', 'warning', 'error', 'critical']);
const VALID_CATEGORY = new Set(['system', 'health', 'meeting', 'cron', 'backup', 'security', 'gateway']);

router.get('/notifications', (req, res) => {
  try {
    const parsedLimit = parseInt(req.query.limit || '50', 10);
    const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(1, parsedLimit), MAX_NOTIFICATIONS) : 50;
    const unreadOnly = req.query.unreadOnly === 'true';
    const severityFilter = req.query.severity || null;
    const categoryFilter = req.query.category || null;

    // Validate enum filters to prevent unexpected matching behavior
    if (severityFilter && !VALID_SEVERITY.has(severityFilter)) {
      return res.status(400).json({ error: `Invalid severity. Allowed: ${[...VALID_SEVERITY].join(', ')}` });
    }

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
  const { id } = req.params;
  if (!VALID_NOTIF_ID.test(id)) {
    return res.status(400).json({ error: 'Invalid notification ID format' });
  }
  const notif = notifications.find(n => n.id === id);
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
  const { id } = req.params;
  if (!VALID_NOTIF_ID.test(id)) {
    return res.status(400).json({ error: 'Invalid notification ID format' });
  }
  const idx = notifications.findIndex(n => n.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  notifications.splice(idx, 1);
  _dirty = true;
  res.json({ success: true });
});

export default router;
