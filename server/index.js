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
import metricsRoutes, { recordPermission, flushMetrics } from './routes/metrics.js';
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
import { getGateway } from './gateway.js';
import { authRouter, authMiddleware, validateToken } from './auth.js';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { BASE_PATH } from './utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure minimum directory structure exists (for fresh installs)
const requiredDirs = [
  path.join(BASE_PATH, 'departments'),
  path.join(BASE_PATH, 'departments', 'bulletin'),
  path.join(BASE_PATH, 'agents', 'main', 'sessions'),
];
for (const dir of requiredDirs) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`[Bootstrap] Created missing directory: ${dir}`);
  }
}

const app = express();
const server = http.createServer(app);

// Configuration
const HOST = process.env.CMD_HOST || '127.0.0.1';
const PORT = parseInt(process.env.CMD_PORT || '5100', 10);

// Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
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

// Rewrite /cmd/api/* → /api/* so frontend (BASE_URL=/cmd/) hits the right routes.
// One middleware, covers all current and future /api routes automatically.
app.use((req, res, next) => {
  if (req.url.startsWith('/cmd/api')) {
    req.url = req.url.replace('/cmd/api', '/api');
  }
  next();
});

// Authentication routes (must be BEFORE authMiddleware)
app.use('/api/auth', authRouter);

// Health check (no auth required)
const healthHandler = (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    wsClients: wss.clients.size,
    gateway: getGateway().stats,
  });
};
app.get('/health', healthHandler);
app.get('/api/health', healthHandler);

// Apply authentication middleware to all API routes
app.use('/api', authMiddleware);

// Rate limiting for resource-intensive endpoints (LLM calls, email, file ops)
const heavyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please slow down' },
});
app.use('/api/departments/:id/chat', heavyLimiter);
app.use('/api/departments/:id/broadcast', heavyLimiter);
app.use('/api/email/send', heavyLimiter);
app.use('/api/voice/transcribe', heavyLimiter);
app.use('/api/drive/upload', heavyLimiter);
app.use('/api/drive/backup', heavyLimiter);

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

// Global Express error handler
app.use((err, req, res, next) => {
  console.error('[Server] Unhandled Express error:', err.stack || err.message || err);
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
    res.sendFile(indexPath);
  } else {
    res.status(404).json({
      error: 'Frontend not built yet',
      hint: 'Run `npm run build` to build the React frontend'
    });
  }
});

// Redirect root /cmd to /cmd/
app.get('/cmd', (req, res) => {
  res.redirect('/cmd/');
});

// WebSocket server — accept both /ws and /cmd/ws
const wss = new WebSocketServer({ noServer: true });
app.locals.wss = wss; // Expose to routes for broadcasting

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

wss.on('connection', (ws, req) => {
  const clientIp = req.socket.remoteAddress;
  let authenticated = false;

  // Auth via first message — client must send { type: 'auth', token } within 5s
  const authTimeout = setTimeout(() => {
    if (!authenticated) {
      console.log(`[WebSocket] Auth timeout for ${clientIp}`);
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
        console.log(`[WebSocket] Unauthorized connection from ${clientIp}`);
        ws.close(1008, 'Unauthorized');
        return;
      }

      authenticated = true;
      ws._authenticated = true;
      clearTimeout(authTimeout);
      ws.removeListener('message', onFirstMessage);

      console.log(`[WebSocket] Client authenticated from ${clientIp}`);
      console.log(`[WebSocket] Total clients: ${wss.clients.size}`);

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
        console.error('[WebSocket] Error sending initial state:', error);
      }

      // Set up normal message handler
      ws.on('message', (message) => {
        try {
          const s = message.toString();
          if (s.length > 1000) return;
          console.log(`[WebSocket] Received from ${clientIp}: ${s.substring(0, 100)}`);
        } catch (error) {
          console.error('[WebSocket] Error processing message:', error);
        }
      });
    } catch {
      ws.close(1008, 'Invalid auth message');
    }
  });

  ws.on('close', () => {
    clearTimeout(authTimeout);
    console.log(`[WebSocket] Client disconnected from ${clientIp}`);
    console.log(`[WebSocket] Total clients: ${wss.clients.size}`);
  });

  ws.on('error', (error) => {
    console.error(`[WebSocket] Error for ${clientIp}:`, error.message);
  });

  // Send a ping every 30 seconds to keep connection alive
  const pingInterval = setInterval(() => {
    if (ws.readyState === 1) { // WebSocket.OPEN
      ws.ping();
    } else {
      clearInterval(pingInterval);
    }
  }, 30000);

  ws.on('close', () => {
    clearInterval(pingInterval);
  });
});

