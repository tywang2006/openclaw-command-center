import express from 'express';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { chat } from '../agent.js';
import { OPENCLAW_HOME } from '../utils.js';

const router = express.Router();

const WORKFLOWS_FILE = path.join(OPENCLAW_HOME, 'cron', 'workflows.json');

function readWorkflows() {
  try {
    if (fs.existsSync(WORKFLOWS_FILE)) {
      return JSON.parse(fs.readFileSync(WORKFLOWS_FILE, 'utf8'));
    }
    return { workflows: [] };
  } catch {
    return { workflows: [] };
  }
}

function writeWorkflows(data) {
  try {
    const dir = path.dirname(WORKFLOWS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(WORKFLOWS_FILE, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('[Workflows] Write error:', err.message);
    return false;
  }
}

/**
 * GET /api/workflows
 * List all workflows
 */
router.get('/', (req, res) => {
  const data = readWorkflows();
  res.json({ workflows: data.workflows, count: data.workflows.length });
});

/**
 * GET /api/workflows/:id
 * Get a single workflow
 */
router.get('/:id', (req, res) => {
  const data = readWorkflows();
  const wf = data.workflows.find(w => w.id === req.params.id);
  if (!wf) return res.status(404).json({ error: 'Workflow not found' });
  res.json({ workflow: wf });
});

/**
 * POST /api/workflows
 * Create a workflow
 * Body: { name, steps: [{ deptId, message, delayMs }] }
 */
router.post('/', (req, res) => {
  const { name, steps } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Workflow name is required' });
  }
  if (!Array.isArray(steps) || steps.length === 0) {
    return res.status(400).json({ error: 'At least one step is required' });
  }

  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (!s.deptId || !s.message) {
      return res.status(400).json({ error: `Step ${i + 1}: deptId and message are required` });
    }
  }

  const data = readWorkflows();
  const now = Date.now();
  const workflow = {
    id: randomUUID(),
    name: name.trim(),
    steps: steps.map(s => ({
      deptId: s.deptId,
      message: s.message.trim(),
      delayMs: Math.max(0, parseInt(s.delayMs) || 0),
    })),
    createdAtMs: now,
    updatedAtMs: now,
    lastRunAtMs: null,
    lastRunStatus: null,
  };

  data.workflows.push(workflow);
  if (!writeWorkflows(data)) {
    return res.status(500).json({ error: 'Failed to save workflow' });
  }

  console.log(`[Workflows] Created "${workflow.name}" with ${workflow.steps.length} steps`);
  res.status(201).json({ success: true, workflow });
});

/**
 * PUT /api/workflows/:id
 * Update a workflow
 */
router.put('/:id', (req, res) => {
  const data = readWorkflows();
  const wf = data.workflows.find(w => w.id === req.params.id);
  if (!wf) return res.status(404).json({ error: 'Workflow not found' });

  const { name, steps } = req.body;

  if (name !== undefined) {
    if (!name.trim()) return res.status(400).json({ error: 'Name cannot be empty' });
    wf.name = name.trim();
  }

  if (steps !== undefined) {
    if (!Array.isArray(steps) || steps.length === 0) {
      return res.status(400).json({ error: 'At least one step is required' });
    }
    wf.steps = steps.map(s => ({
      deptId: s.deptId,
      message: (s.message || '').trim(),
      delayMs: Math.max(0, parseInt(s.delayMs) || 0),
    }));
  }

  wf.updatedAtMs = Date.now();
  if (!writeWorkflows(data)) {
    return res.status(500).json({ error: 'Failed to update workflow' });
  }

  res.json({ success: true, workflow: wf });
});

/**
 * DELETE /api/workflows/:id
 * Delete a workflow
 */
router.delete('/:id', (req, res) => {
  const data = readWorkflows();
  const idx = data.workflows.findIndex(w => w.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Workflow not found' });

  const removed = data.workflows.splice(idx, 1)[0];
  if (!writeWorkflows(data)) {
    return res.status(500).json({ error: 'Failed to delete workflow' });
  }

  console.log(`[Workflows] Deleted "${removed.name}"`);
  res.json({ success: true, deleted: { id: removed.id, name: removed.name } });
});

/**
 * POST /api/workflows/:id/run
 * Execute a workflow: run each step sequentially via chat()
 */
router.post('/:id/run', async (req, res) => {
  try {
    const data = readWorkflows();
    const wf = data.workflows.find(w => w.id === req.params.id);
    if (!wf) return res.status(404).json({ error: 'Workflow not found' });

    console.log(`[Workflows] Running "${wf.name}" (${wf.steps.length} steps)`);
    const results = [];

    for (let i = 0; i < wf.steps.length; i++) {
      const step = wf.steps[i];

      // Delay between steps (except first)
      if (i > 0 && step.delayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, Math.min(step.delayMs, 60000)));
      }

      const startMs = Date.now();
      const result = await chat(step.deptId, step.message);
      const durationMs = Date.now() - startMs;

      results.push({
        step: i + 1,
        deptId: step.deptId,
        message: step.message,
        success: result.success,
        reply: result.reply || result.error || '',
        durationMs,
      });

      console.log(`[Workflows] Step ${i + 1}/${wf.steps.length}: ${step.deptId} -> ${result.success ? 'OK' : 'FAIL'} (${durationMs}ms)`);
    }

    // Update last run info
    wf.lastRunAtMs = Date.now();
    wf.lastRunStatus = results.every(r => r.success) ? 'ok' : 'partial';
    writeWorkflows(data);

    res.json({
      success: true,
      workflow: { id: wf.id, name: wf.name },
      results,
      totalSteps: wf.steps.length,
      successCount: results.filter(r => r.success).length,
    });
  } catch (error) {
    console.error('[Workflows] POST /:id/run error:', error);
    res.status(500).json({ error: 'Workflow execution failed' });
  }
});

export default router;
