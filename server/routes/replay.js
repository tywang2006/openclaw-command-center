import express from 'express';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { safeWriteFileSync } from '../utils.js';
import { createLogger } from '../logger.js';

const log = createLogger('Replay');
const router = express.Router();

const REPLAYS_DIR = path.join(path.dirname(new URL(import.meta.url).pathname), '../../replays');

// Safe ID pattern to prevent path traversal
const SAFE_ID = /^[a-zA-Z0-9-]+$/;

// In-memory recording state
let recording = null; // { id, startedAt, events: [] }

/**
 * Start/stop hooks — call addReplayEvent() from index.js when broadcasting WS events
 */
export function isRecording() {
  return recording !== null;
}

const MAX_REPLAY_EVENTS = 10000;

export function addReplayEvent(event) {
  if (!recording) return;
  if (recording.events.length >= MAX_REPLAY_EVENTS) return;
  recording.events.push({
    ...event,
    replayTs: Date.now(),
  });
}

function ensureDir() {
  if (!fs.existsSync(REPLAYS_DIR)) {
    fs.mkdirSync(REPLAYS_DIR, { recursive: true });
  }
}

/**
 * POST /api/replay/start
 * Start recording broadcast events
 */
router.post('/start', (req, res) => {
  if (recording) {
    return res.status(409).json({ error: 'Already recording', id: recording.id });
  }

  recording = {
    id: randomUUID(),
    name: req.body.name || `Recording ${new Date().toISOString().slice(0, 19)}`,
    startedAt: Date.now(),
    events: [],
  };

  log.info('Started recording', { id: recording.id, name: recording.name });
  res.json({ success: true, id: recording.id, name: recording.name });
});

/**
 * POST /api/replay/stop
 * Stop recording and save to file
 */
router.post('/stop', (req, res) => {
  if (!recording) {
    return res.status(409).json({ error: 'Not recording' });
  }

  ensureDir();

  const replay = {
    id: recording.id,
    name: recording.name,
    startedAt: recording.startedAt,
    stoppedAt: Date.now(),
    durationMs: Date.now() - recording.startedAt,
    eventCount: recording.events.length,
    events: recording.events,
  };

  const filePath = path.join(REPLAYS_DIR, `${replay.id}.json`);
  try {
    safeWriteFileSync(filePath, JSON.stringify(replay, null, 2));
  } catch (err) {
    log.error('Failed to save replay', { error: err.message });
    recording = null;
    return res.status(500).json({ error: 'Failed to save replay' });
  }

  log.info('Stopped recording', { id: replay.id, eventCount: replay.eventCount, durationMs: replay.durationMs });
  recording = null;

  res.json({
    success: true,
    replay: {
      id: replay.id,
      name: replay.name,
      durationMs: replay.durationMs,
      eventCount: replay.eventCount,
    },
  });
});

/**
 * GET /api/replay/status
 * Get current recording status
 */
router.get('/status', (req, res) => {
  if (!recording) {
    return res.json({ recording: false });
  }
  res.json({
    recording: true,
    id: recording.id,
    name: recording.name,
    startedAt: recording.startedAt,
    eventCount: recording.events.length,
    durationMs: Date.now() - recording.startedAt,
  });
});

/**
 * GET /api/replay/list
 * List saved replays
 */
router.get('/list', (req, res) => {
  ensureDir();
  try {
    const files = fs.readdirSync(REPLAYS_DIR).filter(f => f.endsWith('.json'));
    const replays = files.map(f => {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(REPLAYS_DIR, f), 'utf8'));
        return {
          id: data.id,
          name: data.name,
          startedAt: data.startedAt,
          durationMs: data.durationMs,
          eventCount: data.eventCount,
        };
      } catch {
        return null;
      }
    }).filter(Boolean).sort((a, b) => b.startedAt - a.startedAt);

    res.json({ replays, count: replays.length });
  } catch {
    res.json({ replays: [], count: 0 });
  }
});

/**
 * GET /api/replay/:id
 * Get a replay (full events)
 */
router.get('/:id', (req, res) => {
  if (!SAFE_ID.test(req.params.id)) {
    return res.status(400).json({ error: 'Invalid replay ID' });
  }
  ensureDir();
  const filePath = path.join(REPLAYS_DIR, `${req.params.id}.json`);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Replay not found' });
  }

  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    res.json({ replay: data });
  } catch {
    res.status(500).json({ error: 'Failed to read replay' });
  }
});

/**
 * DELETE /api/replay/:id
 * Delete a replay
 */
router.delete('/:id', (req, res) => {
  if (!SAFE_ID.test(req.params.id)) {
    return res.status(400).json({ error: 'Invalid replay ID' });
  }
  const filePath = path.join(REPLAYS_DIR, `${req.params.id}.json`);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Replay not found' });
  }

  try {
    fs.unlinkSync(filePath);
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Failed to delete replay' });
  }
});

export default router;
