import express from 'express';
import { randomUUID } from 'crypto';
import { chat } from '../agent.js';
import { hasDriveAuth, getDriveClient, getOrCreateBackupFolder, getDriveConfig } from './drive.js';
import { notify } from './notifications.js';
import { Readable } from 'stream';

const router = express.Router();

// Active meetings store
const meetings = new Map();

/**
 * POST /api/meetings
 * Create a new meeting with selected departments
 * Body: { topic: string, deptIds: string[], initiatorDeptId: string }
 */
router.post('/', async (req, res) => {
  const { topic, deptIds, initiatorDeptId } = req.body;
  if (!topic || !Array.isArray(deptIds) || deptIds.length < 2) {
    return res.status(400).json({ error: 'topic and at least 2 deptIds required' });
  }

  const meetingId = 'mtg_' + randomUUID().replace(/-/g, '').substring(0, 12);
  const meeting = {
    id: meetingId,
    topic,
    deptIds,
    initiatorDeptId: initiatorDeptId || deptIds[0],
    messages: [],
    status: 'active',
    createdAt: Date.now(),
  };
  meetings.set(meetingId, meeting);

  console.log(`[Meetings] Created ${meetingId}: ${topic} with ${deptIds.join(', ')}`);

  // Broadcast meeting:start event to WebSocket clients
  try {
    const wss = req.app.locals.wss;
    if (wss) {
      const msg = JSON.stringify({
        event: 'meeting:start',
        data: {
          meetingId: meeting.id,
          topic: meeting.topic,
          deptIds: meeting.deptIds
        },
        timestamp: new Date().toISOString()
      });
      let sent = 0;
      wss.clients.forEach(c => {
        if (c.readyState === 1) {
          try { c.send(msg); sent++; } catch {}
        }
      });
      console.log(`[Meetings] Broadcast meeting:start to ${sent} WS clients (total: ${wss.clients.size})`);
    } else {
      console.log('[Meetings] No wss available for broadcast');
    }
  } catch (err) {
    console.error('[Meetings] WS broadcast error:', err.message);
  }

  res.json({ success: true, meetingId, meeting });
});

/**
 * GET /api/meetings
 * List active meetings
 */
router.get('/', (req, res) => {
  const list = [...meetings.values()]
    .filter(m => m.status === 'active')
    .map(m => ({
      id: m.id,
      topic: m.topic,
      deptIds: m.deptIds,
      messageCount: m.messages.length,
      createdAt: m.createdAt
    }));
  res.json({ meetings: list });
});

/**
 * GET /api/meetings/:id
 * Get meeting details with message history
 */
router.get('/:id', (req, res) => {
  const meeting = meetings.get(req.params.id);
  if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
  res.json({ success: true, meeting });
});

/**
 * POST /api/meetings/:id/message
 * Send a message to the meeting — broadcasts to ALL departments in the meeting
 * Body: { message: string, fromDeptId?: string }
 *
 * If fromDeptId is provided, the message is sent as context to all OTHER departments.
 * Each department gets the meeting context + conversation history and generates a response.
 * This creates REAL cross-department interaction.
 */
router.post('/:id/message', async (req, res) => {
  const meeting = meetings.get(req.params.id);
  if (!meeting) return res.status(404).json({ error: 'Meeting not found' });

  const { message, fromDeptId } = req.body;
  if (!message) return res.status(400).json({ error: 'message required' });

  // Record user/initiator message
  meeting.messages.push({
    role: fromDeptId ? 'dept' : 'user',
    deptId: fromDeptId || 'user',
    text: message,
    timestamp: Date.now(),
  });

  // Send to all departments in meeting (real Gateway calls)
  const targetDepts = fromDeptId
    ? meeting.deptIds.filter(id => id !== fromDeptId)
    : meeting.deptIds;

  const results = [];

  // Sequential: each dept sees previous depts' responses (real discussion)
  for (const deptId of targetDepts) {
    // Rebuild context each iteration so new responses are visible
    const recentHistory = meeting.messages.slice(-20).map(m => {
      const sender = m.deptId === 'user' ? '用户' : m.deptId;
      return `[${sender}]: ${m.text}`;
    }).join('\n');

    const meetingPrompt = `[会议模式] 主题: ${meeting.topic}
参会部门: ${meeting.deptIds.join(', ')}

最近对话:
${recentHistory}

你是 ${deptId} 部门。请根据你的部门专长，回应会议中的讨论。注意其他部门已经发表的观点，不要重复，提出你的独特视角。简洁回答，不超过200字。`;

    try {
      const result = await chat(deptId, meetingPrompt);
      const reply = result.success ? result.reply : `[Error] ${result.error}`;

      // Record department response — next dept will see this
      meeting.messages.push({
        role: 'dept',
        deptId,
        text: reply,
        timestamp: Date.now(),
      });

      results.push({ deptId, reply, success: result.success });
    } catch (err) {
      results.push({ deptId, reply: `[Error] ${err.message}`, success: false });
    }
  }

  // Broadcast meeting update to WebSocket clients
  try {
    const wss = req.app.locals.wss;
    if (wss) {
      const payload = JSON.stringify({
        event: 'meeting:update',
        data: { meetingId: meeting.id, messages: meeting.messages.slice(-10), results },
        timestamp: new Date().toISOString(),
      });
      wss.clients.forEach(c => {
        if (c.readyState === 1 && c._authenticated) {
          try { c.send(payload); } catch {}
        }
      });
    }
  } catch (err) {
    console.error('[Meetings] Broadcast error:', err.message);
  }

  res.json({ success: true, results, messageCount: meeting.messages.length });
});

