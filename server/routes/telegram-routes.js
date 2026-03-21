import express from 'express';
import path from 'path';
import { BASE_PATH, readJsonFile, validateDepartmentId } from '../utils.js';
import { createLogger } from '../logger.js';

const log = createLogger('Telegram');
const router = express.Router();

const MAX_MESSAGE_LENGTH = 10000;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const GROUP_ID = process.env.TELEGRAM_GROUP_ID || '';
const TG_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

function validateDeptId(id) {
  return validateDepartmentId(id);
}

/**
 * Helper: Get topic ID for a department
 */
function getTopicId(deptId) {
  const configPath = path.join(BASE_PATH, 'departments', 'config.json');
  const config = readJsonFile(configPath);
  if (!config?.departments?.[deptId]) return null;
  const topicId = config.departments[deptId].telegramTopicId;
  return topicId !== undefined ? String(topicId) : null;
}

/**
 * POST /api/departments/:id/message
 * Send a text message to the department's Telegram topic
 * Body: { text: "message content" }
 */
router.post('/departments/:id/message', async (req, res) => {
  try {
    const { id } = req.params;
    if (!validateDeptId(id)) {
      return res.status(400).json({ error: 'Invalid department ID' });
    }
    const { text } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'Message text is required' });
    }
    if (text.length > MAX_MESSAGE_LENGTH) {
      return res.status(400).json({ error: `Message too long (max ${MAX_MESSAGE_LENGTH} chars)` });
    }

    const topicId = getTopicId(id);
    if (!topicId) {
      return res.status(404).json({ error: `Department ${id} not found` });
    }

    const params = new URLSearchParams({
      chat_id: GROUP_ID,
      text: text.trim(),
      parse_mode: 'Markdown'
    });
    // Topic ID "1" is the General thread — don't set message_thread_id for it
    if (topicId !== '1') {
      params.set('message_thread_id', topicId);
    }

    const tgRes = await fetch(`${TG_API}/sendMessage?${params}`, {
      signal: AbortSignal.timeout(30000)
    });
    const tgData = await tgRes.json();

    if (!tgData.ok) {
      log.error('Telegram sendMessage failed: ' + (tgData.description || 'Unknown error'));
      return res.status(502).json({ error: 'Failed to send message', detail: tgData.description });
    }

    res.json({ success: true, messageId: tgData.result.message_id });
  } catch (error) {
    log.error(`Error in POST /api/departments/${req.params.id}/message: ` + error.message);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

/**
 * POST /api/departments/:id/photo
 * Send a photo to the department's Telegram topic
 * Body: multipart/form-data with field "photo" (file) and optional "caption" (text)
 */
router.post('/departments/:id/photo', async (req, res) => {
  try {
    const { id } = req.params;
    if (!validateDeptId(id)) {
      return res.status(400).json({ error: 'Invalid department ID' });
    }

    const topicId = getTopicId(id);
    if (!topicId) {
      return res.status(404).json({ error: `Department ${id} not found` });
    }

    const { photo: photoData, caption = '' } = req.body;

    if (!photoData) {
      return res.status(400).json({ error: 'Photo data is required' });
    }

    // Convert base64 to buffer
    const photoBuffer = Buffer.from(photoData.replace(/^data:image\/\w+;base64,/, ''), 'base64');

    // Use native FormData (Node 18+)
    const form = new FormData();
    form.append('chat_id', GROUP_ID);
    if (topicId !== '1') {
      form.append('message_thread_id', topicId);
    }
    if (caption) {
      form.append('caption', caption);
    }
    form.append('photo', new Blob([photoBuffer], { type: 'image/png' }), 'screenshot.png');

    const tgRes = await fetch(`${TG_API}/sendPhoto`, {
      method: 'POST',
      body: form
    });
    const tgData = await tgRes.json();

    if (!tgData.ok) {
      log.error('Telegram sendPhoto failed: ' + (tgData.description || 'Unknown error'));
      return res.status(502).json({ error: 'Failed to send photo', detail: tgData.description });
    }

    res.json({ success: true, messageId: tgData.result.message_id });
  } catch (error) {
    log.error(`Error in POST /api/departments/${req.params.id}/photo: ` + error.message);
    res.status(500).json({ error: 'Failed to send photo' });
  }
});

export default router;
