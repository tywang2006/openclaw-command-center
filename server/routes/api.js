import express from 'express';
import fs from 'fs';
import path from 'path';
import { parseJsonlLine, readLastLines } from '../parsers/jsonl.js';
import { chat, getChatHistory, loadMemory, saveMemory, loadBulletin, saveBulletin, createSubAgent, chatSubAgent, listSubAgents, removeSubAgent, broadcastCommand } from '../agent.js';

const router = express.Router();

// Base data path
const BASE_PATH = '/root/.openclaw/workspace';

// Input validation
const VALID_DEPT_ID = /^[a-z][a-z0-9_-]{0,30}$/;
const VALID_DATE = /^\d{4}-\d{2}-\d{2}$/;
const VALID_SUB_ID = /^[a-z][a-z0-9_-]{0,60}$/;
const MAX_MESSAGE_LENGTH = 10000;
const MAX_TAIL = 500;

function validateDeptId(id) {
  return typeof id === 'string' && VALID_DEPT_ID.test(id);
}

function validateDate(date) {
  return typeof date === 'string' && VALID_DATE.test(date);
}

function validateSubId(id) {
  return typeof id === 'string' && VALID_SUB_ID.test(id);
}

/**
 * Helper: Read JSON file safely
 */
function readJsonFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(content);
    }
    return null;
  } catch (error) {
    console.error(`Error reading JSON file ${filePath}:`, error.message);
    return null;
  }
}

/**
 * Helper: Read text file safely
 */
function readTextFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf8');
    }
    return '';
  } catch (error) {
    console.error(`Error reading text file ${filePath}:`, error.message);
    return '';
  }
}

/**
 * GET /api/departments
 * Merge departments/config.json + departments/status.json
 */
router.get('/departments', (req, res) => {
  try {
    const configPath = path.join(BASE_PATH, 'departments', 'config.json');
    const statusPath = path.join(BASE_PATH, 'departments', 'status.json');

    const config = readJsonFile(configPath) || { departments: {} };
    const status = readJsonFile(statusPath) || { agents: {} };

    // Merge config and status
    const departments = Object.entries(config.departments || {}).map(([key, dept]) => {
      const agentStatus = status.agents[dept.id] || {};
      return {
        ...dept,
        status: agentStatus.status || 'idle',
        lastSeen: agentStatus.lastSeen || null,
        currentTask: agentStatus.currentTask || null,
        sessionCount: agentStatus.sessionCount || 0
      };
    });

    res.json({
      departments,
      lastUpdated: status.lastUpdated || new Date().toISOString()
    });
  } catch (error) {
    console.error('Error in /api/departments:', error);
    res.status(500).json({ error: 'Failed to fetch departments' });
  }
});

/**
 * GET /api/departments/:id/memory
 * Return department's MEMORY.md content
 */
router.get('/departments/:id/memory', (req, res) => {
  try {
    const { id } = req.params;
    if (!validateDeptId(id)) {
      return res.status(400).json({ error: 'Invalid department ID' });
    }
    const memoryPath = path.join(BASE_PATH, 'departments', id, 'memory', 'MEMORY.md');

    const content = readTextFile(memoryPath);

    res.json({
      departmentId: id,
      content,
      exists: fs.existsSync(memoryPath)
    });
  } catch (error) {
    console.error(`Error in /api/departments/${req.params.id}/memory:`, error);
    res.status(500).json({ error: 'Failed to fetch department memory' });
  }
});

/**
 * PUT /api/departments/:id/memory
 * Update department's MEMORY.md content
 * Body: { content: "markdown content" }
 */
router.put('/departments/:id/memory', (req, res) => {
  try {
    const { id } = req.params;
    if (!validateDeptId(id)) {
      return res.status(400).json({ error: 'Invalid department ID' });
    }
    const { content } = req.body;
    if (content === undefined) {
      return res.status(400).json({ error: 'Content is required' });
    }
    const success = saveMemory(id, content);
    res.json({ success, departmentId: id });
  } catch (error) {
    console.error(`Error in PUT /api/departments/${req.params.id}/memory:`, error);
    res.status(500).json({ error: 'Failed to save department memory' });
  }
});

/**
 * GET /api/departments/:id/daily/:date?
 * Return department's daily log (defaults to today YYYY-MM-DD)
 */