// Create file watcher and attach to WebSocket server
const watcher = createWatcher(wss);

// Connect to OpenClaw Gateway
const gateway = getGateway();
gateway.connect().then(() => {
  console.log('[Gateway] Connected to OpenClaw Gateway');
  notifyInfo('gateway', 'Gateway Connected', 'Successfully connected to ChaoClaw Gateway');
}).catch(err => {
  console.warn('[Gateway] Initial connection failed:', err.message);
  console.warn('[Gateway] AI features will be unavailable until Gateway connection is fixed.');
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
    console.log(`[Config] Loaded ${Object.keys(idToName).length} departments`);
  } catch (err) {
    console.error('[Config] Failed to load department config:', err.message);
  }
}
loadDeptMaps();

// Watch config.json for hot-reload (forward-compatible with file moves)
try {
  fs.watchFile(deptConfigPath, { interval: 2000 }, () => {
    console.log('[Config] Department config changed, reloading...');
    loadDeptMaps();
  });
} catch {}

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

// Listen for Gateway events (Telegram messages, cron responses, etc.)
gateway.onEvent((event) => {
  if (event.type === 'agent:message') {
    const deptId = sessionKeyToDeptId(event.sessionKey);
    if (!deptId) {
      console.log(`[Gateway Event] Unmatched session: ${event.sessionKey}`);
      return;
    }

    const deptName = deptNames[deptId];
    const timestamp = new Date().toISOString();

    console.log(`[Gateway Event] ${deptId}: reply=${(event.assistantMessage || '').length}chars session=${event.sessionKey}`);

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
      wss.clients.forEach(c => { if (c.readyState === 1 && c._authenticated) try { c.send(payload); } catch {} });
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
    wss.clients.forEach(c => { if (c.readyState === 1 && c._authenticated) try { c.send(payload); } catch {} });
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
    wss.clients.forEach(c => { if (c.readyState === 1 && c._authenticated) try { c.send(payload); } catch {} });
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

// Graceful shutdown
function gracefulShutdown(signal) {
  console.log(`[Server] ${signal} received, shutting down gracefully...`);
  flushMetrics();
  getGateway().disconnect();
  watcher.close();

  // Close all WebSocket clients
  for (const client of wss.clients) {
    try { client.close(1001, 'Server shutting down'); } catch {}
  }

  server.close(() => {
    console.log('[Server] Closed all connections');
    process.exit(0);
  });

  // Force exit after 5s if graceful close hangs
  setTimeout(() => {
    console.error('[Server] Forced exit after timeout');
    process.exit(1);
  }, 5000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  console.error('[Server] Unhandled Promise rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[Server] Uncaught exception:', err);
  setTimeout(() => process.exit(1), 1000);
});

// Auto-generate layout if missing (first run or fresh install)
try {
  const layoutPath = path.join(__dirname, '..', 'dist', 'assets', 'default-layout.json');
  if (!fs.existsSync(layoutPath)) {
    const { generateAndSave } = await import('./layout-generator.js');
    const result = generateAndSave();
    if (result.departmentCount > 0) {
      console.log(`[Startup] Generated layout: ${result.departmentCount} departments`);
    }
  }
} catch (err) {
  console.warn('[Startup] Layout generation skipped:', err.message);
}

// Start server
server.listen(PORT, HOST, () => {
  console.log('='.repeat(60));
  console.log('ChaoClaw Command Center Backend');
  console.log('='.repeat(60));
  console.log(`HTTP Server: http://${HOST}:${PORT}`);
  console.log(`WebSocket:   ws://${HOST}:${PORT}/ws`);
  console.log(`API Base:    http://${HOST}:${PORT}/api`);
  console.log('='.repeat(60));
  console.log('Watching ChaoClaw workspace for changes...');
  console.log('Press Ctrl+C to stop');
  console.log('='.repeat(60));
});

export { app, server, wss };
