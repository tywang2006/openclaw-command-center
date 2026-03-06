import WebSocket from 'ws';
import { randomUUID } from 'crypto';

const GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL || 'ws://127.0.0.1:18789';
const AUTH_TOKEN = process.env.OPENCLAW_AUTH_TOKEN || '231f8798242b198b234e1b384c370d234db76ffc1d7bc043';
const HEARTBEAT_INTERVAL_MS = 25000;
const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 30000;
const REQUEST_TIMEOUT_MS = 120000; // 2 minutes

class GatewayClient {
  constructor() {
    this.ws = null;
    this.connected = false;
    this.authenticated = false;
    this.reconnectAttempt = 0;
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    this.shutdownRequested = false;

    // Map<requestId, { resolve, reject, timer }>
    this.pendingRequests = new Map();

    // Promise for connect handshake
    this._connectResolve = null;
    this._connectReject = null;

    // Track connecting promise to prevent duplicate connections
    this._connectingPromise = null;

    // Callbacks waiting for ready state
    this._readyCallbacks = [];
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

      // Cleanup old WebSocket if it exists and isn't closed
      if (this.ws && this.ws.readyState !== WebSocket.CLOSED) {
        try {
          this.ws.close(1000, 'Reconnecting');
        } catch (err) {
          console.error('[Gateway] Error closing old WebSocket:', err.message);
        }
      }

      try {
        this.ws = new WebSocket(GATEWAY_URL);
      } catch (err) {
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

    // Clear the connecting promise when resolved/rejected
    this._connectingPromise.finally(() => {
      this._connectingPromise = null;
    });

    return this._connectingPromise;
  }

  disconnect() {
    this.shutdownRequested = true;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this._stopHeartbeat();

    for (const [, req] of this.pendingRequests) {
      clearTimeout(req.timer);
      req.reject(new Error('Client disconnecting'));
    }
    this.pendingRequests.clear();

    if (this.ws) {
      try { this.ws.close(1000, 'Client shutdown'); } catch {}
      this.ws = null;
    }

    this.connected = false;
    this.authenticated = false;
    console.log('[Gateway] Disconnected');
  }

  // --- Internal ---

  _handleOpen() {
    console.log('[Gateway] WebSocket connected, sending handshake...');
    this.connected = true;
    this.reconnectAttempt = 0;

    this._send({
      type: 'req',
      id: 'connect',
      method: 'connect',
      params: {
        minProtocol: 3,
        maxProtocol: 3,
        client: {
          id: 'gateway-client',
          version: '1.0.0',
          platform: 'linux',
          mode: 'backend',
          displayName: '超哥办公室',
        },
        role: 'operator',
        scopes: ['operator.admin'],
        caps: ['tool-events'],
        auth: { token: AUTH_TOKEN },
      },
    });
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
    } catch {
      return;
    }

    if (frame.type === 'res') {
      this._handleResponse(frame);
    }
  }

  _handleResponse(frame) {
    // Connect handshake
    if (frame.id === 'connect') {
      if (frame.error) {
        console.error('[Gateway] Connect handshake failed:', frame.error);
        this.authenticated = false;
        if (this._connectReject) {
          this._connectReject(new Error(frame.error.message || 'Handshake failed'));
          this._connectResolve = null;
          this._connectReject = null;
        }
        return;
      }

      this.authenticated = true;
      console.log('[Gateway] Authenticated successfully');
      this._startHeartbeat();

      if (this._connectResolve) {
        this._connectResolve();
        this._connectResolve = null;
        this._connectReject = null;
      }

      // Notify all waiting callbacks that we're ready
      this._notifyReadyCallbacks();
      return;
    }

    // Agent request response
    const req = this.pendingRequests.get(frame.id);
    if (!req) return;

    if (frame.error) {
      clearTimeout(req.timer);
      this.pendingRequests.delete(frame.id);
      console.error(`[Gateway] Request ${frame.id} error:`, frame.error.message || frame.error.code);
      req.reject(new Error(frame.error.message || `Gateway error: ${frame.error.code}`));
      return;
    }

    // Skip the "accepted" acknowledgment — wait for the final "ok"/"completed" response
    const status = frame.payload?.status;
    if (status === 'accepted') {
      console.log(`[Gateway] Request ${frame.id} accepted, waiting for completion...`);
      return;
    }

    // Final response — extract text
    clearTimeout(req.timer);
    this.pendingRequests.delete(frame.id);

    let text = '';
    const payloads = frame.payload?.result?.payloads;
    if (Array.isArray(payloads)) {
      text = payloads.map(p => p.text || '').join('');
    }

    console.log(`[Gateway] Request ${frame.id} completed, ${text.length} chars`);
    req.resolve({ text });
  }

