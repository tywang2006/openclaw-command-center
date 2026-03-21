import express from 'express';
import fs from 'fs';
import path from 'path';
import { parseJsonlLine, readLastLines } from '../parsers/jsonl.js';
import { BASE_PATH } from '../utils.js';
import { createLogger } from '../logger.js';

const log = createLogger('Activity');
const router = express.Router();

const MAX_TAIL = 500;

/**
 * GET /api/activity/{:topicId}?tail=50
 * Return last N messages from matching JSONL session file
 */
router.get('/activity/{:topicId}', (req, res) => {
  try {
    const { topicId } = req.params;
    const tail = Math.min(parseInt(req.query.tail) || 50, MAX_TAIL);

    const sessionsDir = path.join(BASE_PATH, 'agents', 'main', 'sessions');

    if (!fs.existsSync(sessionsDir)) {
      return res.json({ messages: [], topicId });
    }

    // Find matching session file
    let sessionFile = null;
    if (topicId) {
      const files = fs.readdirSync(sessionsDir);
      sessionFile = files.find(file =>
        file.includes(`-topic-${topicId}`) && file.endsWith('.jsonl')
      );
    } else {
      // Get most recent session file
      const files = fs.readdirSync(sessionsDir)
        .filter(file => file.endsWith('.jsonl'))
        .map(file => ({
          name: file,
          path: path.join(sessionsDir, file),
          mtime: fs.statSync(path.join(sessionsDir, file)).mtime
        }))
        .sort((a, b) => b.mtime - a.mtime);

      if (files.length > 0) {
        sessionFile = files[0].name;
      }
    }

    if (!sessionFile) {
      return res.json({ messages: [], topicId });
    }

    const sessionPath = path.join(sessionsDir, sessionFile);
    const lines = readLastLines(sessionPath, tail);
    const messages = lines
      .map(line => parseJsonlLine(line))
      .filter(msg => msg !== null);

    res.json({
      topicId: topicId || 'latest',
      sessionFile,
      messages,
      count: messages.length
    });
  } catch (error) {
    log.error('Error in /api/activity: ' + error.message);
    res.status(500).json({ error: 'Failed to fetch activity' });
  }
});

export default router;
