import express from 'express';
import fs from 'fs';
import path from 'path';
import { chat, chatAsync, getChatHistory } from '../agent.js';
import { BASE_PATH, readJsonFile, safeWriteFileSync, validateDepartmentId } from '../utils.js';
import { createLogger } from '../logger.js';
import { safeBroadcast } from '../broadcast.js';

const log = createLogger('Chat');
const router = express.Router();

const MAX_MESSAGE_LENGTH = 10000;

function validateDeptId(id) {
  return validateDepartmentId(id);
}

// In-memory rate limiter for history endpoint: max 10 requests per minute per IP
const historyRateLimits = new Map(); // Map<IP, { count: number, resetAt: number }>
setInterval(() => {
  const now = Date.now();
  for (const [ip, data] of historyRateLimits) {
    if (now >= data.resetAt) historyRateLimits.delete(ip);
  }
}, 60000); // Cleanup every minute

function checkHistoryRateLimit(ip) {
  const now = Date.now();
  const limit = historyRateLimits.get(ip);

  if (!limit || now >= limit.resetAt) {
    // Start new window
    historyRateLimits.set(ip, { count: 1, resetAt: now + 60000 });
    return true;
  }

  if (limit.count >= 10) {
    return false; // Rate limit exceeded
  }

  limit.count++;
  return true;
}

// Message sequence counter for ordering (monotonically increasing)
let messageSequence = 0;

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

    // Rate limit: max 10 requests per minute per IP
    if (!checkHistoryRateLimit(req.ip)) {
      return res.status(429).json({ error: 'Too many history requests, please slow down' });
    }

    const limit = Math.min(parseInt(req.query.limit) || 30, 100);
    const result = await getChatHistory(id, limit);
    if (!result.success) {
      return res.status(503).json({ error: result.error || 'Failed to fetch chat history' });
    }

    // Ensure messages are sorted by timestamp (ascending order)
    const sortedMessages = result.messages.sort((a, b) => {
      const tsA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const tsB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return tsA - tsB;
    });

    res.json({ success: true, messages: sortedMessages, deptId: id });
  } catch (error) {
    log.error(`Error in GET /api/departments/${req.params.id}/history: ` + error.message);
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
    log.info(`trace=${req.traceId || ''} ${id} <- ${msgText.substring(0, 60)}${imgCount ? ` [+${imgCount} images]` : ''}${docCount ? ` [+${docCount} docs]` : ''}`);

    // Cross-department: broadcast visit event + create request file
    if (sourceDept && sourceDept !== id && validateDeptId(sourceDept)) {
      const wss = req.app.locals.wss;
      if (wss) {
        safeBroadcast(wss, {
          event: 'dept:visit',
          data: { from: sourceDept, to: id, message: msgText.substring(0, 100) },
          timestamp: new Date().toISOString()
        });
      }

      // Send push notification for cross-dept message
      import('./push.js').then(({ sendPush }) => {
        sendPush({
          title: '跨部门消息',
          body: `来自 ${sourceDept}: ${msgText.slice(0, 100)}`,
          category: 'mention'
        }).catch(() => {});
      }).catch(() => {});

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
        safeWriteFileSync(path.join(requestsDir, filename), content);
      } catch (err) {
        log.error('Failed to write request file: ' + err.message);
      }
    }

    // Async mode: fire-and-forget, return immediately
    if (isAsync) {
      const result = chatAsync(id, msgText, { traceId: req.traceId });
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

    const result = await chat(id, enhancedMessage, images, { traceId: req.traceId });

    if (result.success) {
      log.info(`trace=${req.traceId || ''} ${id} -> ${result.reply.substring(0, 60)}`);

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

      // Add sequence number and timestamp for message ordering
      const seq = ++messageSequence;
      const timestamp = Date.now();
      res.json({
        success: true,
        reply: result.reply,
        deptId: id,
        attachments,
        sequence: seq,
        timestamp
      });
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
    log.error(`Error in POST /api/departments/${req.params.id}/chat: ` + error.message);
    res.status(500).json({ error: 'Chat failed' });
  }
});

export default router;
