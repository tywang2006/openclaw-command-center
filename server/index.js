import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createWatcher, getInitialState } from './watcher.js';
import apiRoutes from './routes/api.js';
import skillsRoutes from './routes/skills.js';
import cronRoutes from './routes/cron.js';
import metricsRoutes, { recordPermission, flushMetrics, setWss, recordGatewayReconnect } from './routes/metrics.js';
import workflowsRoutes from './routes/workflows.js';
import replayRoutes, { isRecording, addReplayEvent } from './routes/replay.js';
import capabilitiesRoutes from './routes/capabilities.js';
import documentsRoutes from './routes/documents.js';
import filesRoutes from './routes/files.js';
import integrationsConfigRoutes, { syncAutoBackupCronJob } from './routes/integrations-config.js';
import systemConfigRoutes from './routes/system-config.js';
import systemExtrasRoutes from './routes/system-extras.js';
import emailRoutes from './routes/email.js';
import driveRoutes from './routes/drive.js';
import voiceRoutes from './routes/voice.js';
import searchRoutes from './routes/search.js';
import auditRoutes, { recordAudit } from './routes/audit.js';
import notificationsRoutes, { notifyError, notifyWarning, notifyInfo } from './routes/notifications.js';
import meetingsRoutes from './routes/meetings.js';
import chatRetryRouter from './routes/chat-retry.js';
import pushRouter from './routes/push.js';
import { getGateway } from './gateway.js';
import { authRouter, authMiddleware, validateToken, onTokensCleared, onTokenRevoked } from './auth.js';
import setupRoutes, { checkSetupStatus } from './routes/setup.js';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { BASE_PATH } from './utils.js';
import crypto from 'crypto';
import { startSubAgentCleanup, handleGatewayDisconnect, cleanupAsyncRequest } from './agent.js';
import { createLogger } from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const log = createLogger('Server');

// Global interval references for cleanup
let subAgentCleanupInterval = null;

// Ensure minimum directory structure exists (for fresh installs)
const requiredDirs = [
  path.join(BASE_PATH, 'departments'),
  path.join(BASE_PATH, 'departments', 'bulletin'),
  path.join(BASE_PATH, 'agents', 'main', 'sessions'),
];
for (const dir of requiredDirs) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    log.info('Created missing directory', { dir });
  }
}

const app = express();
const server = http.createServer(app);

// Configuration
const HOST = process.env.CMD_HOST || '127.0.0.1';
const PORT = parseInt(process.env.CMD_PORT || '5100', 10);

// Trust proxy — required behind nginx reverse proxy so req.ip reflects
// the real client IP (from X-Forwarded-For) instead of nginx's 127.0.0.1.
// This affects rate limiting and the setup endpoint's localhost check.
app.set('trust proxy', 'loopback');

// Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'", "ws:", "wss:"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: null,  // Disable — no HTTPS on this server
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: false,  // Allow loading through nginx reverse proxy
  crossOriginOpenerPolicy: false,    // Not useful without HTTPS
}));

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// CORS headers — restrict to configured origins
const CORS_ORIGIN = process.env.CORS_ORIGIN || `http://localhost:${PORT}`;
const allowedOrigins = CORS_ORIGIN.split(',').map(o => o.trim());

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Rewrite /cmd/* → /* so frontend (BASE_URL=/cmd/) hits the right routes.
// Covers /cmd/api/*, /cmd/health, etc.
app.use((req, res, next) => {
  if (req.url.startsWith('/cmd/api')) {
    req.url = req.url.replace('/cmd/api', '/api');
  } else if (req.url.startsWith('/cmd/health')) {
    req.url = req.url.replace('/cmd/health', '/health');
  }
  next();
});

// TraceId middleware — attach unique ID to every request for correlated logging
app.use((req, res, next) => {
  req.traceId = req.headers['x-trace-id'] || crypto.randomUUID().replace(/-/g, '').substring(0, 16);
  res.setHeader('X-Trace-Id', req.traceId);
  next();
});

// Authentication routes (must be BEFORE authMiddleware)
app.use('/api/auth', authRouter);

// Setup routes (no auth required — needed for first-run wizard)
app.use('/api', setupRoutes);

// Health check (no auth required) — minimal info only
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

// Apply authentication middleware to all API routes
app.use('/api', authMiddleware);

// Authenticated health check — full details
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    wsClients: wss.clients.size,
    gateway: getGateway().stats,
  });
});

// Rate limiting for resource-intensive endpoints (LLM calls, email, file ops)
const heavyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please slow down' },
});
app.use('/api/departments/:id/chat', heavyLimiter);
app.use('/api/broadcast', heavyLimiter);
app.use('/api/email/send', heavyLimiter);
app.use('/api/voice/transcribe', heavyLimiter);
app.use('/api/drive/upload', heavyLimiter);
app.use('/api/drive/backup', heavyLimiter);
app.use('/api/meetings/:id/message', heavyLimiter);
app.use('/api/meetings/:id/negotiate', heavyLimiter);

// Strict rate limiting for admin/credential endpoints (5 req/min)
const adminLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many admin requests, please slow down' },
});
app.use('/api/system/config', adminLimiter);
app.use('/api/system/shutdown', adminLimiter);
app.use('/api/system/openclaw/update', adminLimiter);
app.use('/api/integrations/config', adminLimiter);
app.use('/api/skills/install', adminLimiter);

// API routes
app.use('/api', apiRoutes);
app.use('/api', skillsRoutes);
app.use('/api/cron', cronRoutes);
app.use('/api', metricsRoutes);
app.use('/api/workflows', workflowsRoutes);
app.use('/api/replay', replayRoutes);
app.use('/api', capabilitiesRoutes);
app.use('/api', documentsRoutes);
app.use('/api', filesRoutes);
app.use('/api', integrationsConfigRoutes);
app.use('/api', systemConfigRoutes);
app.use('/api', systemExtrasRoutes);
app.use('/api', emailRoutes);
app.use('/api', driveRoutes);
app.use('/api', voiceRoutes);
app.use('/api', searchRoutes);
app.use('/api', auditRoutes);
app.use('/api', notificationsRoutes);
app.use('/api/meetings', meetingsRoutes);
app.use('/api/departments', chatRetryRouter);
app.use('/api/push', pushRouter);

// Global Express error handler
app.use((err, req, res, next) => {
  log.error('Unhandled Express error', { error: err.stack || err.message || err });
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Internal server error' });
});

// Serve static files in production under /cmd/
const distPath = path.join(__dirname, '../dist');
app.use('/cmd', express.static(distPath, {
  maxAge: '1y',                // hashed assets cache forever
  immutable: true,
  setHeaders(res, filePath) {
    // index.html must never be cached — it references hashed assets
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  },
}));

// SPA fallback - serve index.html for /cmd/* routes
app.get('/cmd/{*splat}', (req, res) => {
  const indexPath = path.join(distPath, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile('index.html', { root: distPath });
  } else {
    res.status(404).json({
      error: 'Frontend not built yet',
      hint: 'Run `npm run build` to build the React frontend'
    });
  }
});

// Redirect root to /cmd/
app.get('/', (req, res) => {
  res.redirect('/cmd/');
});
app.get('/cmd', (req, res) => {
  res.redirect('/cmd/');
});

// WebSocket server — accept both /ws and /cmd/ws
const wss = new WebSocketServer({ noServer: true, maxPayload: 1048576 });
app.locals.wss = wss; // Expose to routes for broadcasting
setWss(wss); // Pass to metrics for health alerts

// Track active WebSocket connections with their auth tokens
const activeWsConnections = new Set();

server.on('upgrade', (req, socket, head) => {
  const pathname = new URL(req.url, `http://${req.headers.host}`).pathname;
  if (pathname === '/ws' || pathname === '/cmd/ws') {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  } else {
    socket.destroy();
  }
});

// Throttle noisy WS logs — only log unauthorized once per IP per 30s
const _wsUnauthLog = new Map();
// Cleanup stale entries every 60s to prevent unbounded growth
setInterval(() => {
  const cutoff = Date.now() - 60000;
  for (const [ip, ts] of _wsUnauthLog) {
    if (ts < cutoff) _wsUnauthLog.delete(ip);
  }
}, 60000);

wss.on('connection', (ws, req) => {
  const clientIp = req.socket.remoteAddress;
  let authenticated = false;

  // Auth via first message — client must send { type: 'auth', token } within 5s
  const authTimeout = setTimeout(() => {
    if (!authenticated) {
      ws.close(1008, 'Auth timeout');
    }
  }, 5000);

  ws.on('message', function onFirstMessage(raw) {
    if (authenticated) return;

    try {
      const str = raw.toString();
      if (str.length > 1000) { ws.close(1008, 'Message too large'); return; }
      const msg = JSON.parse(str);

      if (msg.type !== 'auth' || !validateToken(msg.token)) {
        const now = Date.now();
        const last = _wsUnauthLog.get(clientIp) || 0;
        if (now - last > 30000) {
          log.info('Unauthorized WebSocket connection', { clientIp });
          _wsUnauthLog.set(clientIp, now);
        }
        ws.close(1008, 'Unauthorized');
        return;
      }

      // Connection limit check (before marking authenticated to prevent TOCTOU race)
      const authCount = [...wss.clients].filter(c => c._authenticated).length;
      if (authCount >= 10) {
        log.warn('WebSocket connection limit reached', { authCount });
        clearTimeout(authTimeout);
        ws.close(1013, 'Max connections reached');
        return;
      }

      authenticated = true;
      ws._authenticated = true;
      ws._authToken = msg.token;
      clearTimeout(authTimeout);
      ws.removeListener('message', onFirstMessage);

      // Track this connection for auth revocation
      activeWsConnections.add(ws);

      log.info('WebSocket client authenticated', { clientIp, totalClients: wss.clients.size });

      // Start ping interval only after auth succeeds
      const pingInterval = setInterval(() => {
        if (ws.readyState === 1) {
          ws.ping();
        } else {
          clearInterval(pingInterval);
        }
      }, 30000);
      ws.on('close', () => {
        clearInterval(pingInterval);
        activeWsConnections.delete(ws);
      });

      // Send initial state after successful auth
      try {
        const initialState = getInitialState();
        const gatewayStats = getGateway().stats;
        ws.send(JSON.stringify({
          event: 'connected',
          data: {
            ...initialState,
            gateway: gatewayStats,
          },
          timestamp: new Date().toISOString()
        }));
      } catch (error) {
        log.error('Error sending initial state', { error: error.message });
      }

      // Set up normal message handler
      ws.on('message', (message) => {
        try {
          const s = message.toString();
          if (s.length > 1000) return;
          log.info('WebSocket message received', { clientIp, message: s.substring(0, 100) });
        } catch (error) {
          log.error('Error processing WebSocket message', { clientIp, error: error.message });
        }
      });
    } catch (err) {
      log.warn('Invalid WebSocket auth message', { clientIp, error: err.message });
      ws.close(1008, 'Invalid auth message');
    }
  });

  ws.on('close', () => {
    clearTimeout(authTimeout);
    if (authenticated) {
      log.info('WebSocket client disconnected', { clientIp, totalClients: wss.clients.size });
    }
  });

  ws.on('error', (error) => {
    log.error('WebSocket error', { clientIp, error: error.message });
  });

});

// Create file watcher and attach to WebSocket server
const watcher = createWatcher(wss);

// Connect to OpenClaw Gateway
const gateway = getGateway();
gateway.connect().then(() => {
  log.info('Connected to OpenClaw Gateway');
  notifyInfo('gateway', 'Gateway Connected', 'Successfully connected to ChaoClaw Gateway');
}).catch(err => {
  log.warn('Gateway initial connection failed', { error: err.message });
  log.warn('AI features will be unavailable until Gateway connection is fixed');
  notifyWarning('gateway', 'Gateway Not Connected', err.message + ' — AI features unavailable');
});

// Load department config for session-key-to-department mapping
// Uses mutable maps so file watcher can hot-reload without restart
const deptConfigPath = path.join(BASE_PATH, 'departments', 'config.json');
let deptNames = {};
let topicToDept = {};

function loadDeptMaps() {
  try {
    const raw = fs.readFileSync(deptConfigPath, 'utf8');
    const config = JSON.parse(raw);
    const idToName = {};
    const topicToId = {};
    // Forward-compatible: handle both { departments: {...} } and flat object
    const depts = config.departments || config;
    for (const [deptId, dept] of Object.entries(depts)) {
      if (typeof dept !== 'object' || !dept) continue;
      idToName[deptId] = dept.name || deptId;
      if (dept.telegramTopicId !== undefined) {
        topicToId[String(dept.telegramTopicId)] = deptId;
      }
    }
    deptNames = idToName;
    topicToDept = topicToId;
    log.info('Loaded department config', { departmentCount: Object.keys(idToName).length });
  } catch (err) {
    log.error('Failed to load department config', { error: err.message });
  }
}
loadDeptMaps();

// Watch config.json for hot-reload (forward-compatible with file moves)
try {
  fs.watchFile(deptConfigPath, { interval: 2000 }, () => {
    log.info('Department config changed, reloading');
    loadDeptMaps();
  });
} catch (err) {
  log.warn('Failed to watch config file', { error: err.message });
}

/**
 * Parse a Gateway session key to extract the department ID.
 * Handles:
 *   agent:main:telegram:group:{groupId}:topic:{topicId} → topicId → deptId
 *   agent:main:{deptId}                                 → deptId
 *   agent:main:{deptId}:sub:{subId}                     → deptId
 */
