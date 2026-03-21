import express from 'express';
import { createSubAgent, chatSubAgent, listSubAgents, removeSubAgent } from '../agent.js';
import { validateDepartmentId } from '../utils.js';
import { createLogger } from '../logger.js';

const log = createLogger('SubAgents');
const router = express.Router();

const VALID_SUB_ID = /^[a-z][a-z0-9_-]{0,60}$/;
const MAX_MESSAGE_LENGTH = 10000;

function validateDeptId(id) {
  return validateDepartmentId(id);
}

function validateSubId(id) {
  return typeof id === 'string' && VALID_SUB_ID.test(id);
}

/**
 * GET /api/departments/:id/subagents
 * List sub-agents for a department
 */
router.get('/departments/:id/subagents', (req, res) => {
  if (!validateDeptId(req.params.id)) {
    return res.status(400).json({ error: 'Invalid department ID' });
  }
  const agents = listSubAgents(req.params.id);
  res.json({ agents });
});

/**
 * POST /api/departments/:id/subagents
 * Create a new sub-agent for a department
 * Body: { task: "task description" }
 */
router.post('/departments/:id/subagents', async (req, res) => {
  try {
    if (!validateDeptId(req.params.id)) {
      return res.status(400).json({ error: 'Invalid department ID' });
    }
    const { task, name, skills } = req.body;
    if (!task || !task.trim()) {
      return res.status(400).json({ error: 'Task description is required' });
    }
    if (task.length > MAX_MESSAGE_LENGTH) {
      return res.status(400).json({ error: `Task description too long (max ${MAX_MESSAGE_LENGTH} chars)` });
    }
    const skillsList = Array.isArray(skills) ? skills.filter(s => typeof s === 'string' && s.trim()) : undefined;
    const result = await createSubAgent(req.params.id, task.trim(), name?.trim() || undefined, skillsList);
    res.json({ success: true, ...result });
  } catch (error) {
    log.error('Sub-agent creation error: ' + error.message);
    res.status(500).json({ error: 'Sub-agent creation failed' });
  }
});

/**
 * POST /api/departments/:id/subagents/:subId/chat
 * Chat with a specific sub-agent
 * Body: { message: "your message" }
 */
router.post('/departments/:id/subagents/:subId/chat', async (req, res) => {
  try {
    if (!validateDeptId(req.params.id) || !validateSubId(req.params.subId)) {
      return res.status(400).json({ error: 'Invalid department or sub-agent ID' });
    }
    const { message } = req.body;
    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Message is required' });
    }
    if (message.length > MAX_MESSAGE_LENGTH) {
      return res.status(400).json({ error: `Message too long (max ${MAX_MESSAGE_LENGTH} chars)` });
    }
    const result = await chatSubAgent(req.params.id, req.params.subId, message.trim(), { traceId: req.traceId });
    res.json(result);
  } catch (error) {
    log.error('Sub-agent chat error: ' + error.message);
    res.status(500).json({ error: 'Sub-agent chat failed' });
  }
});

/**
 * DELETE /api/departments/:id/subagents/:subId
 * Remove a sub-agent
 */
router.delete('/departments/:id/subagents/:subId', async (req, res) => {
  try {
    if (!validateDeptId(req.params.id) || !validateSubId(req.params.subId)) {
      return res.status(400).json({ error: 'Invalid department or sub-agent ID' });
    }
    const removed = await removeSubAgent(req.params.id, req.params.subId);
    res.json({ success: removed });
  } catch (error) {
    log.error('Sub-agent removal error: ' + error.message);
    res.status(500).json({ error: 'Sub-agent removal failed' });
  }
});

export default router;
