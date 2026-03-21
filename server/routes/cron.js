import express from 'express';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { getGateway } from '../gateway.js';
import { safeWriteFileSync } from '../utils.js';
import { OPENCLAW_HOME, BASE_PATH } from '../utils.js';
import { withFileLock } from '../file-lock.js';
import { recordAudit } from './audit.js';
import { createLogger } from '../logger.js';

const log = createLogger('Cron');
const router = express.Router();

const CRON_FILE_PATH = path.join(OPENCLAW_HOME, 'cron', 'jobs.json');

// Prevent concurrent execution of same job
const _runningJobs = new Set();

// Input validation
const VALID_SCHEDULE_KINDS = ['every', 'cron'];
const MAX_NAME_LENGTH = 100;
const MAX_MESSAGE_LENGTH = 5000;
const DEFAULT_EXECUTION_TIMEOUT_MS = 30000; // 30 seconds default timeout for job execution

/**
 * Helper: Read cron jobs file
 */
function readCronJobs() {
  try {
    if (fs.existsSync(CRON_FILE_PATH)) {
      const content = fs.readFileSync(CRON_FILE_PATH, 'utf8');
      return JSON.parse(content);
    }
    return { version: 1, jobs: [] };
  } catch (error) {
    log.error(`Error reading cron jobs file: ${error.message}`);
    return { version: 1, jobs: [] };
  }
}

/**
 * Helper: Write cron jobs file
 */
function writeCronJobs(data) {
  try {
    safeWriteFileSync(CRON_FILE_PATH, JSON.stringify(data, null, 2));
    return true;
  } catch (error) {
    log.error(`Error writing cron jobs file: ${error.message}`);
    return false;
  }
}

/**
 * Helper: Find job by ID
 */
function findJobById(jobs, id) {
  return jobs.find(job => job.id === id);
}

/**
 * Helper: Validate cron expression format
 * Standard cron: "minute hour day month weekday"
 * Each field can be: number, asterisk, range (1-5), list (1,3,5), or step (star/5)
 *
 * TODO: Add timezone support for cron expressions. Currently all cron times
 * are interpreted in the server's local timezone. Consider adding a timezone
 * field to the schedule object to support execution in different timezones.
 */
function validateCronExpression(expr) {
  const parts = expr.trim().split(/\s+/);

  if (parts.length !== 5) {
    return { valid: false, error: 'Cron expression must have 5 fields: minute hour day month weekday' };
  }

  const fieldRanges = [
    { name: 'minute', min: 0, max: 59 },
    { name: 'hour', min: 0, max: 23 },
    { name: 'day', min: 1, max: 31 },
    { name: 'month', min: 1, max: 12 },
    { name: 'weekday', min: 0, max: 7 } // 0 and 7 both represent Sunday
  ];

  for (let i = 0; i < 5; i++) {
    const field = parts[i];
    const range = fieldRanges[i];

    // Wildcard is always valid
    if (field === '*') continue;

    // Step values like */5
    if (field.includes('/')) {
      const [base, step] = field.split('/');
      if (base !== '*' && !/^\d+$/.test(base)) {
        return { valid: false, error: `Invalid ${range.name} step base: ${base}` };
      }
      if (!/^\d+$/.test(step) || parseInt(step) <= 0) {
        return { valid: false, error: `Invalid ${range.name} step value: ${step}` };
      }
      continue;
    }

    // Range like 1-5
    if (field.includes('-')) {
      const [start, end] = field.split('-');
      if (!/^\d+$/.test(start) || !/^\d+$/.test(end)) {
        return { valid: false, error: `Invalid ${range.name} range: ${field}` };
      }
      const startNum = parseInt(start);
      const endNum = parseInt(end);
      if (startNum < range.min || endNum > range.max || startNum >= endNum) {
        return { valid: false, error: `${range.name} range ${field} out of bounds (${range.min}-${range.max})` };
      }
      continue;
    }

    // List like 1,3,5
    if (field.includes(',')) {
      const values = field.split(',');
      for (const val of values) {
        if (!/^\d+$/.test(val)) {
          return { valid: false, error: `Invalid ${range.name} list value: ${val}` };
        }
        const num = parseInt(val);
        if (num < range.min || num > range.max) {
          return { valid: false, error: `${range.name} value ${num} out of bounds (${range.min}-${range.max})` };
        }
      }
      continue;
    }

    // Single number
    if (!/^\d+$/.test(field)) {
      return { valid: false, error: `Invalid ${range.name} value: ${field}` };
    }
    const num = parseInt(field);
    if (num < range.min || num > range.max) {
      return { valid: false, error: `${range.name} value ${num} out of bounds (${range.min}-${range.max})` };
    }
  }

  return { valid: true };
}