function sessionKeyToDeptId(sessionKey) {
  if (!sessionKey) return null;
  // Telegram session: agent:main:telegram:group:-1003570960670:topic:1430
  const tgMatch = sessionKey.match(/^agent:main:telegram:group:[^:]+:topic:(\d+)$/);
  if (tgMatch) {
    return topicToDept[tgMatch[1]] || null;
  }
  // Direct session: agent:main:{deptId} or agent:main:{deptId}:sub:{subId}
  const parts = sessionKey.split(':');
  if (parts.length >= 3 && parts[0] === 'agent' && parts[1] === 'main') {
    const deptId = parts[2];
    if (deptNames[deptId]) return deptId;
  }
  return null;
}

// Broadcast gateway status changes to frontend
gateway.onStatus(({ status, detail }) => {
  if (status === 'connected' && detail === 'reconnected') recordGatewayReconnect();

  // H9 fix: Handle gateway disconnect - fail all pending async requests
  if (status === 'disconnected' || status === 'fatal') {
    handleGatewayDisconnect();
  }

  const payload = JSON.stringify({
    event: 'gateway:status',
    data: { status, detail },
    timestamp: new Date().toISOString(),
  });
  wss.clients.forEach(c => { if (c.readyState === 1 && c._authenticated) try { c.send(payload); } catch (err) { /* client disconnected */ } });
});

