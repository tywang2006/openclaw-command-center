import express from 'express';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { chat } from '../agent.js';
import { OPENCLAW_HOME, safeWriteFileSync } from '../utils.js';

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
    safeWriteFileSync(WORKFLOWS_FILE, JSON.stringify(data, null, 2));
    return true;
  } catch (err) {
    console.error('[Workflows] Write error:', err.message);
    return false;
  }
}

/**
 * GET /api/workflows/templates
 * Get workflow templates
 */
router.get('/templates', (req, res) => {
  try {
    const templates = [
      {
        id: 'morning-briefing',
        name: 'Morning Briefing',
        description: 'Daily morning report from all departments',
        steps: [
          { deptId: 'sales', message: 'Provide yesterday\'s sales summary', delayMs: 0 },
          { deptId: 'ops', message: 'Report operational status and any issues', delayMs: 2000 },
          { deptId: 'dev', message: 'Summary of completed tasks and today\'s priorities', delayMs: 2000 },
        ]
      },
      {
        id: 'multi-dept-review',
        name: 'Multi-Department Review',
        description: 'Sequential review process across departments',
        steps: [
          { deptId: 'dev', message: 'Review and summarize the latest feature development', delayMs: 0 },
          { deptId: 'qa', message: 'Test plan for the new features mentioned above', delayMs: 3000 },
          { deptId: 'sales', message: 'Create sales pitch for the new features', delayMs: 3000 },
        ]
      },
      {
        id: 'customer-report',
        name: 'Customer Report Pipeline',
        description: 'Generate comprehensive customer report',
        steps: [
          { deptId: 'sales', message: 'List top 5 customer accounts and recent activity', delayMs: 0 },
          { deptId: 'support', message: 'Summarize recent customer support tickets and trends', delayMs: 3000 },
          { deptId: 'finance', message: 'Revenue analysis for top accounts', delayMs: 3000 },
        ]
      }
    ];
    res.json({ success: true, templates });
  } catch (err) {
    console.error('[Workflows] GET /templates error:', err.message);
    res.status(500).json({ error: 'Failed to get templates' });
  }
});

/**
 * GET /api/workflows
 * List all workflows
 */
router.get('/', (req, res) => {
  try {
    const data = readWorkflows();
    res.json({ workflows: data.workflows, count: data.workflows.length });
  } catch (err) {
    console.error('[Workflows] GET / error:', err.message);
    res.status(500).json({ error: 'Failed to list workflows' });
  }
});

/**
 * GET /api/workflows/:id
 * Get a single workflow
 */
router.get('/:id', (req, res) => {
  try {
    const data = readWorkflows();
    const wf = data.workflows.find(w => w.id === req.params.id);
    if (!wf) return res.status(404).json({ error: 'Workflow not found' });
    res.json({ workflow: wf });
  } catch (err) {
    console.error('[Workflows] GET /:id error:', err.message);
    res.status(500).json({ error: 'Failed to get workflow' });
  }
});

/**
 * POST /api/workflows
 * Create a workflow
 * Body: { name, steps: [{ deptId, message, delayMs }] }
 */
router.post('/', (req, res) => {
  try {
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
  } catch (err) {
    console.error('[Workflows] POST / error:', err.message);
    res.status(500).json({ error: 'Failed to create workflow' });
  }
});

/**
 * PUT /api/workflows/:id
 * Update a workflow
 */
router.put('/:id', (req, res) => {
  try {
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
  } catch (err) {
    console.error('[Workflows] PUT /:id error:', err.message);
    res.status(500).json({ error: 'Failed to update workflow' });
  }
});

/**
 * DELETE /api/workflows/:id
 * Delete a workflow
 */