router.get('/departments/:id/daily/:date?', (req, res) => {
  try {
    const { id, date } = req.params;
    if (!validateDeptId(id)) {
      return res.status(400).json({ error: 'Invalid department ID' });
    }
    const targetDate = date || new Date().toISOString().split('T')[0];
    if (!validateDate(targetDate)) {
      return res.status(400).json({ error: 'Invalid date format (YYYY-MM-DD)' });
    }
    const dailyPath = path.join(BASE_PATH, 'departments', id, 'daily', `${targetDate}.md`);

    const content = readTextFile(dailyPath);

    res.json({
      departmentId: id,
      date: targetDate,
      content,
      exists: fs.existsSync(dailyPath)
    });
  } catch (error) {
    console.error(`Error in /api/departments/${req.params.id}/daily:`, error);
    res.status(500).json({ error: 'Failed to fetch daily log' });
  }
});

/**
 * GET /api/bulletin
 * Return bulletin/board.md content
 */
router.get('/bulletin', (req, res) => {
  try {
    const bulletinPath = path.join(BASE_PATH, 'departments', 'bulletin', 'board.md');
    const content = readTextFile(bulletinPath);

    res.json({
      content,
      exists: fs.existsSync(bulletinPath),
      lastModified: fs.existsSync(bulletinPath)
        ? fs.statSync(bulletinPath).mtime.toISOString()
        : null
    });
  } catch (error) {
    console.error('Error in /api/bulletin:', error);
    res.status(500).json({ error: 'Failed to fetch bulletin' });
  }
});

/**
 * GET /api/requests
 * List all files in bulletin/requests/ and return their contents
 */
router.get('/requests', (req, res) => {
  try {
    const requestsDir = path.join(BASE_PATH, 'departments', 'bulletin', 'requests');

    if (!fs.existsSync(requestsDir)) {
      return res.json({ requests: [] });
    }

    const files = fs.readdirSync(requestsDir)
      .filter(file => file.endsWith('.md') && !file.startsWith('.deleted') && !file.startsWith('.bak'));

    const requests = files.map(file => {
      const filePath = path.join(requestsDir, file);
      const content = readTextFile(filePath);
      const stats = fs.statSync(filePath);

      return {
        filename: file,
        content,
        created: stats.birthtime.toISOString(),
        modified: stats.mtime.toISOString()
      };
    });

    res.json({ requests });
  } catch (error) {
    console.error('Error in /api/requests:', error);
    res.status(500).json({ error: 'Failed to fetch requests' });
  }
});

/**
 * GET /api/activity/:topicId?tail=50
 * Return last N messages from matching JSONL session file
 */
router.get('/activity/:topicId?', (req, res) => {
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
    console.error('Error in /api/activity:', error);
    res.status(500).json({ error: 'Failed to fetch activity' });
  }
});

/**
 * GET /api/departments/:id/persona
 * Return department's persona markdown
 */
router.get('/departments/:id/persona', (req, res) => {
  try {
    const { id } = req.params;
    if (!validateDeptId(id)) {
      return res.status(400).json({ error: 'Invalid department ID' });
    }
    const personaPath = path.join(BASE_PATH, 'departments', 'personas', `${id}.md`);
    const content = readTextFile(personaPath);
    res.json({ departmentId: id, content, exists: fs.existsSync(personaPath) });
  } catch (error) {
    console.error(`Error in /api/departments/${req.params.id}/persona:`, error);
    res.status(500).json({ error: 'Failed to fetch persona' });
  }
});

/**
 * GET /api/departments/:id/daily-dates
 * List available daily log dates for a department
 */
router.get('/departments/:id/daily-dates', (req, res) => {
  try {
    const { id } = req.params;
    if (!validateDeptId(id)) {
      return res.status(400).json({ error: 'Invalid department ID' });
    }
    const dailyDir = path.join(BASE_PATH, 'departments', id, 'daily');
    if (!fs.existsSync(dailyDir)) {
      return res.json({ dates: [] });
    }
    const dates = fs.readdirSync(dailyDir)
      .filter(f => f.endsWith('.md') && VALID_DATE.test(f.replace('.md', '')))
      .map(f => f.replace('.md', ''))
      .sort()
      .reverse();
    res.json({ dates, departmentId: id });
  } catch (error) {
    console.error(`Error in /api/departments/${req.params.id}/daily-dates:`, error);
    res.status(500).json({ error: 'Failed to fetch daily dates' });
  }
});

/**
 * GET /api/departments/:id/memory/history
 * List memory backup versions (last 20)
 */
router.get('/departments/:id/memory/history', (req, res) => {
  try {
    const { id } = req.params;
    if (!validateDeptId(id)) {
      return res.status(400).json({ error: 'Invalid department ID' });
    }
    const memDir = path.join(BASE_PATH, 'departments', id, 'memory');
    if (!fs.existsSync(memDir)) {
      return res.json({ versions: [] });
    }
    const versions = fs.readdirSync(memDir)
      .filter(f => f.endsWith('.md.bak'))
      .map(f => {
        const filePath = path.join(memDir, f);
        const stats = fs.statSync(filePath);
        return {
          filename: f,
          timestamp: stats.mtime.toISOString(),
          size: stats.size,
        };
      })
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, 20);
    res.json({ versions, departmentId: id });
  } catch (error) {
    console.error(`Error in /api/departments/${req.params.id}/memory/history:`, error);
    res.status(500).json({ error: 'Failed to fetch memory history' });
  }
});