// Close all authenticated WS connections when tokens are cleared (password change)
onTokensCleared(() => {
  let closed = 0;
  activeWsConnections.forEach(c => {
    try { c.close(4001, 'auth-revoked'); } catch (err) { /* expected during cleanup */ }
    closed++;
  });
  activeWsConnections.clear();
  if (closed > 0) log.info('Closed WebSocket connections after password change', { closedCount: closed });
});

// Close specific WS connection when a single token is revoked (logout)
onTokenRevoked((revokedToken) => {
  let closed = 0;
  activeWsConnections.forEach(c => {
    if (c._authToken === revokedToken) {
      try { c.close(4001, 'auth-revoked'); } catch (err) { /* expected during cleanup */ }
      closed++;
    }
  });
  if (closed > 0) log.info('Closed WebSocket connections for revoked token', { closedCount: closed });
});

// Listen for Gateway events (Telegram messages, cron responses, etc.)
gateway.onEvent((event) => {
  if (event.type === 'agent:message') {
    const deptId = sessionKeyToDeptId(event.sessionKey);
    if (!deptId) {
      log.info('Gateway event with unmatched session', { sessionKey: event.sessionKey });
      return;
    }

    const deptName = deptNames[deptId];
    const timestamp = new Date().toISOString();

    log.info('Gateway event received', { deptId, replyLength: (event.assistantMessage || '').length, sessionKey: event.sessionKey });

    // H9 fix: Clean up async request tracking when response arrives
    if (event.requestId) {
      cleanupAsyncRequest(event.requestId);
    }

    // Broadcast assistant response to frontend WebSocket clients
    if (event.assistantMessage) {
      const payload = JSON.stringify({
        event: 'activity:new',
        data: {
          deptId,
          role: 'assistant',
          text: event.assistantMessage,
          fromName: deptName,
          source: 'gateway',
        },
        timestamp,
      });
      wss.clients.forEach(c => { if (c.readyState === 1 && c._authenticated) try { c.send(payload); } catch (err) { /* client disconnected */ } });
      // Record for replay (F13)
      if (isRecording()) addReplayEvent(JSON.parse(payload));
    }
  }

  // Forward tool:update events to frontend
  if (event.type === 'tool:update') {
    const deptId = sessionKeyToDeptId(event.sessionKey);
    if (!deptId) return;

    const payload = JSON.stringify({
      event: 'tool:update',
      data: {
        deptId,
        toolName: event.toolName,
        toolStatus: event.toolStatus,
        done: event.done,
      },
      timestamp: new Date().toISOString(),
    });
    wss.clients.forEach(c => { if (c.readyState === 1 && c._authenticated) try { c.send(payload); } catch (err) { /* client disconnected */ } });
    if (isRecording()) addReplayEvent(JSON.parse(payload));
  }

  // Forward streaming chunks to frontend (F14)
  if (event.type === 'agent:stream') {
    const deptId = sessionKeyToDeptId(event.sessionKey);
    if (!deptId) return;

    const payload = JSON.stringify({
      event: 'chat:stream',
      data: { deptId, chunk: event.chunk },
      timestamp: new Date().toISOString(),
    });
    wss.clients.forEach(c => { if (c.readyState === 1 && c._authenticated) try { c.send(payload); } catch (err) { /* client disconnected */ } });
    if (isRecording()) addReplayEvent(JSON.parse(payload));
  }

  // Record permission events (F15)
  if (event.type === 'permission:event') {
    const deptId = sessionKeyToDeptId(event.sessionKey);
    if (!deptId) return;
    recordPermission(deptId, event.toolName);
  }
});

