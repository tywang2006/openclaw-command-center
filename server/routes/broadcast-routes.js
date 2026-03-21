import express from 'express';
import { broadcastCommand } from '../agent.js';
import { recordAudit } from './audit.js';
import { createLogger } from '../logger.js';

const log = createLogger('Broadcast');
const router = express.Router();

/**
 * POST /api/broadcast
 * Broadcast a command to all departments - each agent responds
 * Body: { command: "the order/instruction" }
 */
router.post('/broadcast', async (req, res) => {
  try {
    const { command } = req.body;
    if (!command || !command.trim()) {
      return res.status(400).json({ error: 'Command is required' });
    }

    log.info(`trace=${req.traceId || ''} <- ${command.trim().substring(0, 80)}`);
    const responses = await broadcastCommand(command.trim(), { traceId: req.traceId });
    log.info(`trace=${req.traceId || ''} ${responses.length} departments responded`);
    recordAudit({ action: 'broadcast', target: 'all', details: { command: command.trim().substring(0, 200) }, ip: req.ip });

    res.json({ success: true, responses });
  } catch (error) {
    log.error('Error in POST /api/broadcast: ' + error.message);
    res.status(500).json({ error: 'Broadcast failed' });
  }
});

export default router;