  _handleClose(code, reason) {
    const reasonStr = reason ? reason.toString() : '';
    console.log(`[Gateway] Connection closed: code=${code} reason=${reasonStr}`);
    this.connected = false;
    this.authenticated = false;
    this._stopHeartbeat();

    if (this._connectReject) {
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

    if (!this.shutdownRequested) {
      this._scheduleReconnect();
    }
  }

  _handleError(err) {
    console.error('[Gateway] WebSocket error:', err.message);
  }

  _scheduleReconnect() {
    if (this.shutdownRequested || this.reconnectTimer) return;

    const baseDelay = Math.min(
      RECONNECT_BASE_DELAY_MS * Math.pow(2, this.reconnectAttempt),
      RECONNECT_MAX_DELAY_MS
    );

    // Add random jitter (0-30%) to prevent thundering herd
    const jitter = Math.random() * 0.3;
    const delay = Math.floor(baseDelay * (1 + jitter));

    this.reconnectAttempt++;

    console.log(`[Gateway] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempt})...`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch(err => {
        console.error('[Gateway] Reconnect failed:', err.message);
      });
    }, delay);
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
        console.warn(`[Gateway] Heartbeat stale (${staleness}ms since last pong), forcing reconnect`);
        this._stopHeartbeat();
        if (this.ws) {
          try {
            this.ws.close(1006, 'Heartbeat timeout');
          } catch (err) {
            console.error('[Gateway] Error closing stale connection:', err.message);
          }
        }
        return;
      }

      try { this.ws.send('ping'); } catch {}
    }, HEARTBEAT_INTERVAL_MS);
  }

  _stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // --- Public API ---

  /**
   * Send a message to an agent session and collect the full response.
   * Waits for the gateway "res" frame which contains the complete reply text.
   */
  sendAgentMessage(sessionKey, message) {
    return new Promise((resolve, reject) => {
      if (!this.connected || !this.authenticated) {
        return reject(new Error('Gateway not connected'));
      }

      const requestId = `req_${randomUUID().replace(/-/g, '')}`;
      const idempotencyKey = `cmd_${sessionKey}_${Date.now()}`;

      const timer = setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId);
          reject(new Error('Request timeout (120s)'));
        }
      }, REQUEST_TIMEOUT_MS);

      this.pendingRequests.set(requestId, { resolve, reject, timer });

      try {
        this._send({
          type: 'req',
          id: requestId,
          method: 'agent',
          params: {
            agentId: 'main',
            sessionKey,
            message,
            attachments: [],
            deliver: false,
            idempotencyKey,
          },
        });
        console.log(`[Gateway] Sent request ${requestId} to session ${sessionKey}`);
      } catch (err) {
        clearTimeout(timer);
        this.pendingRequests.delete(requestId);
        reject(err);
      }
    });
  }

  waitForReady(timeoutMs = 10000) {
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
    return {
      connected: this.connected,
      authenticated: this.authenticated,
      pendingRequests: this.pendingRequests.size,
      reconnectAttempt: this.reconnectAttempt,
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
