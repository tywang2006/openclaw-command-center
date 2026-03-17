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

// Health state tracking
const healthState = {}; // { deptId: { consecutiveErrors: 0, lastAlertTime: 0, recentResponseTimes: [] } }

// WebSocket server reference for broadcasting
let _wss = null;
export function setWss(wss) { _wss = wss; }

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
    metrics.daily[day] = {
      messages: 0,
      errors: 0,
      tokens: { input: 0, output: 0 },
      totalResponseMs: 0,
      successCount: 0
    };
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
 * Check department health and send alerts if needed
 */
function checkDepartmentHealth(deptId, isError, responseTime) {
  if (!healthState[deptId]) {
    healthState[deptId] = { consecutiveErrors: 0, lastAlertTime: 0, recentResponseTimes: [] };
  }

  const state = healthState[deptId];
  const now = Date.now();

  if (isError) {
    state.consecutiveErrors++;

    // Alert on 3+ consecutive errors (5-minute cooldown)
    if (state.consecutiveErrors >= 3 && now - state.lastAlertTime > 5 * 60 * 1000) {
      state.lastAlertTime = now;

      // Import notify dynamically to avoid circular deps
      import('./notifications.js').then(({ notifyError }) => {
        notifyError('health', `Department ${deptId} health alert`, `${state.consecutiveErrors} consecutive errors detected`);
      }).catch(() => {});

      // Broadcast health alert via WebSocket
      if (_wss) {
        const payload = JSON.stringify({
          event: 'health:alert',
          data: { deptId, consecutiveErrors: state.consecutiveErrors },
          timestamp: new Date().toISOString(),
        });
        _wss.clients.forEach(c => {
          if (c.readyState === 1 && c._authenticated) try { c.send(payload); } catch {}
        });
      }
    }
  } else {
    // Reset consecutive errors on success
    state.consecutiveErrors = 0;

    // Track recent response times for performance alerts
    state.recentResponseTimes.push(responseTime);
    if (state.recentResponseTimes.length > 5) {
      state.recentResponseTimes.shift();
    }

    // Alert if recent avg > 2x historical avg (5-minute cooldown)
    if (state.recentResponseTimes.length === 5 && now - state.lastAlertTime > 5 * 60 * 1000) {
      const recentAvg = state.recentResponseTimes.reduce((a, b) => a + b, 0) / 5;
      const deptMetrics = metrics.departments[deptId];
      if (deptMetrics && deptMetrics.avgResponseMs > 0 && recentAvg > deptMetrics.avgResponseMs * 2) {
        state.lastAlertTime = now;

        import('./notifications.js').then(({ notifyWarning }) => {
          notifyWarning('health', `Department ${deptId} slow response`, `Recent avg: ${Math.round(recentAvg)}ms (historical: ${deptMetrics.avgResponseMs}ms)`);
        }).catch(() => {});
      }
    }
  }
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

    // Record daily response time
    day.successCount++;
    day.totalResponseMs += durationMs;
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

  // Check health after recording
  checkDepartmentHealth(deptId, isError, durationMs);

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

    // Compute avgResponseMs per daily entry
    const dailyWithAvg = Object.fromEntries(
      Object.entries(metrics.daily).map(([date, day]) => [
        date,
        {
          ...day,
          avgResponseMs: day.successCount > 0 ? Math.round(day.totalResponseMs / day.successCount) : 0
        }
      ])
    );

    // Build healthStatus from healthState
    const healthStatus = Object.fromEntries(
      Object.keys(healthState).map(id => [id, {
        consecutiveErrors: healthState[id].consecutiveErrors,
        status: healthState[id].consecutiveErrors >= 3 ? 'error' :
                healthState[id].consecutiveErrors >= 1 ? 'warning' : 'healthy'
      }])
    );

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
      daily: dailyWithAvg,
      healthStatus,
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

/**
 * Calculate trust score from existing metrics
 */
function calculateTrustScore(deptId) {
  const dept = metrics.departments[deptId];
  if (!dept) return { score: 50, breakdown: {} };

  const totalMessages = dept.messageCount || 0;
  const totalErrors = dept.errorCount || 0;
  const avgResponseMs = dept.avgResponseMs || 0;

  // Reliability: fewer errors = higher score (0-30 points)
  const errorRate = totalMessages > 0 ? totalErrors / totalMessages : 0;
  const reliability = Math.max(0, 30 * (1 - errorRate * 5));

  // Speed: faster responses = higher score (0-25 points)
  const speed = avgResponseMs < 5000 ? 25 :
                avgResponseMs < 15000 ? 20 :
                avgResponseMs < 30000 ? 15 :
                avgResponseMs < 60000 ? 10 : 5;

  // Activity: more messages = higher engagement (0-25 points)
  const activity = Math.min(25, totalMessages * 0.5);

  // Consistency: check daily metrics if available (0-20 points)
  const today = new Date().toISOString().split('T')[0];
  const dailyData = metrics.daily[today];
  const consistency = dailyData && dailyData[deptId] ? 20 : 10;

  const total = Math.round(reliability + speed + activity + consistency);

  return {
    score: Math.min(100, Math.max(0, total)),
    breakdown: {
      reliability: Math.round(reliability),
      speed: Math.round(speed),
      activity: Math.round(activity),
      consistency: Math.round(consistency)
    },
    stats: {
      totalMessages,
      totalErrors,
      errorRate: Math.round(errorRate * 100),
      avgResponseMs: Math.round(avgResponseMs)
    }
  };
}

/**
 * GET /api/metrics/trust-scores
 * Get trust scores for all departments
 */
router.get('/trust-scores', (req, res) => {
  try {
    const scores = {};
    for (const deptId of Object.keys(metrics.departments)) {
      scores[deptId] = calculateTrustScore(deptId);
    }

    // Sort by score descending for leaderboard
    const leaderboard = Object.entries(scores)
      .sort(([,a], [,b]) => b.score - a.score)
      .map(([deptId, data], rank) => ({ rank: rank + 1, deptId, ...data }));

    res.json({ leaderboard, updatedAt: new Date().toISOString() });
  } catch (error) {
    console.error('[Metrics] Error getting trust scores:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
