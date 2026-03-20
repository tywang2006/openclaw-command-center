import WebSocket from 'ws';
import crypto, { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { getConfigValue, safeWriteFileSync } from './utils.js';
import { createLogger } from './logger.js';

const gLog = createLogger('Gateway');

const GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL || 'ws://127.0.0.1:18789';
const HEARTBEAT_INTERVAL_MS = 25000;
const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 60000; // Reduced from 30s to 60s max delay
const RECONNECT_MAX_ATTEMPTS = 5; // Stop retrying after N consecutive failures
const REQUEST_TIMEOUT_MS = 120000; // 2 minutes
const MAX_STREAM_BUFFER_BYTES = 1048576; // 1MB per stream buffer
const MAX_PENDING_REQUESTS = 100; // Maximum concurrent pending requests
const MAX_TOTAL_STREAM_BUFFERS = 50; // Maximum total stream buffers
const STUCK_REQUEST_THRESHOLD_MS = 90000; // 90s (3/4 of REQUEST_TIMEOUT_MS)
const STUCK_REQUEST_SCAN_INTERVAL_MS = 30000; // Scan every 30 seconds

// Fatal error codes — do not reconnect on these
const FATAL_ERROR_CODES = ['NOT_PAIRED', 'AUTH_FAILED', 'INVALID_TOKEN', 'FORBIDDEN', 'INVALID_REQUEST'];

// Forward-compatible: support protocol range so newer Gateway versions still work
const MIN_PROTOCOL = 3;
const MAX_PROTOCOL = 5;

// Client identity for gateway connection (must be from GATEWAY_CLIENT_IDS allowlist)
const CLIENT_ID = 'gateway-client';
const CLIENT_MODE = 'backend';
const CONNECT_ROLE = 'operator';
const CONNECT_SCOPES = ['operator.admin', 'operator.write', 'operator.read'];

// Ed25519 SPKI header (12 bytes) — raw public key starts after this prefix
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

function base64UrlEncode(buf) {
  return buf.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
}

/**
 * Load or create an Ed25519 device identity for command-center.
 */
function loadOrCreateDeviceIdentity() {
  const home = process.env.OPENCLAW_HOME || path.join(process.env.HOME || '/root', '.openclaw');
  const identityPath = path.join(home, 'plugins', 'command-center', 'device.json');

  try {
    if (fs.existsSync(identityPath)) {
      const parsed = JSON.parse(fs.readFileSync(identityPath, 'utf8'));
      if (parsed?.version === 1 && parsed.deviceId && parsed.publicKeyPem && parsed.privateKeyPem) {
        return parsed;
      }
    }
  } catch (err) {
    gLog.warn('Failed to load device identity:', err.message);
  }

  // Generate new Ed25519 keypair
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

  // Device ID = SHA-256 of raw public key bytes
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  const rawPub = spki.length === ED25519_SPKI_PREFIX.length + 32 &&
    spki.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)
    ? spki.subarray(ED25519_SPKI_PREFIX.length)
    : spki;
  const deviceId = crypto.createHash('sha256').update(rawPub).digest('hex');

  const stored = { version: 1, deviceId, publicKeyPem, privateKeyPem, createdAtMs: Date.now() };
  fs.mkdirSync(path.dirname(identityPath), { recursive: true });
  safeWriteFileSync(identityPath, JSON.stringify(stored, null, 2) + '\n', { mode: 0o600 });
  gLog.info('Generated new device identity:', deviceId);
  return stored;
}

/**
 * Build the `device` field for the connect handshake (challenge-response signing).
 */
function buildDeviceAuthField(identity, nonce, token) {
  const signedAtMs = Date.now();

  // Build v2 signing payload: version|deviceId|clientId|clientMode|role|scopes|signedAt|token|nonce
  const version = nonce ? 'v2' : 'v1';
  const parts = [
    version,
    identity.deviceId,
    CLIENT_ID,
    CLIENT_MODE,
    CONNECT_ROLE,
    CONNECT_SCOPES.join(','),
    String(signedAtMs),
    token ?? '',
  ];
  if (version === 'v2') {
    parts.push(nonce ?? '');
  }
  const payload = parts.join('|');

  // Sign with Ed25519 private key
  const key = crypto.createPrivateKey(identity.privateKeyPem);
  const sig = crypto.sign(null, Buffer.from(payload, 'utf8'), key);

  // Raw public key in base64url
  const spki = crypto.createPublicKey(identity.publicKeyPem).export({ type: 'spki', format: 'der' });
  const rawPub = spki.length === ED25519_SPKI_PREFIX.length + 32 &&
    spki.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)
    ? spki.subarray(ED25519_SPKI_PREFIX.length)
    : spki;

  const field = {
    id: identity.deviceId,
    publicKey: base64UrlEncode(rawPub),
    signature: base64UrlEncode(sig),
    signedAt: signedAtMs,
  };
  if (nonce) field.nonce = nonce;
  return field;
}