/**
 * Helper: Validate schedule object
 */
function validateSchedule(schedule) {
  if (!schedule || typeof schedule !== 'object') {
    return { valid: false, error: 'Schedule is required and must be an object' };
  }

  if (!schedule.kind || !VALID_SCHEDULE_KINDS.includes(schedule.kind)) {
    return { valid: false, error: `Schedule kind must be one of: ${VALID_SCHEDULE_KINDS.join(', ')}` };
  }

  if (schedule.kind === 'every') {
    if (typeof schedule.everyMs !== 'number' || schedule.everyMs <= 0) {
      return { valid: false, error: 'everyMs must be a positive number for kind=every' };
    }
    if (schedule.everyMs < 10000) {
      return { valid: false, error: 'everyMs minimum is 10000 (10 seconds)' };
    }
  }

  if (schedule.kind === 'cron') {
    if (!schedule.expr || typeof schedule.expr !== 'string') {
      return { valid: false, error: 'expr (cron expression) is required for kind=cron' };
    }

    // Validate cron expression format
    const cronValidation = validateCronExpression(schedule.expr);
    if (!cronValidation.valid) {
      return cronValidation;
    }
  }

  return { valid: true };
}

/**
 * GET /api/cron/jobs
 * List all cron jobs
 */
router.get('/jobs', (req, res) => {
  try {
    const data = readCronJobs();
    res.json({
      version: data.version,
      jobs: data.jobs,
      count: data.jobs.length
    });
  } catch (error) {
    log.error(`Error in GET /api/cron/jobs: ${error.message}`);
    res.status(500).json({ error: 'Failed to fetch cron jobs' });
  }
});

/**
 * POST /api/cron/jobs
 * Create a new cron job
 * Body: { name, schedule: { kind, everyMs?, expr? }, message, model?, timeoutSeconds? }
 */
