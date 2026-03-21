import { createLogger } from './logger.js';

const log = createLogger('Broadcast');

/**
 * Pre-serialize and broadcast to all authenticated WebSocket clients.
 * Skips clients with backpressure (bufferedAmount > 1MB).
 *
 * @param {WebSocketServer} wss - WebSocket server instance
 * @param {Object|string} data - Data to broadcast (will be JSON.stringify'd if object)
 * @param {Function} [filter] - Optional filter function (ws => boolean) to select clients
 * @returns {{sent: number, skipped: number}} Broadcast statistics
 */
export function safeBroadcast(wss, data, filter) {
  if (!wss) return { sent: 0, skipped: 0 };

  const payload = typeof data === 'string' ? data : JSON.stringify(data);
  let sent = 0;
  let skipped = 0;

  for (const ws of wss.clients) {
    // Only broadcast to open, authenticated connections
    if (ws.readyState !== 1) continue; // 1 = OPEN
    if (!ws._authenticated) continue;

    // Apply optional filter (e.g., per-meeting filtering)
    if (filter && !filter(ws)) continue;

    // Backpressure check: skip client if send buffer exceeds 1MB
    if (ws.bufferedAmount > 1048576) {
      log.warn('WebSocket client buffer overflow, closing', { bufferedAmount: ws.bufferedAmount });
      try {
        ws.close(1008, 'Buffer overflow');
      } catch (err) {
        // Client already disconnected, ignore
      }
      skipped++;
      continue;
    }

    try {
      ws.send(payload);
      sent++;
    } catch (err) {
      log.warn('Error sending to WebSocket client', { error: err.message });
      skipped++;
    }
  }

  if (skipped > 0) {
    log.warn(`Broadcast skipped ${skipped} clients due to backpressure or errors`, { sent, skipped });
  }

  return { sent, skipped };
}
