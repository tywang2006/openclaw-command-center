import express from 'express';
import fs from 'fs';
import path from 'path';
import { getGateway } from '../gateway.js';
import { OPENCLAW_HOME, safeWriteFileSync } from '../utils.js';

const router = express.Router();

// Persistent metrics file
const METRICS_FILE = path.join(OPENCLAW_HOME, 'command-center', 'metrics.json');
const SAVE_INTERVAL_MS = 60_000; // Flush to disk every 60s

// In-memory metrics store — loaded from disk on startup
const metrics = {
  global: {
    totalMessages: 0,
    totalErrors: 0,
    avgResponseMs: 0,
    gatewayReconnects: 0,
    sessionStart: Date.now(),
    firstStart: Date.now(),
  },
  departments: {}, // deptId -> department metrics
  daily: {},       // "YYYY-MM-DD" -> { messages, errors, tokens: { input, output } }
};

/** Load persisted metrics from disk */
function loadMetrics() {
  try {
    if (!fs.existsSync(METRICS_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(METRICS_FILE, 'utf8'));
    if (!raw || typeof raw !== 'object') return;

    // Restore global counters (cumulative — survive restarts)
    if (raw.global) {
      metrics.global.totalMessages = raw.global.totalMessages || 0;
      metrics.global.totalErrors = raw.global.totalErrors || 0;
      metrics.global.avgResponseMs = raw.global.avgResponseMs || 0;
      metrics.global.gatewayReconnects = raw.global.gatewayReconnects || 0;
      metrics.global.firstStart = raw.global.firstStart || Date.now();
    }

    // Restore department counters
    if (raw.departments && typeof raw.departments === 'object') {
      for (const [deptId, d] of Object.entries(raw.departments)) {
        metrics.departments[deptId] = {
          messageCount: d.messageCount || 0,
          errorCount: d.errorCount || 0,
          totalResponseMs: d.totalResponseMs || 0,
          avgResponseMs: d.avgResponseMs || 0,
          lastResponseMs: d.lastResponseMs || 0,
          recentResponseTimes: Array.isArray(d.recentResponseTimes) ? d.recentResponseTimes.slice(-50) : [],
          tokens: {
            input: d.tokens?.input || 0,
            output: d.tokens?.output || 0,
            total: d.tokens?.total || 0,
          },
        };
      }
    }

    // Restore daily stats
    if (raw.daily && typeof raw.daily === 'object') {
      Object.assign(metrics.daily, raw.daily);
    }

    console.log(`[Metrics] Loaded from disk: ${metrics.global.totalMessages} messages, ${Object.keys(metrics.departments).length} depts, ${Object.keys(metrics.daily).length} days`);
  } catch (err) {
    console.error('[Metrics] Failed to load from disk:', err.message);
  }
}

/** Save metrics to disk */
function saveMetrics() {
  try {
    const dir = path.dirname(METRICS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    safeWriteFileSync(METRICS_FILE, JSON.stringify(metrics, null, 2));
  } catch (err) {
    console.error('[Metrics] Failed to save to disk:', err.message);
  }
}

// Track dirty flag to avoid unnecessary writes
let _dirty = false;
function markDirty() { _dirty = true; }

// Periodic save timer
const _saveTimer = setInterval(() => {
  if (_dirty) {
    saveMetrics();
    _dirty = false;
  }
}, SAVE_INTERVAL_MS);

/** Call on process exit to flush final state */
export function flushMetrics() {
  clearInterval(_saveTimer);
  saveMetrics();
  console.log('[Metrics] Flushed to disk');
}

// Load on startup
loadMetrics();

// --- Daily stats helpers ---

function todayKey() {
  return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}

function ensureDaily(day) {
  if (!metrics.daily[day]) {
    metrics.daily[day] = { messages: 0, errors: 0, tokens: { input: 0, output: 0 } };
  }
  return metrics.daily[day];
}

// Prune daily stats older than 90 days
function pruneDaily() {
  const keys = Object.keys(metrics.daily).sort();
  if (keys.length <= 90) return;
  const cutoff = keys.length - 90;
  for (let i = 0; i < cutoff; i++) {
    delete metrics.daily[keys[i]];
  }
}

// Initialize department metrics
function ensureDepartmentMetrics(deptId) {
  if (!metrics.departments[deptId]) {
    metrics.departments[deptId] = {
      messageCount: 0,
      errorCount: 0,
      totalResponseMs: 0,
      avgResponseMs: 0,
      lastResponseMs: 0,
      recentResponseTimes: [], // Last 50 entries for charts
      tokens: {
        input: 0,
        output: 0,
        total: 0,
      },
    };
  }
  return metrics.departments[deptId];
}

/**
 * Record a chat interaction for a department.
 */
export function recordChat(deptId, durationMs, isError = false) {
  const deptMetrics = ensureDepartmentMetrics(deptId);
  const day = ensureDaily(todayKey());

  deptMetrics.messageCount++;
  deptMetrics.lastResponseMs = durationMs;
  day.messages++;

  if (isError) {
    deptMetrics.errorCount++;
    metrics.global.totalErrors++;
    day.errors++;
  } else {
    deptMetrics.totalResponseMs += durationMs;
    const successCount = deptMetrics.messageCount - deptMetrics.errorCount;
    deptMetrics.avgResponseMs = successCount > 0
      ? Math.round(deptMetrics.totalResponseMs / successCount)
      : 0;

    deptMetrics.recentResponseTimes.push(durationMs);
    if (deptMetrics.recentResponseTimes.length > 50) {
      deptMetrics.recentResponseTimes.shift();
    }
  }

  metrics.global.totalMessages++;

  // Recalculate global average
  let totalResponseMs = 0;
  let successfulMessages = 0;
  for (const dept of Object.values(metrics.departments)) {
    totalResponseMs += dept.totalResponseMs;
    successfulMessages += dept.messageCount - dept.errorCount;
  }
  metrics.global.avgResponseMs = successfulMessages > 0
    ? Math.round(totalResponseMs / successfulMessages)
    : 0;

  markDirty();
}

/**
 * Record token usage for a department.
 */
export function recordTokens(deptId, usage) {
  if (!usage) return;

  const deptMetrics = ensureDepartmentMetrics(deptId);
  const inputTokens = usage.inputTokens || 0;
  const outputTokens = usage.outputTokens || 0;

  deptMetrics.tokens.input += inputTokens;
  deptMetrics.tokens.output += outputTokens;
  deptMetrics.tokens.total += inputTokens + outputTokens;

  const day = ensureDaily(todayKey());
  day.tokens.input += inputTokens;
  day.tokens.output += outputTokens;

  markDirty();
}

/**
 * Record a gateway reconnection event.
 */
export function recordGatewayReconnect() {
  metrics.global.gatewayReconnects++;
  markDirty();
}

// Permission event log (F15) — keep in memory only (ephemeral)
const permissionLog = [];

export function recordPermission(deptId, toolName) {
  permissionLog.push({
    deptId,
    toolName,
    timestamp: Date.now(),
  });
  if (permissionLog.length > 100) {
    permissionLog.shift();
  }
}

export function getPermissionLog() {
  return permissionLog.slice(-50);
}

// GET /api/metrics
router.get('/metrics', (req, res) => {
  try {
    const now = Date.now();
    const uptime = now - metrics.global.sessionStart;
    const totalUptime = now - metrics.global.firstStart;

    // Prune old daily entries on read
    pruneDaily();

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      uptime,
      totalUptime,
      global: {
        ...metrics.global,
        uptime,
        totalUptime,
      },
      departments: metrics.departments,
      daily: metrics.daily,
    });
  } catch (error) {
    console.error('[Metrics] Error getting metrics:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/metrics/permissions
router.get('/metrics/permissions', (req, res) => {
  try {
    res.json({
      success: true,
      permissions: getPermissionLog(),
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/gateway/stats
router.get('/gateway/stats', (req, res) => {
  try {
    const gateway = getGateway();
    const stats = gateway.stats;
    res.json({ success: true, timestamp: new Date().toISOString(), gateway: stats });
  } catch (error) {
    console.error('[Metrics] Error getting gateway stats:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