router.post('/jobs', async (req, res) => {
  try {
    // C5 Fix: Reject cron job creation from AI agents (x-source-dept header)
    const sourceDept = req.headers['x-source-dept'];
    if (sourceDept) {
      return res.status(403).json({ error: 'AI agents cannot create cron jobs. Use the UI or ask a human operator.' });
    }

    await withFileLock(CRON_FILE_PATH, async () => {
      const { name, schedule, message, model, timeoutSeconds, deptId, subAgentId } = req.body;

      // Validate required fields
      if (!name || !name.trim()) {
        return res.status(400).json({ error: 'Job name is required' });
      }

      if (name.length > MAX_NAME_LENGTH) {
        return res.status(400).json({ error: `Job name too long (max ${MAX_NAME_LENGTH} chars)` });
      }

      if (!message || !message.trim()) {
        return res.status(400).json({ error: 'Message is required' });
      }

      if (message.length > MAX_MESSAGE_LENGTH) {
        return res.status(400).json({ error: `Message too long (max ${MAX_MESSAGE_LENGTH} chars)` });
      }

      // Validate schedule
      const scheduleValidation = validateSchedule(schedule);
      if (!scheduleValidation.valid) {
        return res.status(400).json({ error: scheduleValidation.error });
      }

      // Validate optional numeric parameters
      if (timeoutSeconds !== undefined) {
        const ts = Number(timeoutSeconds);
        if (!Number.isFinite(ts) || ts < 1 || ts > 3600 || Math.floor(ts) !== ts) {
          return res.status(400).json({ error: 'timeoutSeconds must be an integer between 1 and 3600' });
        }
      }
      if (model !== undefined && (typeof model !== 'string' || model.length > 256)) {
        return res.status(400).json({ error: 'model must be a string of 256 chars or less' });
      }
      if (deptId !== undefined && typeof deptId === 'string' && deptId.length > 50) {
        return res.status(400).json({ error: 'deptId must be 50 chars or less' });
      }
      if (subAgentId !== undefined && typeof subAgentId === 'string' && subAgentId.length > 60) {
        return res.status(400).json({ error: 'subAgentId must be 60 chars or less' });
      }

      // Read existing jobs
      const data = readCronJobs();

      // Create new job
      const now = Date.now();
      const newJob = {
        id: randomUUID(),
        agentId: 'main',
        name: name.trim(),
        enabled: true,
        createdAtMs: now,
        updatedAtMs: now,
        ...(deptId && { deptId: deptId.trim() }),
        ...(subAgentId && { subAgentId: subAgentId.trim() }),
        schedule: {
          kind: schedule.kind,
          ...(schedule.kind === 'every' && {
            everyMs: schedule.everyMs,
            anchorMs: now
          }),
          ...(schedule.kind === 'cron' && {
            expr: schedule.expr
          })
        },
        sessionTarget: 'isolated',
        wakeMode: 'now',
        payload: {
          kind: 'agentTurn',
          message: message.trim(),
          ...(model && { model }),
          ...(timeoutSeconds && { timeoutSeconds })
        },
        delivery: {
          mode: 'none'
        },
        state: {
          consecutiveErrors: 0
        }
      };

      // Add to jobs array
      data.jobs.push(newJob);

      // Write back to file
      if (!writeCronJobs(data)) {
        return res.status(500).json({ error: 'Failed to save cron job' });
      }

      log.info(`Created job ${newJob.id}: "${newJob.name}"`);
      recordAudit({ action: 'cron:create', target: newJob.id, details: { name: newJob.name }, ip: req.ip });
      return res.status(201).json({
        success: true,
        job: newJob
      });
    });
  } catch (error) {
    log.error(`Error in POST /api/cron/jobs: ${error.message}`);
    res.status(500).json({ error: 'Failed to create cron job' });
  }
});

/**
 * PUT /api/cron/jobs/:id
 * Update a cron job (partial update)
 * Body: any fields to update (name, enabled, schedule, payload.message, etc.)
 */