/**
 * Helper: Generate markdown meeting minutes
 */
function generateMeetingMinutes(meeting) {
  const startTime = new Date(meeting.createdAt);
  const endTime = new Date(meeting.endedAt || Date.now());
  const duration = Math.round((endTime.getTime() - startTime.getTime()) / 1000 / 60);

  let markdown = `# 会议纪要: ${meeting.topic}\n\n`;
  markdown += `**时间**: ${startTime.toLocaleString('zh-CN', { hour12: false })} - ${endTime.toLocaleString('zh-CN', { hour12: false, timeStyle: 'short' })}\n`;
  markdown += `**时长**: ${duration} 分钟\n`;
  markdown += `**参会部门**: ${meeting.deptIds.join(', ')}\n`;
  markdown += `**发起部门**: ${meeting.initiatorDeptId}\n\n`;
  markdown += `---\n\n## 会议记录\n\n`;

  // Chronological messages with sender and timestamp
  meeting.messages.forEach((msg, i) => {
    const time = new Date(msg.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
    const sender = msg.deptId === 'user' ? '用户' : msg.deptId;
    markdown += `### ${i + 1}. [${time}] ${sender}\n\n`;
    markdown += `${msg.text}\n\n`;
  });

  markdown += `---\n\n`;
  markdown += `**会议ID**: ${meeting.id}\n`;
  markdown += `**生成时间**: ${new Date().toLocaleString('zh-CN', { hour12: false })}\n`;

  return markdown;
}

/**
 * POST /api/meetings/:id/end
 * End a meeting and optionally export to Google Drive
 */
router.post('/:id/end', async (req, res) => {
  const meeting = meetings.get(req.params.id);
  if (!meeting) return res.status(404).json({ error: 'Meeting not found' });

  meeting.status = 'ended';
  meeting.endedAt = Date.now();
  console.log(`[Meetings] Ended ${meeting.id}: ${meeting.topic}`);

  // Broadcast meeting:end event to WebSocket clients
  try {
    const wss = req.app.locals.wss;
    if (wss) {
      const msg = JSON.stringify({
        event: 'meeting:end',
        data: {
          meetingId: meeting.id,
          deptIds: meeting.deptIds
        },
        timestamp: new Date().toISOString()
      });
      wss.clients.forEach(c => {
        if (c.readyState === 1) {
          try { c.send(msg); } catch {}
        }
      });
    }
  } catch (err) {
    console.error('[Meetings] WS broadcast error:', err.message);
  }

  let driveResult = null;

  // Try to export to Google Drive if auth is available
  if (hasDriveAuth()) {
    try {
      const driveConfig = getDriveConfig();
      const drive = getDriveClient(driveConfig);
      const folderId = await getOrCreateBackupFolder(drive, driveConfig);

      // Generate meeting minutes
      const markdown = generateMeetingMinutes(meeting);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
      const filename = `会议纪要_${meeting.topic.substring(0, 20)}_${timestamp}.md`;

      // Upload to Drive
      const buffer = Buffer.from(markdown, 'utf8');
      const fileMetadata = {
        name: filename,
        parents: [folderId]
      };
      const media = {
        mimeType: 'text/markdown',
        body: Readable.from(buffer)
      };

      const file = await drive.files.create({
        resource: fileMetadata,
        media: media,
        fields: 'id, name, webViewLink'
      });

      driveResult = {
        fileId: file.data.id,
        fileName: file.data.name,
        webViewLink: file.data.webViewLink
      };

      console.log(`[Meetings] Exported to Drive: ${filename} (${file.data.id})`);

      // Send notification
      notify({
        severity: 'info',
        category: 'meeting',
        title: '会议纪要已导出',
        body: `会议 "${meeting.topic}" 的纪要已自动导出到 Google Drive`,
        actionUrl: file.data.webViewLink
      });
    } catch (error) {
      console.error('[Meetings] Drive export failed (non-fatal):', error.message);
      // Non-fatal: meeting still ends successfully
    }
  }

  res.json({ success: true, driveResult });
});

export default router;