/**
 * GET /api/departments/:id/memory/history/:filename
 * Get content of a specific memory backup version
 */
router.get('/departments/:id/memory/history/:filename', (req, res) => {
  try {
    const { id, filename } = req.params;
    if (!validateDeptId(id)) {
      return res.status(400).json({ error: 'Invalid department ID' });
    }
    if (!filename.endsWith('.md.bak') || filename.includes('..') || filename.includes('/')) {
      return res.status(400).json({ error: 'Invalid filename' });
    }
    const filePath = path.join(BASE_PATH, 'departments', id, 'memory', filename);
    const content = readTextFile(filePath);
    res.json({ content, filename, exists: fs.existsSync(filePath) });
  } catch (error) {
    console.error(`Error in /api/departments/${req.params.id}/memory/history:`, error);
    res.status(500).json({ error: 'Failed to fetch memory version' });
  }
});

/**
 * GET /api/collaboration
 * Parse bulletin/requests for inter-department references
 * Returns: { links: [{ from: deptId, to: deptId, label: string }] }
 */
router.get('/collaboration', (req, res) => {
  try {
    const requestsDir = path.join(BASE_PATH, 'departments', 'bulletin', 'requests');
    const links = [];

    if (!fs.existsSync(requestsDir)) {
      return res.json({ links });
    }

    // Get known department IDs
    const configPath = path.join(BASE_PATH, 'departments', 'config.json');
    const config = readJsonFile(configPath) || { departments: {} };
    const deptIds = new Set(Object.values(config.departments || {}).map(d => d.id));

    const files = fs.readdirSync(requestsDir)
      .filter(f => f.endsWith('.md') && !f.startsWith('.'));

    for (const file of files) {
      const content = readTextFile(path.join(requestsDir, file));
      // Filename pattern: from-dept_to-dept_*.md or content mentioning dept IDs
      for (const fromId of deptIds) {
        if (!content.toLowerCase().includes(fromId)) continue;
        for (const toId of deptIds) {
          if (fromId === toId) continue;
          if (content.toLowerCase().includes(toId)) {
            // Check for duplicates
            if (!links.some(l => l.from === fromId && l.to === toId)) {
              links.push({ from: fromId, to: toId, label: file.replace('.md', '') });
            }
          }
        }
      }
    }

    res.json({ links });
  } catch (error) {
    console.error('Error in /api/collaboration:', error);
    res.status(500).json({ error: 'Failed to fetch collaboration data' });
  }
});

// ============================================================
// Telegram Bot API Integration
// ============================================================

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const GROUP_ID = process.env.TELEGRAM_GROUP_ID || '';
const TG_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

/**
 * Helper: Get topic ID for a department
 */
function getTopicId(deptId) {
  const configPath = path.join(BASE_PATH, 'departments', 'config.json');
  const config = readJsonFile(configPath);
  if (!config || !config.departments) return null;
  for (const [topicId, dept] of Object.entries(config.departments)) {
    if (dept.id === deptId) return topicId;
  }
  return null;
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

    const tgRes = await fetch(`${TG_API}/sendMessage?${params}`);
    const tgData = await tgRes.json();

    if (!tgData.ok) {
      console.error('[Telegram] sendMessage failed:', tgData);
      return res.status(502).json({ error: 'Failed to send message', detail: tgData.description });
    }

    res.json({ success: true, messageId: tgData.result.message_id });
  } catch (error) {
    console.error(`Error in POST /api/departments/${req.params.id}/message:`, error);
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
      console.error('[Telegram] sendPhoto failed:', tgData);
      return res.status(502).json({ error: 'Failed to send photo', detail: tgData.description });
    }

    res.json({ success: true, messageId: tgData.result.message_id });
  } catch (error) {
    console.error(`Error in POST /api/departments/${req.params.id}/photo:`, error);
    res.status(500).json({ error: 'Failed to send photo' });
  }
});

// ============================================================
// Agent Chat API
// ============================================================

/**
 * GET /api/departments/:id/history
 * Get chat history from OpenClaw Gateway (Telegram + app messages)
 */
