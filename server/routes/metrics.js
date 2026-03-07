import express from 'express';
import { getGateway } from '../gateway.js';

const router = express.Router();

// In-memory metrics store
const metrics = {
  global: {
    totalMessages: 0,
    totalErrors: 0,
    avgResponseMs: 0,
    gatewayReconnects: 0,
    sessionStart: Date.now(),
  },
  departments: {}, // deptId -> department metrics
};

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
 * @param {string} deptId - Department ID
 * @param {number} durationMs - Response duration in milliseconds
 * @param {boolean} isError - Whether the request resulted in an error
 */
export function recordChat(deptId, durationMs, isError = false) {
  const deptMetrics = ensureDepartmentMetrics(deptId);

  // Update department metrics
  deptMetrics.messageCount++;
  deptMetrics.lastResponseMs = durationMs;

  if (isError) {
    deptMetrics.errorCount++;
    metrics.global.totalErrors++;
  } else {
    deptMetrics.totalResponseMs += durationMs;
    deptMetrics.avgResponseMs = Math.round(
      deptMetrics.totalResponseMs / (deptMetrics.messageCount - deptMetrics.errorCount)
    );

    // Add to recent response times (keep last 50)
    deptMetrics.recentResponseTimes.push(durationMs);
    if (deptMetrics.recentResponseTimes.length > 50) {
      deptMetrics.recentResponseTimes.shift();
    }
  }

  // Update global metrics
  metrics.global.totalMessages++;

  // Recalculate global average response time
  let totalResponseMs = 0;
  let successfulMessages = 0;
  for (const dept of Object.values(metrics.departments)) {
    totalResponseMs += dept.totalResponseMs;
    successfulMessages += dept.messageCount - dept.errorCount;
  }
  metrics.global.avgResponseMs = successfulMessages > 0
    ? Math.round(totalResponseMs / successfulMessages)
    : 0;
}

/**
 * Record token usage for a department.
 * @param {string} deptId - Department ID
 * @param {Object} usage - Token usage object { inputTokens, outputTokens }
 */
export function recordTokens(deptId, usage) {
  if (!usage) return;

  const deptMetrics = ensureDepartmentMetrics(deptId);
  const inputTokens = usage.inputTokens || 0;
  const outputTokens = usage.outputTokens || 0;

  deptMetrics.tokens.input += inputTokens;
  deptMetrics.tokens.output += outputTokens;
  deptMetrics.tokens.total += inputTokens + outputTokens;
}

/**
 * Record a gateway reconnection event.
 */
export function recordGatewayReconnect() {
  metrics.global.gatewayReconnects++;
}

// Permission event log (F15)
const permissionLog = [];

/**
 * Record a permission event.
 * @param {string} deptId - Department ID
 * @param {string} toolName - Tool that requested permission
 */
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

/**
 * Get recent permission events.
 */
export function getPermissionLog() {
  return permissionLog.slice(-50);
}

// GET /api/metrics - Get all metrics data
router.get('/metrics', (req, res) => {
  try {
    const now = Date.now();
    const uptime = now - metrics.global.sessionStart;

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      uptime: uptime,
      global: {
        ...metrics.global,
        uptime,
      },
      departments: metrics.departments,
    });
  } catch (error) {
    console.error('[Metrics] Error getting metrics:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// GET /api/metrics/permissions - Get recent permission events (F15)
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

// GET /api/gateway/stats - Get gateway stats
router.get('/gateway/stats', (req, res) => {
  try {
    const gateway = getGateway();
    const stats = gateway.stats;

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      gateway: stats,
    });
  } catch (error) {
    console.error('[Metrics] Error getting gateway stats:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

export default router;
