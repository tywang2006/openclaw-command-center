import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createWatcher, getInitialState } from './watcher.js';
import apiRoutes from './routes/api.js';
import { startPolling, stopPolling } from './telegram.js';
import { getGateway } from './gateway.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);

// Configuration
const HOST = '127.0.0.1';
const PORT = 5100;

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// CORS headers for development
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// API routes
app.use('/api', apiRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    wsClients: wss.clients.size,
    gateway: getGateway().stats,
  });
});

// Serve static files in production under /cmd/
const distPath = path.join(__dirname, '../dist');
app.use('/cmd', express.static(distPath));

// SPA fallback - serve index.html for /cmd/* routes
app.get('/cmd/*', (req, res) => {
  const indexPath = path.join(distPath, 'index.html');
  if (fs.existsSync(indexPath)) {
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

// WebSocket server at /ws path
const wss = new WebSocketServer({
  server,
  path: '/ws'
});

wss.on('connection', (ws, req) => {
  const clientIp = req.socket.remoteAddress;
  console.log(`[WebSocket] Client connected from ${clientIp}`);
  console.log(`[WebSocket] Total clients: ${wss.clients.size}`);

  // Send initial state immediately upon connection
  try {
    const initialState = getInitialState();
    ws.send(JSON.stringify({
      event: 'connected',
      data: initialState,
      timestamp: new Date().toISOString()
    }));
    console.log(`[WebSocket] Sent initial state to ${clientIp}`);
  } catch (error) {
    console.error('[WebSocket] Error sending initial state:', error);
  }

  // Handle incoming messages from client (no echo — just log for debugging)
  ws.on('message', (message) => {
    try {
      const str = message.toString();
      if (str.length > 1000) return; // Ignore oversized messages
      console.log(`[WebSocket] Received from ${clientIp}: ${str.substring(0, 100)}`);
    } catch (error) {
      console.error('[WebSocket] Error processing message:', error);
    }
  });

  ws.on('close', () => {
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

// Start Telegram polling for live messages
startPolling(wss);

// Connect to OpenClaw Gateway
const gateway = getGateway();
gateway.connect().then(() => {
  console.log('[Gateway] Connected to OpenClaw Gateway');
}).catch(err => {
  console.error('[Gateway] Initial connection failed (will retry):', err.message);
});

// Graceful shutdown
function gracefulShutdown(signal) {
  console.log(`[Server] ${signal} received, shutting down gracefully...`);
  stopPolling();
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

// Start server
server.listen(PORT, HOST, () => {
  console.log('='.repeat(60));
  console.log('OpenClaw Command Center Backend');
  console.log('='.repeat(60));
  console.log(`HTTP Server: http://${HOST}:${PORT}`);
  console.log(`WebSocket:   ws://${HOST}:${PORT}/ws`);
  console.log(`API Base:    http://${HOST}:${PORT}/api`);
  console.log('='.repeat(60));
  console.log('Watching OpenClaw workspace for changes...');
  console.log('Press Ctrl+C to stop');
  console.log('='.repeat(60));
});

export { app, server, wss };
