import express from 'express';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { getGateway } from '../gateway.js';

const router = express.Router();

const CRON_FILE_PATH = '/root/.openclaw/cron/jobs.json';

// Input validation
const VALID_SCHEDULE_KINDS = ['every', 'cron'];
const MAX_NAME_LENGTH = 100;
const MAX_MESSAGE_LENGTH = 5000;

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
    console.error('Error reading cron jobs file:', error.message);
    return { version: 1, jobs: [] };
  }
}

/**
 * Helper: Write cron jobs file
 */
function writeCronJobs(data) {
  try {
    fs.writeFileSync(CRON_FILE_PATH, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('Error writing cron jobs file:', error.message);
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
  }

  if (schedule.kind === 'cron') {
    if (!schedule.expr || typeof schedule.expr !== 'string') {
      return { valid: false, error: 'expr (cron expression) is required for kind=cron' };
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
    console.error('Error in GET /api/cron/jobs:', error);
    res.status(500).json({ error: 'Failed to fetch cron jobs' });
  }
});

/**
 * POST /api/cron/jobs
 * Create a new cron job
 * Body: { name, schedule: { kind, everyMs?, expr? }, message, model?, timeoutSeconds? }
 */
router.post('/jobs', (req, res) => {
  try {
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

    console.log(`[Cron] Created job ${newJob.id}: "${newJob.name}"`);
    res.status(201).json({
      success: true,
      job: newJob
    });
  } catch (error) {
    console.error('Error in POST /api/cron/jobs:', error);
    res.status(500).json({ error: 'Failed to create cron job' });
  }
});

/**
 * PUT /api/cron/jobs/:id
 * Update a cron job (partial update)
 * Body: any fields to update (name, enabled, schedule, payload.message, etc.)
 */
router.put('/jobs/:id', (req, res) => {
  try {
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
      job.payload.model = updates.model;
    }

    if (updates.timeoutSeconds !== undefined) {
      job.payload.timeoutSeconds = updates.timeoutSeconds;
    }

    // Update timestamp
    job.updatedAtMs = Date.now();

    // Write back to file
    if (!writeCronJobs(data)) {
      return res.status(500).json({ error: 'Failed to update cron job' });
    }

    console.log(`[Cron] Updated job ${id}: "${job.name}"`);
    res.json({
      success: true,
      job
    });
  } catch (error) {
    console.error(`Error in PUT /api/cron/jobs/${req.params.id}:`, error);
    res.status(500).json({ error: 'Failed to update cron job' });
  }
});

/**
 * DELETE /api/cron/jobs/:id
 * Delete a cron job
 */
router.delete('/jobs/:id', (req, res) => {
  try {
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

    console.log(`[Cron] Deleted job ${id}: "${job.name}"`);
    res.json({
      success: true,
      deletedJob: {
        id: job.id,
        name: job.name
      }
    });
  } catch (error) {
    console.error(`Error in DELETE /api/cron/jobs/${req.params.id}:`, error);
    res.status(500).json({ error: 'Failed to delete cron job' });
  }
});

/**
 * POST /api/cron/jobs/:id/toggle
 * Toggle enabled/disabled status
 */
router.post('/jobs/:id/toggle', (req, res) => {
  try {
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

    console.log(`[Cron] Toggled job ${id}: "${job.name}" -> ${job.enabled ? 'enabled' : 'disabled'}`);
    res.json({
      success: true,
      job: {
        id: job.id,
        name: job.name,
        enabled: job.enabled
      }
    });
  } catch (error) {
    console.error(`Error in POST /api/cron/jobs/${req.params.id}/toggle:`, error);
    res.status(500).json({ error: 'Failed to toggle cron job' });
  }
});

/**
 * POST /api/cron/jobs/:id/run
 * Trigger immediate run via Gateway
 * Sends the job's message to Gateway agent
 */
router.post('/jobs/:id/run', async (req, res) => {
  try {
    const { id } = req.params;

    // Read existing jobs
    const data = readCronJobs();
    const job = findJobById(data.jobs, id);

    if (!job) {
      return res.status(404).json({ error: `Cron job ${id} not found` });
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

    // Build session key: use department context if assigned
    let sessionKey;
    if (job.deptId && job.subAgentId) {
      sessionKey = `agent:main:${job.deptId}:sub:${job.subAgentId}`;
    } else if (job.deptId) {
      sessionKey = `agent:main:${job.deptId}`;
    } else {
      sessionKey = `cron:manual:${id}`;
    }
    const message = job.payload.message;

    console.log(`[Cron] Manual run triggered for job ${id}: "${job.name}"`);

    try {
      const result = await gateway.sendAgentMessage(sessionKey, message);

      if (result.text) {
        console.log(`[Cron] Manual run completed for job ${id}, ${result.text.length} chars`);
        res.json({
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
        res.status(502).json({
          error: 'Gateway returned empty response',
          job: {
            id: job.id,
            name: job.name
          }
        });
      }
    } catch (err) {
      console.error(`[Cron] Manual run failed for job ${id}:`, err.message);
      res.status(502).json({
        error: 'Failed to execute cron job via gateway',
        detail: err.message,
        job: {
          id: job.id,
          name: job.name
        }
      });
    }
  } catch (error) {
    console.error(`Error in POST /api/cron/jobs/${req.params.id}/run:`, error);
    res.status(500).json({ error: 'Failed to trigger cron job run' });
  }
});

export default router;
