import express from 'express';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { chat } from '../agent.js';
import { OPENCLAW_HOME, safeWriteFileSync } from '../utils.js';
import { withFileLock } from '../file-lock.js';
import { recordAudit } from './audit.js';
import { createLogger } from '../logger.js';

const log = createLogger('Workflows');
const router = express.Router();

const WORKFLOWS_FILE = path.join(OPENCLAW_HOME, 'cron', 'workflows.json');

// Async version for better performance
async function readWorkflows() {
  try {
    if (fs.existsSync(WORKFLOWS_FILE)) {
      const content = await fs.promises.readFile(WORKFLOWS_FILE, 'utf8');
      return JSON.parse(content);
    }
    return { workflows: [] };
  } catch {
    return { workflows: [] };
  }
}

// Sync version for simple GET endpoints (no lock needed)
function readWorkflowsSync() {
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
    log.error(`Write error: ${err.message}`);
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
    log.error(`GET /templates error: ${err.message}`);
    res.status(500).json({ error: 'Failed to get templates' });
  }
});

/**
 * GET /api/workflows
 * List all workflows
 */
router.get('/', (req, res) => {
  try {
    const data = readWorkflowsSync();
    res.json({ workflows: data.workflows, count: data.workflows.length });
  } catch (err) {
    log.error(`GET / error: ${err.message}`);
    res.status(500).json({ error: 'Failed to list workflows' });
  }
});

/**
 * GET /api/workflows/:id
 * Get a single workflow
 */
router.get('/:id', (req, res) => {
  try {
    const data = readWorkflowsSync();
    const wf = data.workflows.find(w => w.id === req.params.id);
    if (!wf) return res.status(404).json({ error: 'Workflow not found' });
    res.json({ workflow: wf });
  } catch (err) {
    log.error(`GET /:id error: ${err.message}`);
    res.status(500).json({ error: 'Failed to get workflow' });
  }
});

/**
 * POST /api/workflows
 * Create a workflow
 * Body: { name, steps: [{ deptId, message, delayMs }] }
 */
router.post('/', async (req, res) => {
  try {
    // C5 Fix: Reject workflow creation from AI agents
    const sourceDept = req.headers['x-source-dept'];
    if (sourceDept) {
      return res.status(403).json({ error: 'AI agents cannot create workflows. Use the UI or ask a human operator.' });
    }

    const { name, steps } = req.body;

    // Validate OUTSIDE the lock (no I/O needed)
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Workflow name is required' });
    }
    if (typeof name !== 'string' || name.length > 200) {
      return res.status(400).json({ error: 'Workflow name must be 200 characters or less' });
    }
    if (!Array.isArray(steps) || steps.length === 0) {
      return res.status(400).json({ error: 'At least one step is required' });
    }
    if (steps.length > 50) {
      return res.status(400).json({ error: 'Maximum 50 steps per workflow' });
    }

    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      if (!s.deptId || !s.message) {
        return res.status(400).json({ error: `Step ${i + 1}: deptId and message are required` });
      }
      if (typeof s.message !== 'string' || s.message.length > 5000) {
        return res.status(400).json({ error: `Step ${i + 1}: message must be 5000 characters or less` });
      }
      if (typeof s.deptId !== 'string' || s.deptId.length > 50) {
        return res.status(400).json({ error: `Step ${i + 1}: invalid deptId` });
      }
      if (s.delayMs !== undefined) {
        const delay = parseInt(s.delayMs);
        if (!Number.isFinite(delay) || delay < 0 || delay > 60000) {
          return res.status(400).json({ error: `Step ${i + 1}: delayMs must be 0-60000` });
        }
      }
    }

    await withFileLock(WORKFLOWS_FILE, async () => {
      const data = await readWorkflows();
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

      log.info(`Created "${workflow.name}" with ${workflow.steps.length} steps`);
      recordAudit({ action: 'workflow:create', target: workflow.id, details: { name: workflow.name, steps: workflow.steps.length }, ip: req.ip });
      return res.status(201).json({ success: true, workflow });
    });
  } catch (err) {
    log.error(`POST / error: ${err.message}`);
    res.status(500).json({ error: 'Failed to create workflow' });
  }
});

/**
 * PUT /api/workflows/:id
 * Update a workflow
 */