router.get('/departments/:id/history', async (req, res) => {
  try {
    const { id } = req.params;
    if (!validateDeptId(id)) {
      return res.status(400).json({ error: 'Invalid department ID' });
    }
    const limit = Math.min(parseInt(req.query.limit) || 30, 100);
    const messages = await getChatHistory(id, limit);
    res.json({ success: true, messages, deptId: id });
  } catch (error) {
    console.error(`Error in GET /api/departments/${req.params.id}/history:`, error);
    res.status(500).json({ error: 'Failed to fetch chat history' });
  }
});

/**
 * POST /api/departments/:id/chat
 * Chat with a department's AI agent
 * Body: { message: "your message" }
 * Returns: { reply: "agent response", deptId }
 */
router.post('/departments/:id/chat', async (req, res) => {
  try {
    const { id } = req.params;
    if (!validateDeptId(id)) {
      return res.status(400).json({ error: 'Invalid department ID' });
    }
    const { message, images } = req.body;

    if ((!message || !message.trim()) && (!images || images.length === 0)) {
      return res.status(400).json({ error: 'Message or image is required' });
    }
    if (message && message.length > MAX_MESSAGE_LENGTH) {
      return res.status(400).json({ error: `Message too long (max ${MAX_MESSAGE_LENGTH} chars)` });
    }

    const msgText = (message || '').trim();
    const imgCount = Array.isArray(images) ? images.length : 0;
    console.log(`[Chat] ${id} <- ${msgText.substring(0, 60)}${imgCount ? ` [+${imgCount} images]` : ''}`);

    const result = await chat(id, msgText, images);

    if (result.success) {
      console.log(`[Chat] ${id} -> ${result.reply.substring(0, 60)}`);
      res.json({ success: true, reply: result.reply, deptId: id });
    } else {
      let errMsg = result.error || 'Agent failed to respond';
      if (errMsg.includes('timeout') || errMsg.includes('TIMEOUT')) {
        errMsg = 'Gateway response timeout, please try again.';
      } else if (errMsg.includes('not connected') || errMsg.includes('DISCONNECTED')) {
        errMsg = 'Gateway not connected, please check OpenClaw service.';
      }
      res.status(502).json({ error: errMsg });
    }
  } catch (error) {
    console.error(`Error in POST /api/departments/${req.params.id}/chat:`, error);
    res.status(500).json({ error: 'Chat failed' });
  }
});

/**
 * POST /api/bulletin
 * Update the bulletin board
 * Body: { content: "markdown content" }
 */
router.post('/bulletin', (req, res) => {
  try {
    const { content } = req.body;
    if (content === undefined) {
      return res.status(400).json({ error: 'Content is required' });
    }
    const success = saveBulletin(content);
    res.json({ success });
  } catch (error) {
    console.error('Error in POST /api/bulletin:', error);
    res.status(500).json({ error: 'Failed to update bulletin' });
  }
});

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

    console.log(`[Broadcast] <- ${command.trim().substring(0, 80)}`);
    const responses = await broadcastCommand(command.trim());
    console.log(`[Broadcast] ${responses.length} departments responded`);

    res.json({ success: true, responses });
  } catch (error) {
    console.error('Error in POST /api/broadcast:', error);
    res.status(500).json({ error: 'Broadcast failed' });
  }
});

// ============================================================
// Sub-Agent API
// ============================================================

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
router.post('/departments/:id/subagents', (req, res) => {
  if (!validateDeptId(req.params.id)) {
    return res.status(400).json({ error: 'Invalid department ID' });
  }
  const { task, name } = req.body;
  if (!task || !task.trim()) {
    return res.status(400).json({ error: 'Task description is required' });
  }
  if (task.length > MAX_MESSAGE_LENGTH) {
    return res.status(400).json({ error: `Task description too long (max ${MAX_MESSAGE_LENGTH} chars)` });
  }
  const result = createSubAgent(req.params.id, task.trim(), name?.trim() || undefined);
  res.json({ success: true, ...result });
});

/**
 * POST /api/departments/:id/subagents/:subId/chat
 * Chat with a specific sub-agent
 * Body: { message: "your message" }
 */
router.post('/departments/:id/subagents/:subId/chat', async (req, res) => {
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
  const result = await chatSubAgent(req.params.id, req.params.subId, message.trim());
  res.json(result);
});

/**
 * DELETE /api/departments/:id/subagents/:subId
 * Remove a sub-agent
 */
router.delete('/departments/:id/subagents/:subId', (req, res) => {
  if (!validateDeptId(req.params.id) || !validateSubId(req.params.subId)) {
    return res.status(400).json({ error: 'Invalid department or sub-agent ID' });
  }
  const removed = removeSubAgent(req.params.id, req.params.subId);
  res.json({ success: removed });
});

export default router;