router.put('/jobs/:id', async (req, res) => {
  try {
    await withFileLock(CRON_FILE_PATH, async () => {
      const { id } = req.params;
      const updates = req.body;

      // Read existing jobs
      const data = readCronJobs();
      const jobIndex = data.jobs.findIndex(job => job.id === id);

      if (jobIndex === -1) {
        return res.status(404).json({ error: `Cron job ${id} not found` });
      }

      const job = data.jobs[jobIndex];

      // Validate updates
      if (updates.name !== undefined) {
        if (!updates.name.trim()) {
          return res.status(400).json({ error: 'Job name cannot be empty' });
        }
        if (updates.name.length > MAX_NAME_LENGTH) {
          return res.status(400).json({ error: `Job name too long (max ${MAX_NAME_LENGTH} chars)` });
        }
        job.name = updates.name.trim();
      }

      if (updates.enabled !== undefined) {
        if (typeof updates.enabled !== 'boolean') {
          return res.status(400).json({ error: 'enabled must be a boolean' });
        }
        job.enabled = updates.enabled;
      }

      if (updates.subAgentId !== undefined) {
        job.subAgentId = updates.subAgentId ? updates.subAgentId.trim() : undefined;
      }

      if (updates.schedule !== undefined) {
        const scheduleValidation = validateSchedule(updates.schedule);
        if (!scheduleValidation.valid) {
          return res.status(400).json({ error: scheduleValidation.error });
        }
        job.schedule = {
          kind: updates.schedule.kind,
          ...(updates.schedule.kind === 'every' && {
            everyMs: updates.schedule.everyMs,
            anchorMs: updates.schedule.anchorMs || job.schedule.anchorMs || Date.now()
          }),
          ...(updates.schedule.kind === 'cron' && {
            expr: updates.schedule.expr
          })
        };
      }

      // Update payload fields
      if (updates.message !== undefined) {
        if (!updates.message.trim()) {
          return res.status(400).json({ error: 'Message cannot be empty' });
        }
        if (updates.message.length > MAX_MESSAGE_LENGTH) {
          return res.status(400).json({ error: `Message too long (max ${MAX_MESSAGE_LENGTH} chars)` });
        }
        job.payload.message = updates.message.trim();
      }

      if (updates.model !== undefined) {
        if (typeof updates.model !== 'string' || updates.model.length > 256) {
          return res.status(400).json({ error: 'model must be a string of 256 chars or less' });
        }
        job.payload.model = updates.model;
      }

      if (updates.timeoutSeconds !== undefined) {
        const ts = Number(updates.timeoutSeconds);
        if (!Number.isFinite(ts) || ts < 1 || ts > 3600 || Math.floor(ts) !== ts) {
          return res.status(400).json({ error: 'timeoutSeconds must be an integer between 1 and 3600' });
        }
        job.payload.timeoutSeconds = ts;
      }

      // Update timestamp
      job.updatedAtMs = Date.now();

      // Write back to file
      if (!writeCronJobs(data)) {
        return res.status(500).json({ error: 'Failed to update cron job' });
      }

      log.info(`Updated job ${id}: "${job.name}"`);
      recordAudit({ action: 'cron:update', target: id, details: { fields: Object.keys(updates) }, ip: req.ip });
      return res.json({
        success: true,
        job
      });
    });
  } catch (error) {
    log.error(`Error in PUT /api/cron/jobs/${req.params.id}: ${error.message}`);
    res.status(500).json({ error: 'Failed to update cron job' });
  }
});

/**
 * DELETE /api/cron/jobs/:id
 * Delete a cron job
 */
router.delete('/jobs/:id', async (req, res) => {
  try {
    // C5 Fix: Reject cron job deletion from AI agents (x-source-dept header)
    const sourceDept = req.headers['x-source-dept'];
    if (sourceDept) {
      return res.status(403).json({ error: 'AI agents cannot delete cron jobs. Use the UI or ask a human operator.' });
    }

    await withFileLock(CRON_FILE_PATH, async () => {
      const { id } = req.params;

      // Read existing jobs
      const data = readCronJobs();
      const jobIndex = data.jobs.findIndex(job => job.id === id);

      if (jobIndex === -1) {
        return res.status(404).json({ error: `Cron job ${id} not found` });
      }

      const job = data.jobs[jobIndex];

      // Remove from array
      data.jobs.splice(jobIndex, 1);

      // Write back to file
      if (!writeCronJobs(data)) {
        return res.status(500).json({ error: 'Failed to delete cron job' });
      }

      log.info(`Deleted job ${id}: "${job.name}"`);
      recordAudit({ action: 'cron:delete', target: id, details: { name: job.name }, ip: req.ip });
      return res.json({
        success: true,
        deletedJob: {
          id: job.id,
          name: job.name
        }
      });
    });
  } catch (error) {
    log.error(`Error in DELETE /api/cron/jobs/${req.params.id}: ${error.message}`);
    res.status(500).json({ error: 'Failed to delete cron job' });
  }
});

/**
 * POST /api/cron/jobs/:id/toggle
 * Toggle enabled/disabled status
 */