/**
 * Resolve gateway auth token (shared secret).
 */
function resolveAuthToken() {
  if (process.env.OPENCLAW_AUTH_TOKEN) return process.env.OPENCLAW_AUTH_TOKEN;

  // Try gateway.auth.token first
  const token = getConfigValue('gateway.auth.token') ||
                getConfigValue('authToken') ||
                getConfigValue('token') ||
                getConfigValue('auth.token');
  return token || '';
}

class GatewayClient {
  constructor() {
    this.ws = null;
    this.connected = false;
    this.authenticated = false;
    this.reconnectAttempt = 0;
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    this.shutdownRequested = false;
    this._hasEverConnected = false;

    // Map<requestId, { resolve, reject, timer }>
    this.pendingRequests = new Map();

    // Promise for connect handshake
    this._connectResolve = null;
    this._connectReject = null;

    // Track connecting promise to prevent duplicate connections
    this._connectingPromise = null;

    // Callbacks waiting for ready state
    this._readyCallbacks = [];

    // Event listeners for Gateway events (agent streaming, channel messages, etc.)
    this._eventListeners = [];

    // Status change listeners (connected/disconnected/fatal)
    this._statusListeners = [];

    // Accumulate streaming text per runId: Map<runId, { sessionKey, chunks, userMessage }>
    this._streamBuffers = new Map();

    // Recently resolved request IDs — prevents late agent events from being broadcast as duplicates
    this._resolvedRequests = new Map();

    // Track connection time for uptime
    this._connectedAt = null;

    // Periodic cleanup of stale stream buffers (every 60s)
    this._bufferCleanupTimer = setInterval(() => {
      if (this._streamBuffers.size === 0) return;
      const staleThreshold = Date.now() - 300000;
      for (const [id, buf] of this._streamBuffers) {
        if (buf.startedAt < staleThreshold) {
          this._streamBuffers.delete(id);
        }
      }
    }, 60000);

    // Periodic cleanup of resolved request IDs (every 60s, keep last 30s)
    this._resolvedCleanupTimer = setInterval(() => {
      if (this._resolvedRequests.size === 0) return;
      const cutoff = Date.now() - REQUEST_TIMEOUT_MS; // Match 120s request timeout
      for (const [id, ts] of this._resolvedRequests) {
        if (ts < cutoff) this._resolvedRequests.delete(id);
      }
      // LRU eviction: keep max 1000 entries
      if (this._resolvedRequests.size > 1000) {
        const entries = [...this._resolvedRequests.entries()].sort((a, b) => a[1] - b[1]);
        const toRemove = entries.slice(0, entries.length - 1000);
        for (const [id] of toRemove) this._resolvedRequests.delete(id);
      }
    }, 60000);

    // Start stuck request scanner
    this.startStuckRequestScanner();
  }

  connect() {
    if (this.shutdownRequested) {
      return Promise.reject(new Error('Client is shutting down'));
    }

    // If already connected and authenticated, return resolved promise
    if (this.connected && this.authenticated && this.ws?.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }

    // If already connecting, return the same promise
    if (this._connectingPromise) {
      return this._connectingPromise;
    }

    this._connectingPromise = new Promise((resolve, reject) => {
      this._connectResolve = resolve;
      this._connectReject = reject;

      // Connection timeout - reject if neither resolve nor reject is called within 30s
      const connectTimeout = setTimeout(() => {
        if (this._connectReject) {
          this._connectingPromise = null;
          this._connectReject(new Error('Connection timeout (30s)'));
          this._connectResolve = null;
          this._connectReject = null;
          // Close the potentially stuck socket
          if (this.ws) {
            try {
              this.ws.terminate();
            } catch (err) {
              gLog.warn('[Gateway] Error terminating stuck socket:', err.message);
            }
          }
        }
      }, 30000);

      // Store timeout ID so we can clear it on resolve/reject
      this._connectTimeout = connectTimeout;

      // Cleanup old WebSocket if it exists and isn't closed
      if (this.ws) {
        this.ws.removeAllListeners();
        if (this.ws.readyState !== WebSocket.CLOSED) {
          try {
            this.ws.close(1000, 'Reconnecting');
          } catch (err) {
            gLog.error('Error closing old WebSocket:', err.message);
          }
        }
      }

      // Reset handshake state for new connection
      this._handshakeSent = false;
      this._challengeNonce = null;

      try {
        this.ws = new WebSocket(GATEWAY_URL);
      } catch (err) {
        clearTimeout(connectTimeout);
        this._connectingPromise = null;
        reject(err);
        this._scheduleReconnect();
        return;
      }

      this.ws.on('open', () => this._handleOpen());
      this.ws.on('message', (data) => this._handleMessage(data));
      this.ws.on('close', (code, reason) => this._handleClose(code, reason));
      this.ws.on('error', (err) => this._handleError(err));
      this.ws.on('pong', () => { this._lastPong = Date.now(); });
    });

    return this._connectingPromise;
  }

