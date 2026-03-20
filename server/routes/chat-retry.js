import express from 'express';
import { getGateway } from '../gateway.js';
import { recordChat, recordTokens } from './metrics.js';
import { getSessionKey, wrapWithContext } from '../agent.js';
import fs from 'fs';
import path from 'path';
import { BASE_PATH } from '../utils.js';
import { createLogger } from '../logger.js';

const log = createLogger('ChatRetry');
const router = express.Router();

/**
 * Helper: Load department config
 */
function loadConfig() {
  const configPath = path.join(BASE_PATH, 'departments', 'config.json');
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    return { departments: {} };
  }
}

/**
 * POST /api/departments/:id/chat/retry
 * Re-send the last user message to get a new response
 * Body: { lastUserMessage: string }
 */
router.post('/:id/chat/retry', async (req, res) => {
  try {
    const { id: deptId } = req.params;
    const { lastUserMessage } = req.body;

    // Validate department exists
    const config = loadConfig();
    const dept = config.departments?.[deptId];
    if (!dept) {
      return res.status(404).json({ error: `Department ${deptId} not found` });
    }

    // Validate message
    if (!lastUserMessage || typeof lastUserMessage !== 'string' || !lastUserMessage.trim()) {
      return res.status(400).json({ error: 'lastUserMessage is required' });
    }

    // Get gateway client
    const gateway = getGateway();

    // Wait for gateway to be ready
    if (!gateway.isReady) {
      try {
        await gateway.waitForReady(5000);
      } catch (err) {
        return res.status(503).json({
          error: 'Gateway not connected',
          detail: err.message
        });
      }
    }

    const sessionKey = getSessionKey(deptId);
    const wrappedMessage = wrapWithContext(deptId, lastUserMessage);

    log.info('Retrying message', { deptId, messagePreview: lastUserMessage.substring(0, 50) });

    const startMs = Date.now();
    try {
      const result = await gateway.sendAgentMessage(sessionKey, wrappedMessage);
      const durationMs = Date.now() - startMs;

      // Record metrics
      if (result.text) {
        recordChat(deptId, durationMs, false);
        if (result.usage) {
          recordTokens(deptId, result.usage);
        }

        log.info('Retry successful', { deptId, charCount: result.text.length });
        return res.json({
          success: true,
          reply: result.text,
          durationMs
        });
      }

      recordChat(deptId, durationMs, true);
      return res.status(502).json({
        error: 'Gateway returned empty response'
      });
    } catch (err) {
      const durationMs = Date.now() - startMs;
      log.error('Retry failed', { deptId, error: err.message });
      recordChat(deptId, durationMs, true);
      return res.status(502).json({
        error: 'Failed to retry chat',
        detail: err.message
      });
    }
  } catch (error) {
    log.error('Error in POST /api/departments/:id/chat/retry', { error: error.message });
    res.status(500).json({ error: 'Failed to retry chat' });
  }
});

export default router;