router.post('/jobs/:id/toggle', async (req, res) => {
  try {
    await withFileLock(CRON_FILE_PATH, async () => {
      const { id } = req.params;

      // Read existing jobs
      const data = readCronJobs();
      const job = findJobById(data.jobs, id);

      if (!job) {
        return res.status(404).json({ error: `Cron job ${id} not found` });
      }

      // Toggle enabled status
      job.enabled = !job.enabled;
      job.updatedAtMs = Date.now();

      // Write back to file
      if (!writeCronJobs(data)) {
        return res.status(500).json({ error: 'Failed to toggle cron job' });
      }

      log.info(`Toggled job ${id}: "${job.name}" -> ${job.enabled ? 'enabled' : 'disabled'}`);
      return res.json({
        success: true,
        job: {
          id: job.id,
          name: job.name,
          enabled: job.enabled
        }
      });
    });
  } catch (error) {
    log.error(`Error in POST /api/cron/jobs/${req.params.id}/toggle: ${error.message}`);
    res.status(500).json({ error: 'Failed to toggle cron job' });
  }
});

/**
 * POST /api/cron/jobs/:id/run
 * Trigger immediate run via Gateway
 * Sends the job's message to Gateway agent
 */
router.post('/jobs/:id/run', async (req, res) => {
  const { id } = req.params;

  if (_runningJobs.has(id)) {
    return res.status(409).json({ error: 'Job is already running', jobId: id });
  }

  try {
    _runningJobs.add(id);

    // Step 1: Read job config with file lock
    let job;
    let sessionKey;
    let message;

    await withFileLock(CRON_FILE_PATH, async () => {
      const data = readCronJobs();
      job = findJobById(data.jobs, id);

      if (!job) {
        return res.status(404).json({ error: `Cron job ${id} not found` });
      }

      // Build session key: use department context if assigned
      if (job.deptId && job.subAgentId) {
        sessionKey = `agent:main:${job.deptId}:sub:${job.subAgentId}`;
      } else if (job.deptId) {
        sessionKey = `agent:main:${job.deptId}`;
      } else {
        sessionKey = `cron:manual:${id}`;
      }
      message = job.payload.message;
    });

    // If job not found, error already sent
    if (!job) {
      return;
    }

    // Step 2: Execute Gateway call WITHOUT holding the file lock
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

    log.info(`Manual run triggered for job ${id}: "${job.name}"`);

    const startMs = Date.now();
    let result;
    let gatewayError;

    try {
      // Add timeout protection to job execution
      const timeoutMs = (job.payload.timeoutSeconds || DEFAULT_EXECUTION_TIMEOUT_MS / 1000) * 1000;
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`Job execution timeout after ${timeoutMs}ms`)), timeoutMs);
      });

      result = await Promise.race([
        gateway.sendAgentMessage(sessionKey, message),
        timeoutPromise
      ]);
    } catch (err) {
      gatewayError = err;
    }

    const durationMs = Date.now() - startMs;

    // Step 3: Re-acquire lock to write execution history
    await withFileLock(CRON_FILE_PATH, async () => {
      const data = readCronJobs();
      const jobToUpdate = findJobById(data.jobs, id);

      if (!jobToUpdate) {
        log.warn(`Job ${id} disappeared after execution`);
        return;
      }

      // Record execution history
      if (!jobToUpdate.state) jobToUpdate.state = {};
      if (!jobToUpdate.state.executionHistory) jobToUpdate.state.executionHistory = [];

      if (gatewayError) {
        // Failed execution
        jobToUpdate.state.executionHistory.push({
          timestamp: Date.now(),
          durationMs,
          success: false,
          responseLength: 0,
        });
        if (jobToUpdate.state.executionHistory.length > 20) {
          jobToUpdate.state.executionHistory = jobToUpdate.state.executionHistory.slice(-20);
        }
        jobToUpdate.state.lastRunAtMs = Date.now();
        jobToUpdate.state.lastDurationMs = durationMs;
        jobToUpdate.state.lastStatus = 'error';
        jobToUpdate.state.lastError = gatewayError.message;
        jobToUpdate.state.consecutiveErrors = (jobToUpdate.state.consecutiveErrors || 0) + 1;
      } else {
        // Successful execution
        jobToUpdate.state.executionHistory.push({
          timestamp: Date.now(),
          durationMs,
          success: !!result.text,
          responseLength: result.text ? result.text.length : 0,
        });
        if (jobToUpdate.state.executionHistory.length > 20) {
          jobToUpdate.state.executionHistory = jobToUpdate.state.executionHistory.slice(-20);
        }
        jobToUpdate.state.lastRunAtMs = Date.now();
        jobToUpdate.state.lastDurationMs = durationMs;
        jobToUpdate.state.lastStatus = result.text ? 'ok' : 'error';
      }

      writeCronJobs(data);
    });

    // Step 4: Send response to client
    if (gatewayError) {
      log.error(`Manual run failed for job ${id}: ${gatewayError.message}`);
      return res.status(502).json({
        error: 'Failed to execute cron job via gateway',
        detail: gatewayError.message,
        job: {
          id: job.id,
          name: job.name
        }
      });
    }

    if (result.text) {
      log.info(`Manual run completed for job ${id}, ${result.text.length} chars`);
      return res.json({
        success: true,
        job: {
          id: job.id,
          name: job.name
        },
        result: {
          text: result.text,
          length: result.text.length
        }
      });
    } else {
      return res.status(502).json({
        error: 'Gateway returned empty response',
        job: {
          id: job.id,
          name: job.name
        }
      });
    }
  } catch (error) {
    log.error(`Error in POST /api/cron/jobs/${req.params.id}/run: ${error.message}`);
    res.status(500).json({ error: 'Failed to trigger cron job run' });
  } finally {
    _runningJobs.delete(id);
  }
});