  disconnect() {
    this.shutdownRequested = true;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this._backgroundRetryTimer) {
      clearTimeout(this._backgroundRetryTimer);
      this._backgroundRetryTimer = null;
    }
    this._inBackgroundRetry = false;
    this._stopHeartbeat();

    if (this._challengeTimer) {
      clearTimeout(this._challengeTimer);
      this._challengeTimer = null;
    }
    if (this._bufferCleanupTimer) {
      clearInterval(this._bufferCleanupTimer);
      this._bufferCleanupTimer = null;
    }
    if (this._resolvedCleanupTimer) {
      clearInterval(this._resolvedCleanupTimer);
      this._resolvedCleanupTimer = null;
    }
    if (this._stuckRequestScannerTimer) {
      clearInterval(this._stuckRequestScannerTimer);
      this._stuckRequestScannerTimer = null;
    }
    this._streamBuffers.clear();
    this._resolvedRequests.clear();

    for (const [, req] of this.pendingRequests) {
      clearTimeout(req.timer);
      req.reject(new Error('Client disconnecting'));
    }
    this.pendingRequests.clear();

    if (this.ws) {
      try {
        this.ws.close(1000, 'Client shutdown');
      } catch (err) {
        gLog.warn('[Gateway] Error closing socket during shutdown:', err.message);
      }
      this.ws = null;
    }