// Sync auto backup config to OpenClaw cron on startup
syncAutoBackupCronJob();

// Start sub-agent cleanup scheduler
subAgentCleanupInterval = startSubAgentCleanup();

// Graceful shutdown
function gracefulShutdown(signal) {
  log.info('Shutting down gracefully', { signal });
  flushMetrics();
  getGateway().disconnect();
  watcher.close();

  // Stop sub-agent cleanup scheduler
  if (subAgentCleanupInterval) {
    clearInterval(subAgentCleanupInterval);
    log.info('SubAgent cleanup scheduler stopped');
  }

  // Close all WebSocket clients
  for (const client of wss.clients) {
    try { client.close(1001, 'Server shutting down'); } catch (err) { /* expected during shutdown */ }
  }

  server.close(() => {
    log.info('Closed all connections');
    process.exit(0);
  });

  // Force exit after 5s if graceful close hangs
  setTimeout(() => {
    log.error('Forced exit after timeout');
    process.exit(1);
  }, 5000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  log.error('Unhandled Promise rejection', { reason });
});

process.on('uncaughtException', (err) => {
  log.error('Uncaught exception', { error: err });
  setTimeout(() => process.exit(1), 1000);
});

// Always regenerate layout from actual department config on startup.
// The bundled default-layout.json reflects the dev environment and won't
// match a fresh install's department list.
try {
  const { generateAndSave } = await import('./layout-generator.js');
  const result = generateAndSave({ distPath });
  if (result.departmentCount > 0) {
    log.info('Generated layout', { departmentCount: result.departmentCount });
  }
} catch (err) {
  log.warn('Layout generation skipped', { error: err.message });
}

// Start server
server.listen(PORT, HOST, () => {
  log.info('='.repeat(60));
  log.info('ChaoClaw Command Center Backend');
  log.info('='.repeat(60));
  log.info(`HTTP Server: http://${HOST}:${PORT}`);
  log.info(`WebSocket:   ws://${HOST}:${PORT}/ws`);
  log.info(`API Base:    http://${HOST}:${PORT}/api`);
  log.info('='.repeat(60));
  log.info('Watching ChaoClaw workspace for changes...');
  log.info('Press Ctrl+C to stop');
  log.info('='.repeat(60));
});

export { app, server, wss };