/**
 * POST /api/cron/briefing/template
 * Create a morning briefing cron job template (9:00 AM daily)
 * Sends briefing request to each department, collects responses, broadcasts to bulletin
 */
router.post('/briefing/template', async (req, res) => {
  try {
    // C5 Fix: Reject briefing template creation from AI agents (x-source-dept header)
    const sourceDept = req.headers['x-source-dept'];
    if (sourceDept) {
      return res.status(403).json({ error: 'AI agents cannot create cron jobs. Use the UI or ask a human operator.' });
    }

    await withFileLock(CRON_FILE_PATH, async () => {
      // Read existing jobs
      const data = readCronJobs();

      // Create a daily briefing job for each department
      const config = JSON.parse(fs.readFileSync(path.join(BASE_PATH, 'departments', 'config.json'), 'utf8'));
      const departments = config.departments || {};

      // Morning briefing job at 9:00 AM daily
      const now = Date.now();
      const briefingJob = {
        id: randomUUID(),
        agentId: 'main',
        name: '每日晨会简报',
        enabled: true,
        createdAtMs: now,
        updatedAtMs: now,
        deptId: 'coo', // Assign to COO to coordinate
        schedule: {
          kind: 'cron',
          expr: '0 9 * * *' // 9:00 AM every day
        },
        sessionTarget: 'isolated',
        wakeMode: 'now',
        payload: {
          kind: 'agentTurn',
          message: '早上好！请协调各部门进行每日简报汇总：\n\n1. 向每个部门发送简报请求（使用 POST /departments/{id}/chat API）\n2. 请求内容：「请提供今日简报：你的部门状态、待处理事项、今日重点工作」\n3. 收集所有部门的回复\n4. 将汇总后的简报发布到公告板（使用 POST /bulletin API）\n\n请开始执行。',
          timeoutSeconds: 300
        },
        delivery: {
          mode: 'none'
        },
        state: {
          consecutiveErrors: 0
        }
      };

      // Add to jobs array
      data.jobs.push(briefingJob);

      // Write back to file
      if (!writeCronJobs(data)) {
        return res.status(500).json({ error: 'Failed to save briefing template' });
      }

      log.info(`Created morning briefing template job ${briefingJob.id}`);
      return res.status(201).json({
        success: true,
        message: 'Morning briefing template created',
        job: briefingJob
      });
    });
  } catch (error) {
    log.error(`Error in POST /api/cron/briefing/template: ${error.message}`);
    res.status(500).json({ error: 'Failed to create briefing template' });
  }
});

export default router;