    this.connected = false;
    this.authenticated = false;
    gLog.info('Disconnected');
  }

  // --- Internal ---

  _handleOpen() {
    gLog.info('WebSocket connected, waiting for challenge...');
    this.connected = true;
    // Note: reconnectAttempt is reset only after successful authentication,
    // not here. Resetting on TCP connect causes infinite loops when the
    // gateway is reachable but auth fails repeatedly.
    this._challengeNonce = null;

    // If no challenge arrives within 2s, send handshake without nonce (fallback)
    this._challengeTimer = setTimeout(() => {
      if (!this._handshakeSent) {
        gLog.info('No challenge received, sending handshake without nonce');
        this._sendHandshake(null);
      }
    }, 2000);
  }

  _handleChallenge(nonce) {
    if (this._challengeTimer) {
      clearTimeout(this._challengeTimer);
      this._challengeTimer = null;
    }
    this._challengeNonce = nonce;
    this._sendHandshake(nonce);
  }

  _sendHandshake(nonce) {
    if (this._handshakeSent) return;
    this._handshakeSent = true;

    const token = resolveAuthToken();
    const identity = loadOrCreateDeviceIdentity();

    const params = {
      minProtocol: MIN_PROTOCOL,
      maxProtocol: MAX_PROTOCOL,
      client: {
        id: CLIENT_ID,
        version: '1.4.0',
        platform: process.platform || 'linux',
        mode: CLIENT_MODE,
        displayName: 'Command Center',
      },
      role: CONNECT_ROLE,
      scopes: CONNECT_SCOPES,
      caps: ['tool-events', 'agent-events', 'channel-events'],
      auth: { token },
      device: buildDeviceAuthField(identity, nonce, token),
    };

    gLog.info('Sending handshake with device auth (deviceId:', identity.deviceId.substring(0, 12) + '..., nonce:', nonce ? 'yes' : 'no', ')');
    this._send({ type: 'req', id: 'connect', method: 'connect', params });
  }

  _handleMessage(raw) {
    const str = raw.toString();

    if (str === 'pong') {
      this._lastPong = Date.now();
      return;
    }

    let frame;
    try {
      frame = JSON.parse(str);
    } catch (err) {
      gLog.warn('Failed to parse message:', err.message);
      return;
    }

    // Intercept connect.challenge before authentication completes
    if (frame.type === 'event' && frame.event === 'connect.challenge') {
      const nonce = frame.payload?.nonce;
      gLog.info('Received connect.challenge, nonce:', nonce ? nonce.substring(0, 8) + '...' : 'none');
      if (nonce) {
        this._handleChallenge(nonce);
      }
      return;
    }

    if (frame.type === 'res') {
      this._handleResponse(frame);
    } else if (frame.type === 'event') {
      // Log agent events only on start/completion, all other events always
      if (frame.event === 'agent') {
        const status = frame.payload?.status;
        if (status === 'started' || status === 'completed' || status === 'done' || status === 'finished') {
          const preview = JSON.stringify(frame).substring(0, 300);
          gLog.info(`Event ${frame.event}: ${preview}`);
        } else if (process.env.GATEWAY_DEBUG) {
          const preview = JSON.stringify(frame).substring(0, 300);
          gLog.info(`Event ${frame.event}: ${preview}`);
        }
      } else {
        const preview = JSON.stringify(frame).substring(0, 300);
        gLog.info(`Event ${frame.event}: ${preview}`);
      }
      this._handleEvent(frame);
    } else {
      // Log unknown frame types
      gLog.info(`Frame type=${frame.type}: ${JSON.stringify(frame).substring(0, 200)}`);
    }
  }

  _handleResponse(frame) {
    // Connect handshake
    if (frame.id === 'connect') {
      if (frame.error) {
        const code = frame.error.code || '';
        const msg = frame.error.message || 'Handshake failed';
        gLog.error(`Connect handshake failed: ${code} — ${msg}`);
        this.authenticated = false;

        // Fatal errors — stop reconnecting entirely
        if (FATAL_ERROR_CODES.includes(code)) {
          gLog.warn(`Fatal error (${code}), will NOT retry. Fix config and restart.`);
          this.shutdownRequested = true;
          if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
          }
          this._emitStatus('fatal', `${code}: ${msg}`);
        }

        if (this._connectReject) {
          if (this._connectTimeout) {
            clearTimeout(this._connectTimeout);
            this._connectTimeout = null;
          }
          this._connectingPromise = null;
          this._connectReject(new Error(msg));
          this._connectResolve = null;
          this._connectReject = null;
        }
        return;
      }

      this.authenticated = true;
      this._connectedAt = Date.now();
      this.reconnectAttempt = 0; // Reset only after successful auth
      // Log granted scopes if present in hello-ok response
      const auth = frame.payload?.auth;
      if (auth?.scopes) {
        gLog.info('Authenticated, granted scopes:', auth.scopes.join(', '));
      } else {
        gLog.info('Authenticated successfully');
      }
      this._startHeartbeat();

      if (this._connectResolve) {
        if (this._connectTimeout) {
          clearTimeout(this._connectTimeout);
          this._connectTimeout = null;
        }
        this._connectingPromise = null;
        this._connectResolve();
        this._connectResolve = null;
        this._connectReject = null;
      }

      // Notify all waiting callbacks that we're ready
      this._notifyReadyCallbacks();
      const isReconnect = this._hasEverConnected;
      this._hasEverConnected = true;

      // Record gateway reconnect in metrics (H14 fix)
      if (isReconnect) {
        import('./routes/metrics.js').then(({ recordGatewayReconnect }) => {
          recordGatewayReconnect();
        }).catch(() => {});
      }

      this._emitStatus('connected', isReconnect ? 'reconnected' : 'initial');
      return;
    }

    // Agent request response
    const req = this.pendingRequests.get(frame.id);
    if (!req) return;

    if (frame.error) {
      clearTimeout(req.timer);
      this.pendingRequests.delete(frame.id);
      this._markResolved(frame.id);
      gLog.error(`Request ${frame.id} error:`, frame.error.message || frame.error.code);
      req.reject(new Error(frame.error.message || `Gateway error: ${frame.error.code}`));
      return;
    }

    // Raw requests — resolve with full payload immediately
    if (req.raw) {
      clearTimeout(req.timer);
      this.pendingRequests.delete(frame.id);
      this._markResolved(frame.id);
      req.resolve(frame.payload || {});
      return;
    }

    // Skip the "accepted" acknowledgment — wait for the final "ok"/"completed" response
    const status = frame.payload?.status;
    if (status === 'accepted') {
      gLog.info(`Request ${frame.id} accepted, waiting for completion...`);
      return;
    }

    // Final response — extract text and usage data
    clearTimeout(req.timer);
    this.pendingRequests.delete(frame.id);
    this._markResolved(frame.id);

    let text = '';
    const payloads = frame.payload?.result?.payloads;
    if (Array.isArray(payloads)) {
      text = payloads.map(p => p.text || '').join('');
    }

    const usage = frame.payload?.result?.usage || null;

    gLog.info(`Request ${frame.id} completed, ${text.length} chars`);
    req.resolve({ text, usage });
  }

  _handleEvent(frame) {
    const { event, payload } = frame;

    // Agent streaming events — accumulate text and notify on completion
    if (event === 'agent') {
      this._handleAgentEvent(payload);
      return;
    }

    // Forward all other events to listeners
    for (const listener of this._eventListeners) {
      try { listener(frame); } catch (err) { gLog.warn('Event listener error:', err.message); }
    }
  }

  _handleAgentEvent(payload) {
    if (!payload) return;

    const { sessionKey, runId, requestId, stream, chunk, status } = payload;
    const bufferId = runId || requestId;
    if (!bufferId) return;

    // Skip events from our OWN requests (pending or recently resolved)
    if (requestId && (this.pendingRequests.has(requestId) || this._resolvedRequests.has(requestId))) return;

    // Stream start — initialize buffer
    if (status === 'started' || (stream && !this._streamBuffers.has(bufferId))) {
      if (!this._streamBuffers.has(bufferId)) {
        // P1 fix: enforce MAX_TOTAL_STREAM_BUFFERS limit
        if (this._streamBuffers.size >= MAX_TOTAL_STREAM_BUFFERS) {
          // Evict oldest buffer (LRU eviction)
          let oldestId = null;
          let oldestTime = Infinity;
          for (const [id, buf] of this._streamBuffers) {
            if (buf.startedAt < oldestTime) {
              oldestTime = buf.startedAt;
              oldestId = id;
            }
          }
          if (oldestId) {
            gLog.warn(`Stream buffer limit (${MAX_TOTAL_STREAM_BUFFERS}) reached, evicting oldest buffer: ${oldestId}`);
            this._streamBuffers.delete(oldestId);
          }
        }

        this._streamBuffers.set(bufferId, {
          sessionKey: sessionKey || '',
          userMessage: payload.userMessage || '',
          assistantChunks: [],
          startedAt: Date.now(),
          requestId: requestId || runId, // H9 fix: Store requestId for cleanup
        });
      }
    }

    const buffer = this._streamBuffers.get(bufferId);
    if (!buffer) return;

    // Capture user message if provided
    if (payload.userMessage) {
      buffer.userMessage = payload.userMessage;
    }

    // Accumulate assistant text chunks (cap at MAX_STREAM_BUFFER_BYTES)
    if (stream === 'assistant' && chunk?.type === 'text' && chunk.text) {
      buffer.totalBytes = (buffer.totalBytes || 0) + Buffer.byteLength(chunk.text, 'utf8');
      if (buffer.totalBytes > MAX_STREAM_BUFFER_BYTES) {
        gLog.warn(`Stream buffer ${bufferId} exceeded ${MAX_STREAM_BUFFER_BYTES / 1024}KB, truncating`);
        this._streamBuffers.delete(bufferId);
        return;
      }
      buffer.assistantChunks.push(chunk.text);

      // Strip context tags from streaming chunks
      let cleanChunk = chunk.text;
      if (cleanChunk.includes('<department_context>') || cleanChunk.includes('<subagent_context>')) {
        cleanChunk = cleanChunk
          .replace(/<department_context>[\s\S]*?<\/department_context>\s*/g, '')
          .replace(/<subagent_context>[\s\S]*?<\/subagent_context>\s*/g, '');
      }

      // Only emit non-empty chunks (F14)
      if (cleanChunk) {
        const streamChunkEvent = {
          type: 'agent:stream',
          sessionKey: buffer.sessionKey || sessionKey,
          chunk: cleanChunk,
        };
        for (const listener of this._eventListeners) {
          try { listener(streamChunkEvent); } catch (err) { gLog.warn('Stream listener error:', err.message); }
        }
      }
    }

    // Detect tool events and emit tool:update to listeners
    const _detectedToolName = chunk?.toolName || payload.toolName;
    if (_detectedToolName && (stream === 'tool' || (chunk && chunk.toolName))) {
      const toolName = _detectedToolName;
      const toolStatus = chunk?.status || payload.data?.status || 'running';
      const done = toolStatus === 'completed' || toolStatus === 'done' || toolStatus === 'error';
      const toolEvent = {
        type: 'tool:update',
        sessionKey: buffer.sessionKey || sessionKey,
        toolName,
        toolStatus,
        done,
      };
      for (const listener of this._eventListeners) {
        try { listener(toolEvent); } catch (err) { gLog.warn('Tool event listener error:', err.message); }
      }

      // Detect permission wait events (F15)
      if (toolStatus === 'permission' || toolStatus === 'waiting_permission' || chunk?.permissionWait) {
        const permEvent = {
          type: 'permission:event',
          sessionKey: buffer.sessionKey || sessionKey,
          toolName,
          timestamp: Date.now(),
        };
        for (const listener of this._eventListeners) {
          try { listener(permEvent); } catch (err) { gLog.warn('Permission event listener error:', err.message); }
        }
      }
    }

    // Stream completed — emit full message to listeners
    // Check both payload.status and lifecycle phase end
    if (status === 'completed' || status === 'done' || status === 'finished' ||
        (stream === 'lifecycle' && payload.data?.phase === 'end')) {
      let fullText = buffer.assistantChunks.join('');

      // Strip context tags from final assistant message
      fullText = fullText
        .replace(/<department_context>[\s\S]*?<\/department_context>\s*/g, '')
        .replace(/<subagent_context>[\s\S]*?<\/subagent_context>\s*/g, '')
        .trim();

      // Strip context tags from user message
      let cleanUserMessage = buffer.userMessage
        .replace(/<department_context>[\s\S]*?<\/department_context>\s*/g, '')
        .replace(/<subagent_context>[\s\S]*?<\/subagent_context>\s*/g, '')
        .trim();

      this._streamBuffers.delete(bufferId);

      if (fullText || cleanUserMessage) {
        const event = {
          type: 'agent:message',
          sessionKey: buffer.sessionKey || sessionKey,
          userMessage: cleanUserMessage,
          assistantMessage: fullText,
          timestamp: Date.now(),
          requestId: buffer.requestId, // H9 fix: Include requestId for async request cleanup
        };

        for (const listener of this._eventListeners) {
          try { listener(event); } catch (err) { gLog.warn('Agent message listener error:', err.message); }
        }
      }
    }

    // Clean up stale buffers (older than 5 minutes)
    if (this._streamBuffers.size > 0) {
      const staleThreshold = Date.now() - 300000;
      for (const [id, buf] of this._streamBuffers) {
        if (buf.startedAt < staleThreshold) {
          this._streamBuffers.delete(id);
        }
      }
    }
  }

  /** Track a resolved requestId to prevent late agent events from being broadcast */
  _markResolved(requestId) {
    this._resolvedRequests.set(requestId, Date.now());
  }

  /**
   * Register a listener for Gateway events.
   * Listeners receive: { type, sessionKey, userMessage, assistantMessage, timestamp }
   */
  onEvent(callback) {
    this._eventListeners.push(callback);
  }

  /** Remove a previously registered event listener */
  offEvent(callback) {
    const idx = this._eventListeners.indexOf(callback);
    if (idx >= 0) this._eventListeners.splice(idx, 1);
  }

  /** Register a listener for gateway status changes (connected/disconnected/fatal) */
  onStatus(callback) {
    this._statusListeners.push(callback);
  }

  _emitStatus(status, detail) {
    for (const listener of this._statusListeners) {
      try { listener({ status, detail }); } catch (err) { gLog.warn('Status listener error:', err.message); }
    }
  }

  _handleClose(code, reason) {
    const reasonStr = reason ? reason.toString() : '';
    gLog.info(`Connection closed: code=${code} reason=${reasonStr}`);
    this.connected = false;
    this.authenticated = false;
    this._stopHeartbeat();
    if (this._challengeTimer) {
      clearTimeout(this._challengeTimer);
      this._challengeTimer = null;
    }

    if (this._connectReject) {
      if (this._connectTimeout) {
        clearTimeout(this._connectTimeout);
        this._connectTimeout = null;
      }
      this._connectingPromise = null;
      this._connectReject(new Error(`Connection closed: ${code}`));
      this._connectResolve = null;
      this._connectReject = null;
    }

    // Reject all waiting ready callbacks
    this._rejectReadyCallbacks(new Error('Connection closed'));

    for (const [, req] of this.pendingRequests) {
      clearTimeout(req.timer);
      req.reject(new Error('Gateway connection lost'));
    }
    this.pendingRequests.clear();

    // Set ws to null before scheduling reconnect to prevent duplicate reconnects
    this.ws = null;
    this._emitStatus('disconnected', `code=${code}`);

    if (!this.shutdownRequested) {
      this._scheduleReconnect();
    }
  }

  _handleError(err) {
    gLog.error('WebSocket error:', err.message);
  }

  _scheduleReconnect() {
    if (this.shutdownRequested || this.reconnectTimer) return;

    this.reconnectAttempt++;

    if (this.reconnectAttempt > RECONNECT_MAX_ATTEMPTS) {
      // If already in background retry mode, don't start another
      if (this._inBackgroundRetry) return;
      gLog.warn(`Max reconnect attempts (${RECONNECT_MAX_ATTEMPTS}) reached. Will retry every 5 minutes in background.`);
      this._scheduleBackgroundRetry();
      return;
    }

    const baseDelay = Math.min(
      RECONNECT_BASE_DELAY_MS * Math.pow(2, this.reconnectAttempt - 1),
      RECONNECT_MAX_DELAY_MS
    );

    // Add jitter: delay * (0.5 + Math.random() * 0.5) to prevent thundering herd
    const jitter = 0.5 + Math.random() * 0.5;
    const delay = Math.floor(baseDelay * jitter);

    gLog.info(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempt}/${RECONNECT_MAX_ATTEMPTS})...`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch(err => {
        gLog.error('Reconnect failed:', err.message);
      });
    }, delay);
  }

  /** Background retry after max reconnect attempts exhausted — exponential backoff capped at 60s */
  _scheduleBackgroundRetry() {
    if (this.shutdownRequested || this._backgroundRetryTimer) return;
    let bgDelay = 30000; // Start at 30s
    this._inBackgroundRetry = true;
    const retry = () => {
      this._backgroundRetryTimer = null;
      if (this.shutdownRequested || this.connected) {
        this._inBackgroundRetry = false;
        return;
      }
      gLog.info(`Background retry attempt (next in ${bgDelay / 1000}s)...`);
      // Keep reconnectAttempt high so _scheduleReconnect won't start a
      // parallel normal-reconnect cycle — it will call _scheduleBackgroundRetry
      // which will no-op due to _inBackgroundRetry guard.
      this.connect().then(() => {
        this._inBackgroundRetry = false;
      }).catch(err => {
        gLog.error('Background retry failed:', err.message);
        bgDelay = Math.min(bgDelay * 1.5, 60000);
        this._backgroundRetryTimer = setTimeout(retry, bgDelay);
      });
    };
    this._backgroundRetryTimer = setTimeout(retry, bgDelay);
  }

  _startHeartbeat() {
    this._stopHeartbeat();
    this._lastPong = Date.now();
    this.heartbeatTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        this._stopHeartbeat();
        return;
      }

      // Check if pong is stale (no response for 2 heartbeat intervals)
      const staleness = Date.now() - this._lastPong;
      if (staleness > HEARTBEAT_INTERVAL_MS * 2) {
        gLog.warn(`Heartbeat stale (${staleness}ms since last pong), forcing reconnect`);
        this._stopHeartbeat();
        if (this.ws) {
          try {
            this.ws.terminate();
          } catch (err) {
            gLog.error('Error terminating stale connection:', err.message);
          }
        }
        return;
      }

      try { this.ws.ping(); } catch (err) { gLog.warn('Ping error:', err.message); }
    }, HEARTBEAT_INTERVAL_MS);
  }

  _stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Start periodic scanner to detect stuck requests (requests pending > 90s).
   * Logs warnings for requests approaching the 120s timeout threshold.
   */
  startStuckRequestScanner() {
    // Clear existing scanner if any
    if (this._stuckRequestScannerTimer) {
      clearInterval(this._stuckRequestScannerTimer);
    }

    this._stuckRequestScannerTimer = setInterval(() => {
      if (this.pendingRequests.size === 0) return;

      const now = Date.now();
      for (const [requestId, req] of this.pendingRequests) {
        if (!req.startTime) continue; // Skip if startTime not set (shouldn't happen)

        const elapsed = now - req.startTime;
        if (elapsed > STUCK_REQUEST_THRESHOLD_MS) {
          const sessionKey = req.sessionKey || 'unknown';
          gLog.warn('Stuck request detected', {
            requestId,
            elapsed: Math.floor(elapsed / 1000) + 's',
            sessionKey,
            traceId: req.traceId || '',
            raw: req.raw || false
          });
        }
      }
    }, STUCK_REQUEST_SCAN_INTERVAL_MS);
  }

  // --- Public API ---

  /**
   * Send a raw request to the Gateway and resolve with the full payload.
   * Used for methods like chat.history, sessions.list, etc.
   */
  _sendRawRequest(method, params, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      if (!this.connected || !this.authenticated) {
        return reject(new Error('Gateway not connected'));
      }

      // Check if queue is full (P0 fix: prevent unbounded pendingRequests growth)
      if (this.pendingRequests.size >= MAX_PENDING_REQUESTS) {
        return reject(new Error(`Gateway queue full (${MAX_PENDING_REQUESTS} pending requests)`));
      }

      const requestId = `raw_${randomUUID().replace(/-/g, '').substring(0, 12)}`;
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`Request ${method} timeout`));
      }, timeoutMs);

      this.pendingRequests.set(requestId, { resolve, reject, timer, raw: true, startTime: Date.now() });

      try {
        this._send({ type: 'req', id: requestId, method, params });
      } catch (err) {
        clearTimeout(timer);
        this.pendingRequests.delete(requestId);
        reject(err);
      }
    });
  }

  /**
   * Get chat history for a session.
   */
  async getChatHistory(sessionKey, limit = 20) {
    const payload = await this._sendRawRequest('chat.history', { sessionKey, limit });
    return payload.messages || [];
  }

  /**
   * List all sessions on the gateway.
   */
  async listSessions() {
    const payload = await this._sendRawRequest('sessions.list', {});
    return payload.sessions || [];
  }

  /**
   * Send a message to an agent session and collect the full response.
   * Waits for the gateway "res" frame which contains the complete reply text.
   */
  sendAgentMessage(sessionKey, message, attachments = [], options = {}) {
    return new Promise((resolve, reject) => {
      if (!this.connected || !this.authenticated) {
        return reject(new Error('Gateway not connected'));
      }

      // Check if queue is full (P0 fix: prevent unbounded pendingRequests growth)
      if (this.pendingRequests.size >= MAX_PENDING_REQUESTS) {
        return reject(new Error(`Gateway queue full (${MAX_PENDING_REQUESTS} pending requests)`));
      }

      const traceId = options.traceId || '';
      const reqUuid = randomUUID().replace(/-/g, '');
      const requestId = `req_${reqUuid}`;
      const idempotencyKey = `cmd_${sessionKey}_${Date.now()}_${reqUuid.substring(0, 8)}`;

      const timer = setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId);
          reject(new Error('Request timeout (120s)'));
        }
      }, REQUEST_TIMEOUT_MS);

      this.pendingRequests.set(requestId, {
        resolve,
        reject,
        timer,
        traceId,
        sessionKey,
        startTime: Date.now()
      });

      try {
        this._send({
          type: 'req',
          id: requestId,
          method: 'agent',
          params: {
            agentId: 'main',
            sessionKey,
            message,
            attachments: attachments.length > 0 ? attachments : [],
            deliver: false,
            idempotencyKey,
          },
        });
        gLog.info(`Sent request ${requestId} to session ${sessionKey}`, { traceId, requestId, sessionKey });
      } catch (err) {
        clearTimeout(timer);
        this.pendingRequests.delete(requestId);
        reject(err);
      }
    });
  }

  /**
   * Fire-and-forget: send message to agent but don't wait for response.
   * Response events will flow through to WebSocket listeners since
   * the requestId isn't tracked in pendingRequests.
   */
  sendAgentMessageAsync(sessionKey, message, attachments = [], options = {}) {
    if (!this.connected || !this.authenticated) {
      throw new Error('Gateway not connected');
    }

    const traceId = options.traceId || '';
    const reqUuid = randomUUID().replace(/-/g, '');
    const requestId = `req_${reqUuid}`;
    const idempotencyKey = `cmd_${sessionKey}_${Date.now()}_${reqUuid.substring(0, 8)}`;

    this._send({
      type: 'req',
      id: requestId,
      method: 'agent',
      params: {
        agentId: 'main',
        sessionKey,
        message,
        attachments: attachments.length > 0 ? attachments : [],
        deliver: false,
        idempotencyKey,
      },
    });
    gLog.info(`Sent async request ${requestId} to session ${sessionKey}`, { traceId, requestId, sessionKey });
    return requestId;
  }

  // H4 fix: Increase default timeout from 5s/10s to 15s for gateway reconnection
  waitForReady(timeoutMs = 15000) {
    if (this.isReady) return Promise.resolve();

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        // Remove from callback list on timeout
        const idx = this._readyCallbacks.findIndex(cb => cb.resolve === resolve);
        if (idx !== -1) this._readyCallbacks.splice(idx, 1);
        reject(new Error('Gateway connection timeout'));
      }, timeoutMs);

      // Add to callback list, will be called when authenticated
      this._readyCallbacks.push({
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
    });
  }

  _notifyReadyCallbacks() {
    const callbacks = this._readyCallbacks.slice();
    this._readyCallbacks = [];
    for (const cb of callbacks) {
      cb.resolve();
    }
  }

  _rejectReadyCallbacks(error) {
    const callbacks = this._readyCallbacks.slice();
    this._readyCallbacks = [];
    for (const cb of callbacks) {
      cb.reject(error);
    }
  }

  get isReady() {
    return this.connected && this.authenticated;
  }

  get stats() {
    const uptime = this._connectedAt ? Date.now() - this._connectedAt : 0;

    // Count stuck requests (pending > 90s)
    let stuckRequests = 0;
    const now = Date.now();
    for (const [, req] of this.pendingRequests) {
      if (req.startTime && (now - req.startTime) > STUCK_REQUEST_THRESHOLD_MS) {
        stuckRequests++;
      }
    }

    return {
      connected: this.connected,
      authenticated: this.authenticated,
      pendingRequests: this.pendingRequests.size,
      maxPendingRequests: MAX_PENDING_REQUESTS,
      stuckRequests,
      reconnectAttempt: this.reconnectAttempt,
      uptime,
      streamBuffers: this._streamBuffers.size,
      maxStreamBuffers: MAX_TOTAL_STREAM_BUFFERS,
    };
  }

  _send(frame) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not open');
    }
    this.ws.send(JSON.stringify(frame));
  }
}

let gateway = null;

function getGateway() {
  if (!gateway) {
    gateway = new GatewayClient();
  }
  return gateway;
}

export { GatewayClient, getGateway };