router.delete('/:id', (req, res) => {
  try {
    const data = readWorkflows();
    const idx = data.workflows.findIndex(w => w.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Workflow not found' });

    const removed = data.workflows.splice(idx, 1)[0];
    if (!writeWorkflows(data)) {
      return res.status(500).json({ error: 'Failed to delete workflow' });
    }

    console.log(`[Workflows] Deleted "${removed.name}"`);
    res.json({ success: true, deleted: { id: removed.id, name: removed.name } });
  } catch (err) {
    console.error('[Workflows] DELETE /:id error:', err.message);
    res.status(500).json({ error: 'Failed to delete workflow' });
  }
});

/**
 * POST /api/workflows/:id/run
 * Execute a workflow: run each step sequentially via chat()
 * Supports conditional branching based on step output
 */
router.post('/:id/run', async (req, res) => {
  try {
    const data = readWorkflows();
    const wf = data.workflows.find(w => w.id === req.params.id);
    if (!wf) return res.status(404).json({ error: 'Workflow not found' });

    console.log(`[Workflows] Running "${wf.name}" (${wf.steps.length} steps)`);
    const results = [];
    const stepStatus = wf.steps.map(() => 'pending'); // Track status for each step
    let currentStepIndex = 0;
    const visitedSteps = new Set(); // Prevent infinite loops

    while (currentStepIndex < wf.steps.length) {
      // Check for infinite loops
      if (visitedSteps.has(currentStepIndex)) {
        console.error(`[Workflows] Infinite loop detected at step ${currentStepIndex + 1}`);
        break;
      }
      visitedSteps.add(currentStepIndex);

      const step = wf.steps[currentStepIndex];
      stepStatus[currentStepIndex] = 'running';

      // Delay between steps
      if (results.length > 0 && step.delayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, Math.min(step.delayMs, 60000)));
      }

      const startMs = Date.now();
      const result = await chat(step.deptId, step.message);
      const durationMs = Date.now() - startMs;

      const stepResult = {
        step: currentStepIndex + 1,
        deptId: step.deptId,
        message: step.message,
        success: result.success,
        reply: result.reply || result.error || '',
        error: result.error,
        durationMs,
        status: result.success ? 'done' : 'error',
      };

      results.push(stepResult);
      stepStatus[currentStepIndex] = result.success ? 'done' : 'error';

      console.log(`[Workflows] Step ${currentStepIndex + 1}/${wf.steps.length}: ${step.deptId} -> ${result.success ? 'OK' : 'FAIL'} (${durationMs}ms)`);

      // Check for conditional branching
      if (step.condition && result.success) {
        const { type, value, nextStepOnTrue, nextStepOnFalse } = step.condition;
        const output = (result.reply || '').toLowerCase();
        const conditionValue = (value || '').toLowerCase();
        let conditionMet = false;

        if (type === 'contains') {
          conditionMet = output.includes(conditionValue);
        } else if (type === 'not_contains') {
          conditionMet = !output.includes(conditionValue);
        } else if (type === 'equals') {
          conditionMet = output.trim() === conditionValue.trim();
        }

        const nextStep = conditionMet ? nextStepOnTrue : nextStepOnFalse;
        console.log(`[Workflows] Condition ${conditionMet ? 'MET' : 'NOT MET'}: jumping to step ${nextStep + 1}`);

        // Validate next step index
        if (nextStep >= 0 && nextStep < wf.steps.length && nextStep !== currentStepIndex + 1) {
          currentStepIndex = nextStep;
          continue;
        }
      }

      // Move to next step
      currentStepIndex++;
    }

    // Update last run info
    wf.lastRunAtMs = Date.now();
    wf.lastRunStatus = results.every(r => r.success) ? 'ok' : 'partial';
    writeWorkflows(data);

    res.json({
      success: true,
      workflow: { id: wf.id, name: wf.name },
      results,
      stepStatus,
      totalSteps: wf.steps.length,
      executedSteps: results.length,
      successCount: results.filter(r => r.success).length,
    });
  } catch (error) {
    console.error('[Workflows] POST /:id/run error:', error);
    res.status(500).json({ error: 'Workflow execution failed' });
  }
});

export default router;
