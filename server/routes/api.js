import express from 'express';
import fs from 'fs';
import path from 'path';
import { parseJsonlLine, readLastLines } from '../parsers/jsonl.js';
import { chat, chatAsync, getChatHistory, loadMemory, saveMemory, loadBulletin, saveBulletin, createSubAgent, chatSubAgent, listSubAgents, removeSubAgent, broadcastCommand } from '../agent.js';
import { generateAndSave } from '../layout-generator.js';
import { BASE_PATH, readJsonFile, readTextFile, safeWriteFileSync } from '../utils.js';

const router = express.Router();

function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

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
 * GET /api/departments
 * Merge departments/config.json + departments/status.json
 */
router.get('/departments', (req, res) => {
  try {
    const deptBaseDir = path.join(BASE_PATH, 'departments');
    const configPath = path.join(deptBaseDir, 'config.json');
    const statusPath = path.join(deptBaseDir, 'status.json');

    // Ensure departments directory exists (fresh installs won't have it)
    if (!fs.existsSync(deptBaseDir)) {
      fs.mkdirSync(deptBaseDir, { recursive: true });
    }

    const config = readJsonFile(configPath) || { departments: {} };
    const status = readJsonFile(statusPath) || { agents: {} };

    // Forward-compatible: handle both { departments: {...} } and flat object
    const deptSource = config.departments || config;

    // Merge config and status with defensive defaults
    const departments = Object.entries(deptSource)
      .filter(([, v]) => typeof v === 'object' && v !== null && typeof v.name === 'string')
      .sort((a, b) => (a[1].order ?? 99) - (b[1].order ?? 99))
      .map(([id, dept]) => {
        const agentStatus = status.agents?.[id] || {};
        return {
          id,
          name: dept.name || id,
          agent: dept.agent || dept.name || id,
          icon: dept.icon || 'bolt',
          color: dept.color || '#94a3b8',
          hue: dept.hue ?? 200,
          order: dept.order ?? 99,
          telegramTopicId: dept.telegramTopicId,
          skills: dept.skills || ['*'],
          apiGroups: dept.apiGroups || ['*'],
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
 * GET /api/departments/:id/daily/{:date}
 * Return department's daily log (defaults to today YYYY-MM-DD)
 */
router.get('/departments/:id/daily/{:date}', (req, res) => {
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
    const deptIds = new Set(Object.keys(config.departments || {}));

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
 * Body: { message: "your message", images: [], documents: [] }
 * Returns: { reply: "agent response", deptId, attachments: [] }
 */
router.post('/departments/:id/chat', async (req, res) => {
  try {
    const { id } = req.params;
    if (!validateDeptId(id)) {
      return res.status(400).json({ error: 'Invalid department ID' });
    }
    const { message, images, documents, async: isAsync, sourceDept } = req.body || {};

    if ((!message || !message.trim()) && (!images || images.length === 0) && (!documents || documents.length === 0)) {
      return res.status(400).json({ error: 'Message, image, or document is required' });
    }
    if (message && message.length > MAX_MESSAGE_LENGTH) {
      return res.status(400).json({ error: `Message too long (max ${MAX_MESSAGE_LENGTH} chars)` });
    }

    const msgText = (message || '').trim();
    const imgCount = Array.isArray(images) ? images.length : 0;
    const docCount = Array.isArray(documents) ? documents.length : 0;
    console.log(`[Chat] ${id} <- ${msgText.substring(0, 60)}${imgCount ? ` [+${imgCount} images]` : ''}${docCount ? ` [+${docCount} docs]` : ''}`);

    // Cross-department: broadcast visit event + create request file
    if (sourceDept && sourceDept !== id) {
      const wss = req.app.locals.wss;
      if (wss) {
        const visitPayload = JSON.stringify({
          event: 'dept:visit',
          data: { from: sourceDept, to: id, message: msgText.substring(0, 100) },
          timestamp: new Date().toISOString(),
        });
        wss.clients.forEach(c => {
          if (c.readyState === 1 && c._authenticated) try { c.send(visitPayload); } catch {}
        });
      }

      // Create request file in bulletin/requests/ so it shows in the UI
      try {
        const requestsDir = path.join(BASE_PATH, 'departments', 'bulletin', 'requests');
        if (!fs.existsSync(requestsDir)) fs.mkdirSync(requestsDir, { recursive: true });
        const configPath = path.join(BASE_PATH, 'departments', 'config.json');
        const config = readJsonFile(configPath) || { departments: {} };
        const fromName = config.departments?.[sourceDept]?.name || sourceDept;
        const toName = config.departments?.[id]?.name || id;
        const ts = new Date();
        const dateStr = ts.toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const filename = `${sourceDept}_${id}_${dateStr}.md`;
        const content = `# 跨部门请求\n\n- **发起部门**: ${fromName} (${sourceDept})\n- **目标部门**: ${toName} (${id})\n- **时间**: ${ts.toLocaleString('zh-CN')}\n\n## 内容\n\n${msgText}\n`;
        fs.writeFileSync(path.join(requestsDir, filename), content);
      } catch (err) {
        console.error('[Chat] Failed to write request file:', err.message);
      }
    }

    // Async mode: fire-and-forget, return immediately
    if (isAsync) {
      const result = chatAsync(id, msgText);
      if (result.success) {
        return res.json({ success: true, status: 'sent', deptId: id });
      }
      return res.status(502).json({ error: result.error });
    }

    // Build enhanced message with document content
    let enhancedMessage = msgText;
    if (documents && documents.length > 0) {
      enhancedMessage += '\n\n[Documents:\n';
      for (const doc of documents) {
        enhancedMessage += `\n--- ${doc.name} ---\n`;
        if (doc.extracted) {
          if (doc.extracted.text) {
            enhancedMessage += doc.extracted.text.substring(0, 5000); // Limit text length
          } else if (doc.extracted.sheets) {
            // Excel data
            const sheetData = Object.entries(doc.extracted.sheets).map(([name, data]) => {
              return `Sheet: ${name}\n${JSON.stringify(data.slice(0, 10), null, 2)}`;
            }).join('\n\n');
            enhancedMessage += sheetData;
          } else if (doc.extracted.slides) {
            // PowerPoint data
            const slideText = doc.extracted.slides.map((s) => `Slide ${s.slide}:\n${s.text}`).join('\n\n');
            enhancedMessage += slideText;
          }
        }
        enhancedMessage += '\n';
      }
      enhancedMessage += ']';
    }

    const result = await chat(id, enhancedMessage, images);

    if (result.success) {
      console.log(`[Chat] ${id} -> ${result.reply.substring(0, 60)}`);
      
      // Check if reply contains file references
      const attachments = [];
      const fileMatches = result.reply.match(/\[FILE:\s*(.+?)\s*\((\d+)\s*bytes?\)\]/gi);
      if (fileMatches) {
        for (const match of fileMatches) {
          const nameMatch = match.match(/\[FILE:\s*(.+?)\s*\(/);
          const sizeMatch = match.match(/\((\d+)\s*bytes?\)/);
          if (nameMatch && sizeMatch) {
            attachments.push({
              name: nameMatch[1].trim(),
              url: `/cmd/api/files/download/${nameMatch[1].trim()}`,
              size: parseInt(sizeMatch[1])
            });
          }
        }
      }
      
      res.json({ success: true, reply: result.reply, deptId: id, attachments });
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
  const { task, name, skills } = req.body;
  if (!task || !task.trim()) {
    return res.status(400).json({ error: 'Task description is required' });
  }
  if (task.length > MAX_MESSAGE_LENGTH) {
    return res.status(400).json({ error: `Task description too long (max ${MAX_MESSAGE_LENGTH} chars)` });
  }
  const skillsList = Array.isArray(skills) ? skills.filter(s => typeof s === 'string' && s.trim()) : undefined;
  const result = createSubAgent(req.params.id, task.trim(), name?.trim() || undefined, skillsList);
  res.json({ success: true, ...result });
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
    const result = await chatSubAgent(req.params.id, req.params.subId, message.trim());
    res.json(result);
  } catch (error) {
    console.error('[API] Sub-agent chat error:', error);
    res.status(500).json({ error: 'Sub-agent chat failed' });
  }
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

// ============================================================
// Export API
// ============================================================

/**
 * POST /api/departments/:id/export
 * Generate conversation export as downloadable file
 * Body: { format: 'md'|'html' }
 */
router.post('/departments/:id/export', async (req, res) => {
  try {
    const { id } = req.params;
    if (!validateDeptId(id)) {
      return res.status(400).json({ error: 'Invalid department ID' });
    }

    const { format = 'md' } = req.body;
    if (!['md', 'html'].includes(format)) {
      return res.status(400).json({ error: 'Format must be "md" or "html"' });
    }

    // Get department name
    const configPath = path.join(BASE_PATH, 'departments', 'config.json');
    const config = readJsonFile(configPath) || { departments: {} };
    const deptName = config.departments?.[id]?.name || id;

    // Fetch chat history
    const messages = await getChatHistory(id, 100);
    const timestamp = new Date().toISOString().split('T')[0];

    let content = '';
    let filename = '';
    let contentType = '';

    if (format === 'md') {
      // Generate Markdown
      content = `# ${deptName} Conversation Export\n\n`;
      content += `**Export Date:** ${timestamp}\n\n`;
      content += `---\n\n`;

      for (const msg of messages) {
        const role = msg.role === 'user' ? 'User' : deptName;
        const time = new Date(msg.timestamp).toLocaleString();
        content += `### ${role} (${time})\n\n`;
        content += `${msg.text}\n\n`;
        content += `---\n\n`;
      }

      filename = `${id}_export_${timestamp}.md`;
      contentType = 'text/markdown';
    } else if (format === 'html') {
      // Generate HTML
      content = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(deptName)} Conversation Export</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 800px;
      margin: 0 auto;
      padding: 20px;
      background: #f5f5f5;
    }
    .header {
      background: white;
      padding: 20px;
      border-radius: 8px;
      margin-bottom: 20px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .message {
      background: white;
      padding: 15px;
      margin-bottom: 15px;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .message-header {
      font-weight: bold;
      margin-bottom: 10px;
      color: #333;
    }
    .message-time {
      font-size: 0.9em;
      color: #666;
    }
    .message-text {
      line-height: 1.6;
      white-space: pre-wrap;
    }
    .user { border-left: 4px solid #4CAF50; }
    .assistant { border-left: 4px solid #2196F3; }
  </style>
</head>
<body>
  <div class="header">
    <h1>${escapeHtml(deptName)} Conversation Export</h1>
    <p><strong>Export Date:</strong> ${escapeHtml(timestamp)}</p>
  </div>
`;

      for (const msg of messages) {
        const role = msg.role === 'user' ? 'User' : deptName;
        const roleClass = msg.role;
        const time = new Date(msg.timestamp).toLocaleString();

        content += `  <div class="message ${escapeHtml(roleClass)}">
    <div class="message-header">${escapeHtml(role)} <span class="message-time">(${escapeHtml(time)})</span></div>
    <div class="message-text">${escapeHtml(msg.text)}</div>
  </div>
`;
      }

      content += `</body>
</html>`;

      filename = `${id}_export_${timestamp}.html`;
      contentType = 'text/html';
    }

    // Set headers for file download
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(content);

    console.log(`[Export] Generated ${format} export for ${id}: ${filename}`);
  } catch (error) {
    console.error(`[Export] Error in POST /api/departments/${req.params.id}/export:`, error);
    res.status(500).json({ error: 'Failed to generate export' });
  }
});

/**
 * Generate export content as markdown string (reusable helper)
 */
async function generateExportMarkdown(id) {
  const configPath = path.join(BASE_PATH, 'departments', 'config.json');
  const config = readJsonFile(configPath) || { departments: {} };
  const deptName = config.departments?.[id]?.name || id;
  const messages = await getChatHistory(id, 100);
  const timestamp = new Date().toISOString().split('T')[0];

  let content = `# ${deptName} Conversation Export\n\n`;
  content += `**Export Date:** ${timestamp}\n\n---\n\n`;
  for (const msg of messages) {
    const role = msg.role === 'user' ? 'User' : deptName;
    const time = new Date(msg.timestamp).toLocaleString();
    content += `### ${role} (${time})\n\n${msg.text}\n\n---\n\n`;
  }
  return { content, deptName, timestamp };
}

/**
 * POST /api/departments/:id/export/email
 * Generate export and send via email
 */
router.post('/departments/:id/export/email', async (req, res) => {
  try {
    const { id } = req.params;
    if (!validateDeptId(id)) {
      return res.status(400).json({ error: 'Invalid department ID' });
    }

    const { to, subject } = req.body;
    if (!to) {
      return res.status(400).json({ error: 'Recipient email is required' });
    }

    const { content, deptName, timestamp } = await generateExportMarkdown(id);
    const finalSubject = subject || `Chat Export - ${deptName} (${timestamp})`;

    // Forward to internal email endpoint
    const emailRes = await fetch('http://127.0.0.1:5100/api/email/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': req.headers.authorization || '',
      },
      body: JSON.stringify({ to, subject: finalSubject, body: content }),
    });

    const emailData = await emailRes.json();
    if (emailData.success) {
      console.log(`[Export] Emailed export for ${id} to ${to}`);
      res.json({ success: true });
    } else {
      res.status(502).json({ error: emailData.error || 'Failed to send email' });
    }
  } catch (error) {
    console.error(`[Export] Email export error for ${req.params.id}:`, error);
    res.status(500).json({ error: 'Failed to email export' });
  }
});

/**
 * POST /api/departments/:id/export/drive
 * Generate export and upload to Google Drive
 */
router.post('/departments/:id/export/drive', async (req, res) => {
  try {
    const { id } = req.params;
    if (!validateDeptId(id)) {
      return res.status(400).json({ error: 'Invalid department ID' });
    }

    const { filename: customFilename } = req.body;
    const { content, timestamp } = await generateExportMarkdown(id);
    const filename = customFilename || `chat-export-${id}-${timestamp}.md`;

    // Forward to internal drive upload endpoint
    const driveRes = await fetch('http://127.0.0.1:5100/api/drive/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': req.headers.authorization || '',
      },
      body: JSON.stringify({ filename, content, mimeType: 'text/markdown' }),
    });

    const driveData = await driveRes.json();
    if (driveData.success) {
      console.log(`[Export] Uploaded export for ${id} to Drive: ${driveData.fileId}`);
      res.json({ success: true, fileId: driveData.fileId, webViewLink: driveData.webViewLink });
    } else {
      res.status(502).json({ error: driveData.error || 'Failed to upload to Drive' });
    }
  } catch (error) {
    console.error(`[Export] Drive export error for ${req.params.id}:`, error);
    res.status(500).json({ error: 'Failed to upload export to Drive' });
  }
});

// ============================================================
// Department CRUD API
// ============================================================

/**
 * POST /api/departments
 * Create a new department
 * Body: { id, name, agent, icon, color, hue, telegramTopicId, order }
 */
router.post('/departments', (req, res) => {
  try {
    const { id, name, agent, icon, color, hue, telegramTopicId, order, skills, apiGroups } = req.body;

    if (!id || !VALID_DEPT_ID.test(id)) {
      return res.status(400).json({ success: false, error: 'Invalid department ID' });
    }
    if (!name) {
      return res.status(400).json({ success: false, error: 'Name is required' });
    }

    const deptBaseDir = path.join(BASE_PATH, 'departments');
    const configPath = path.join(deptBaseDir, 'config.json');

    // Ensure departments directory exists (fresh installs won't have it)
    if (!fs.existsSync(deptBaseDir)) {
      fs.mkdirSync(deptBaseDir, { recursive: true });
    }

    const config = readJsonFile(configPath) || { departments: {} };

    if (config.departments[id]) {
      return res.status(409).json({ success: false, error: 'Department already exists' });
    }

    config.departments[id] = {
      name,
      agent: agent || name,
      icon: icon || 'bolt',
      color: color || '#94a3b8',
      hue: hue ?? 200,
      order: order ?? Object.keys(config.departments).length,
      ...(telegramTopicId !== undefined ? { telegramTopicId } : {}),
      ...(Array.isArray(skills) ? { skills } : {}),
      ...(Array.isArray(apiGroups) ? { apiGroups } : {}),
    };

    safeWriteFileSync(configPath, JSON.stringify(config, null, 2));

    // Create department directory structure
    const deptDir = path.join(BASE_PATH, 'departments', id);
    if (!fs.existsSync(deptDir)) fs.mkdirSync(deptDir, { recursive: true });
    const memDir = path.join(deptDir, 'memory');
    if (!fs.existsSync(memDir)) fs.mkdirSync(memDir, { recursive: true });

    // Rebuild layout with new department
    try {
      generateAndSave();
      console.log(`[Layout] Auto-rebuilt after creating department: ${id}`);
    } catch (layoutError) {
      console.error('[Layout] Auto-rebuild failed:', layoutError);
    }

    res.json({ success: true, department: { id, ...config.departments[id] } });
  } catch (error) {
    console.error('Error in POST /api/departments:', error);
    res.status(500).json({ success: false, error: 'Failed to create department' });
  }
});

/**
 * PUT /api/departments/:id
 * Update an existing department
 * Body: { name, agent, icon, color, hue, telegramTopicId, order }
 */
router.put('/departments/:id', (req, res) => {
  try {
    const { id } = req.params;

    if (!validateDeptId(id)) {
      return res.status(400).json({ success: false, error: 'Invalid department ID' });
    }

    const configPath = path.join(BASE_PATH, 'departments', 'config.json');
    const config = readJsonFile(configPath) || { departments: {} };

    if (!config.departments[id]) {
      return res.status(404).json({ success: false, error: 'Department not found' });
    }

    const { name, agent, icon, color, hue, telegramTopicId, order, skills, apiGroups } = req.body;

    if (name !== undefined) config.departments[id].name = name;
    if (agent !== undefined) config.departments[id].agent = agent;
    if (icon !== undefined) config.departments[id].icon = icon;
    if (color !== undefined) config.departments[id].color = color;
    if (hue !== undefined) config.departments[id].hue = hue;
    if (telegramTopicId !== undefined) config.departments[id].telegramTopicId = telegramTopicId;
    if (order !== undefined) config.departments[id].order = order;
    if (Array.isArray(skills)) config.departments[id].skills = skills;
    if (Array.isArray(apiGroups)) config.departments[id].apiGroups = apiGroups;

    safeWriteFileSync(configPath, JSON.stringify(config, null, 2));

    // Rebuild layout if hue or order changed (affects visual layout)
    if (hue !== undefined || order !== undefined) {
      try {
        generateAndSave();
        console.log(`[Layout] Auto-rebuilt after updating department: ${id}`);
      } catch (layoutError) {
        console.error('[Layout] Auto-rebuild failed:', layoutError);
      }
    }

    res.json({ success: true, department: { id, ...config.departments[id] } });
  } catch (error) {
    console.error(`Error in PUT /api/departments/${req.params.id}:`, error);
    res.status(500).json({ success: false, error: 'Failed to update department' });
  }
});

/**
 * DELETE /api/departments/:id
 * Delete a department
 */
router.delete('/departments/:id', (req, res) => {
  try {
    const { id } = req.params;

    if (!validateDeptId(id)) {
      return res.status(400).json({ success: false, error: 'Invalid department ID' });
    }

    const configPath = path.join(BASE_PATH, 'departments', 'config.json');
    const config = readJsonFile(configPath) || { departments: {} };

    if (!config.departments[id]) {
      return res.status(404).json({ success: false, error: 'Department not found' });
    }

    delete config.departments[id];
    safeWriteFileSync(configPath, JSON.stringify(config, null, 2));

    // Rebuild layout after department deletion
    try {
      generateAndSave();
      console.log(`[Layout] Auto-rebuilt after deleting department: ${id}`);
    } catch (layoutError) {
      console.error('[Layout] Auto-rebuild failed:', layoutError);
    }

    res.json({ success: true });
  } catch (error) {
    console.error(`Error in DELETE /api/departments/${req.params.id}:`, error);
    res.status(500).json({ success: false, error: 'Failed to delete department' });
  }
});

// ============================================================
// Layout Generation API
// ============================================================

/**
 * POST /api/layout/rebuild
 * Regenerate the office layout based on current department configuration
 */
router.post('/layout/rebuild', async (req, res) => {
  try {
    console.log('[Layout] Rebuild requested');
    const result = generateAndSave();
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('[Layout] Rebuild failed:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