router.put('/:id', async (req, res) => {
  try {
    const { name, steps } = req.body;

    // Validate OUTSIDE the lock
    if (name !== undefined && !name.trim()) {
      return res.status(400).json({ error: 'Name cannot be empty' });
    }
    if (steps !== undefined && (!Array.isArray(steps) || steps.length === 0)) {
      return res.status(400).json({ error: 'At least one step is required' });
    }

    await withFileLock(WORKFLOWS_FILE, async () => {
      const data = await readWorkflows();
      const wf = data.workflows.find(w => w.id === req.params.id);
      if (!wf) return res.status(404).json({ error: 'Workflow not found' });

      if (name !== undefined) {
        wf.name = name.trim();
      }

      if (steps !== undefined) {
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

      recordAudit({ action: 'workflow:update', target: req.params.id, details: { fields: Object.keys(req.body) }, ip: req.ip });
      return res.json({ success: true, workflow: wf });
    });
  } catch (err) {
    log.error(`PUT /:id error: ${err.message}`);
    res.status(500).json({ error: 'Failed to update workflow' });
  }
});

/**
 * DELETE /api/workflows/:id
 * Delete a workflow
 */
router.delete('/:id', async (req, res) => {
  try {
    // C5 Fix: Reject workflow deletion from AI agents
    const sourceDept = req.headers['x-source-dept'];
    if (sourceDept) {
      return res.status(403).json({ error: 'AI agents cannot delete workflows. Use the UI or ask a human operator.' });
    }

    await withFileLock(WORKFLOWS_FILE, async () => {
      const data = await readWorkflows();
      const idx = data.workflows.findIndex(w => w.id === req.params.id);
      if (idx === -1) return res.status(404).json({ error: 'Workflow not found' });

      const removed = data.workflows.splice(idx, 1)[0];
      if (!writeWorkflows(data)) {
        return res.status(500).json({ error: 'Failed to delete workflow' });
      }

      log.info(`Deleted "${removed.name}"`);
      recordAudit({ action: 'workflow:delete', target: removed.id, details: { name: removed.name }, ip: req.ip });
      return res.json({ success: true, deleted: { id: removed.id, name: removed.name } });
    });
  } catch (err) {
    log.error(`DELETE /:id error: ${err.message}`);
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
    // Read workflow OUTSIDE the lock, then execute without holding lock
    const data = await readWorkflows();
    const found = data.workflows.find(w => w.id === req.params.id);
    if (!found) {
      return res.status(404).json({ error: 'Workflow not found' });
    }

    // Create a snapshot (steps may contain conditions)
    const wf = JSON.parse(JSON.stringify(found));

    log.info(`Running "${wf.name}" (${wf.steps.length} steps)`);
    const results = [];
    const stepStatus = wf.steps.map(() => 'pending');
    let currentStepIndex = 0;
    const visitedSteps = new Set();

    // Execute steps WITHOUT holding the file lock
    while (currentStepIndex < wf.steps.length) {
      if (visitedSteps.has(currentStepIndex)) {
        log.error(`Infinite loop detected at step ${currentStepIndex + 1}`);
        break;
      }
      visitedSteps.add(currentStepIndex);

      const step = wf.steps[currentStepIndex];
      stepStatus[currentStepIndex] = 'running';

      if (results.length > 0 && step.delayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, Math.min(step.delayMs, 60000)));
      }

      const startMs = Date.now();
      let result;
      try {
        result = await chat(step.deptId, step.message, null, { traceId: req.traceId });
      } catch (chatErr) {
        result = { success: false, error: chatErr.message };
      }
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

      log.info(`Step ${currentStepIndex + 1}/${wf.steps.length}: ${step.deptId} -> ${result.success ? 'OK' : 'FAIL'} (${durationMs}ms)`);

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
        log.info(`Condition ${conditionMet ? 'MET' : 'NOT MET'}: jumping to step ${nextStep + 1}`);

        if (nextStep >= 0 && nextStep < wf.steps.length && nextStep !== currentStepIndex + 1) {
          currentStepIndex = nextStep;
          continue;
        }
      }

      currentStepIndex++;
    }

    // Re-acquire lock to write results
    await withFileLock(WORKFLOWS_FILE, async () => {
      const data = await readWorkflows();
      const current = data.workflows.find(w => w.id === wf.id);
      if (current) {
        current.lastRunAtMs = Date.now();
        current.lastRunStatus = results.every(r => r.success) ? 'ok' : 'partial';
        writeWorkflows(data);
      }
    });

    return res.json({
      success: true,
      workflow: { id: wf.id, name: wf.name },
      results,
      stepStatus,
      totalSteps: wf.steps.length,
      executedSteps: results.length,
      successCount: results.filter(r => r.success).length,
    });
  } catch (error) {
    log.error(`POST /:id/run error: ${error.message}`);
    res.status(500).json({ error: 'Workflow execution failed' });
  }
});

export default router;
