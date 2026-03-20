import express from 'express';
import { randomUUID } from 'crypto';
import { chat, sanitizeContextTags } from '../agent.js';
import { hasDriveAuth, getDriveClient, getOrCreateBackupFolder, getDriveConfig } from './drive.js';
import { notify } from './notifications.js';
import { Readable } from 'stream';
import fs from 'fs';
import path from 'path';
import { safeWriteFileSync, BASE_PATH } from '../utils.js';
import { withMutex } from '../file-lock.js';
import { recordAudit } from './audit.js';

const router = express.Router();

// Active meetings store
const meetings = new Map();

// Constants
const MAX_ACTIVE_MEETINGS = 10;
const MAX_MESSAGES_PER_MEETING = 50;
const DEPT_RESPONSE_TIMEOUT = 180000; // 3 minutes
const NEGOTIATION_TIMEOUT = 600000; // 10 minutes

// Ensure meetings directory exists
const MEETINGS_DIR = path.join(BASE_PATH, 'departments', 'meetings');
if (!fs.existsSync(MEETINGS_DIR)) {
  fs.mkdirSync(MEETINGS_DIR, { recursive: true });
}

// Load meetings from disk on startup
function loadMeetingsFromDisk() {
  const dir = path.join(BASE_PATH, 'departments', 'meetings');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    return;
  }
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      if (data.id && data.status === 'active') {
        meetings.set(data.id, data);
      }
    } catch (err) {
      console.warn(`[Meetings] Failed to parse ${file}:`, err.message);
    }
  }
  console.log(`[Meetings] Loaded ${meetings.size} active meetings from disk`);
}
loadMeetingsFromDisk();

// Persist meeting to disk
function persistMeeting(meeting) {
  const dir = path.join(BASE_PATH, 'departments', 'meetings');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  safeWriteFileSync(path.join(dir, `${meeting.id}.json`), JSON.stringify(meeting, null, 2));
}

/**
 * POST /api/meetings
 * Create a new meeting with selected departments
 * Body: { topic: string, deptIds: string[], initiatorDeptId: string }
 */
router.post('/', async (req, res) => {
  const { topic, deptIds, initiatorDeptId } = req.body;
  if (!topic || typeof topic !== 'string' || !Array.isArray(deptIds) || deptIds.length < 2) {
    return res.status(400).json({ error: 'topic and at least 2 deptIds required' });
  }
  if (topic.length > 500) {
    return res.status(400).json({ error: 'topic must be 500 characters or less' });
  }
  if (deptIds.length > 20 || !deptIds.every(id => typeof id === 'string' && id.length <= 50)) {
    return res.status(400).json({ error: 'invalid deptIds' });
  }

  // P0 Fix #1: Unbounded meeting creation - enforce limit
  const activeMeetingsCount = [...meetings.values()].filter(m => m.status === 'active').length;
  if (activeMeetingsCount >= MAX_ACTIVE_MEETINGS) {
    return res.status(429).json({
      error: 'Maximum active meetings limit reached',
      limit: MAX_ACTIVE_MEETINGS,
      active: activeMeetingsCount
    });
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
  persistMeeting(meeting);

  console.log(`[Meetings] Created ${meetingId}: ${topic} with ${deptIds.join(', ')}`);
  recordAudit({ action: 'meeting:create', target: meetingId, details: { topic, deptIds }, ip: req.ip });

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
        if (c.readyState === 1 && c._authenticated) {
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
 *
 * Returns immediately with a roundId, then streams department responses via WebSocket.
 */
router.post('/:id/message', async (req, res) => {
  const meeting = meetings.get(req.params.id);
  if (!meeting) return res.status(404).json({ error: 'Meeting not found' });

  // P0 Fix #6: Reject messages to ended meetings
  if (meeting.status !== 'active') {
    return res.status(400).json({ error: 'Cannot send message to ended meeting' });
  }

  const { message, fromDeptId } = req.body;
  if (!message) return res.status(400).json({ error: 'message required' });

  const roundId = randomUUID();

  // Record user/initiator message
  meeting.messages.push({
    role: fromDeptId ? 'dept' : 'user',
    deptId: fromDeptId || 'user',
    text: message,
    timestamp: Date.now(),
  });

  // P0 Fix #2: Cap messages array to most recent 50
  if (meeting.messages.length > MAX_MESSAGES_PER_MEETING) {
    meeting.messages = meeting.messages.slice(-MAX_MESSAGES_PER_MEETING);
  }

  persistMeeting(meeting);

  // Send to all departments in meeting (real Gateway calls)
  const targetDepts = fromDeptId
    ? meeting.deptIds.filter(id => id !== fromDeptId)
    : meeting.deptIds;

  // Return immediately - processing happens in background
  res.json({ status: 'accepted', roundId, targetDepts: targetDepts.length });

  // Process departments in background
  const wss = req.app.locals.wss;
  setImmediate(async () => {
    try { await withMutex(`meeting:${meeting.id}`, async () => {
      const results = [];

      // Sequential: each dept sees previous depts' responses (real discussion)
      for (let deptIndex = 0; deptIndex < targetDepts.length; deptIndex++) {
      const deptId = targetDepts[deptIndex];

      // Rebuild context each iteration so new responses are visible
      const recentHistory = meeting.messages.slice(-20).map(m => {
        const sender = m.deptId === 'user' ? '用户' : m.deptId;
        return `[${sender}]: ${m.text}`;
      }).join('\n');

      const safeTopic = sanitizeContextTags(meeting.topic);
      const meetingPrompt = `[会议模式] 主题: <user_topic>${safeTopic}</user_topic>
参会部门: ${meeting.deptIds.join(', ')}

最近对话:
${recentHistory}

你是 ${deptId} 部门。请根据你的部门专长，回应会议中的讨论。注意其他部门已经发表的观点，不要重复，提出你的独特视角。简洁回答，不超过200字。`;

      try {
        // P0 Fix #3: Add timeout for department response
        const result = await Promise.race([
          chat(deptId, meetingPrompt),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Department response timeout')), DEPT_RESPONSE_TIMEOUT)
          )
        ]);
        const reply = result.success ? result.reply : `[Error] ${result.error}`;

        // Record department response — next dept will see this
        meeting.messages.push({
          role: 'dept',
          deptId,
          text: reply,
          timestamp: Date.now(),
        });

        // P0 Fix #2: Cap messages array after adding
        if (meeting.messages.length > MAX_MESSAGES_PER_MEETING) {
          meeting.messages = meeting.messages.slice(-MAX_MESSAGES_PER_MEETING);
        }

        // P0 Fix #5: Move persistMeeting inside withMutex
        persistMeeting(meeting);

        results.push({ deptId, reply, success: result.success });

        // Broadcast department response immediately via WebSocket
        if (wss) {
          const deptMsg = JSON.stringify({
            event: 'meeting:dept-response',
            data: {
              meetingId: meeting.id,
              deptId,
              text: reply,
              roundId,
              deptIndex,
              totalDepts: targetDepts.length,
              timestamp: Date.now(),
            },
          });
          wss.clients.forEach(c => {
            if (c.readyState === 1 && c._authenticated) {
              try { c.send(deptMsg); } catch {}
            }
          });
        }
      } catch (err) {
        // P0 Fix #3: Handle timeout error specifically
        const isTimeout = err.message.includes('timeout');
        const errorReply = isTimeout
          ? `[Timeout] ${deptId} did not respond within 3 minutes`
          : `[Error] ${err.message}`;

        console.log(`[Meetings] Department ${deptId} ${isTimeout ? 'timed out' : 'error'}: ${err.message}`);

        // Record error in messages
        meeting.messages.push({
          role: 'dept',
          deptId,
          text: errorReply,
          timestamp: Date.now(),
        });

        // P0 Fix #2: Cap messages array after adding
        if (meeting.messages.length > MAX_MESSAGES_PER_MEETING) {
          meeting.messages = meeting.messages.slice(-MAX_MESSAGES_PER_MEETING);
        }

        // P0 Fix #5: Move persistMeeting inside withMutex
        persistMeeting(meeting);

        results.push({ deptId, reply: errorReply, success: false });

        // Broadcast error via WebSocket
        if (wss) {
          const deptMsg = JSON.stringify({
            event: 'meeting:dept-response',
            data: {
              meetingId: meeting.id,
              deptId,
              text: errorReply,
              roundId,
              deptIndex,
              totalDepts: targetDepts.length,
              timestamp: Date.now(),
              timeout: isTimeout
            },
          });
          wss.clients.forEach(c => {
            if (c.readyState === 1 && c._authenticated) {
              try { c.send(deptMsg); } catch {}
            }
          });
        }
      }
    }

    // Broadcast round complete
    if (wss) {
      const completeMsg = JSON.stringify({
        event: 'meeting:round-complete',
        data: {
          meetingId: meeting.id,
          roundId,
          messageCount: meeting.messages.length,
          results,
        },
        timestamp: new Date().toISOString(),
      });
      wss.clients.forEach(c => {
        if (c.readyState === 1 && c._authenticated) {
          try { c.send(completeMsg); } catch {}
        }
      });
    }
    });
    } catch (err) { console.error('[Meetings] Message round error:', err); }
  });
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
  persistMeeting(meeting);
  console.log(`[Meetings] Ended ${meeting.id}: ${meeting.topic}`);

  recordAudit({ action: 'meeting:end', target: meeting.id, details: { topic: meeting.topic }, ip: req.ip });

  // P0 Fix #4: Await action item extraction BEFORE scheduling deletion
  const wss = req.app.locals.wss;
  try {
    await extractActionItems(meeting, wss);
  } catch (err) {
    console.error('[Meetings] Action item extraction failed:', err.message);
  }

  // Schedule removal from memory (data is persisted to disk)
  setTimeout(() => meetings.delete(meeting.id), 5 * 60 * 1000);

  // Broadcast meeting:end event to WebSocket clients
  try {
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
        if (c.readyState === 1 && c._authenticated) {
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

/**
 * Extract action items from meeting transcript using AI
 */
async function extractActionItems(meeting, wss) {
  if (meeting.messages.length < 3) return; // Too short

  // Build transcript
  const transcript = meeting.messages.map(m => {
    const sender = m.deptId === 'user' ? 'User' : m.deptId;
    return `[${sender}]: ${m.text}`;
  }).join('\n');

  const safeTopic = sanitizeContextTags(meeting.topic);
  const prompt = `Analyze this meeting transcript and extract action items.

Meeting topic: <user_topic>${safeTopic}</user_topic>
Departments: ${meeting.deptIds.join(', ')}

Transcript:
${transcript.substring(0, 8000)}

Respond with ONLY a JSON array of action items:
[{"task": "description", "owner": "department_id", "priority": "high/medium/low", "deadline_hint": "suggested timeframe"}]

Extract 3-8 action items. Use actual department IDs from the transcript. Be specific and actionable.`;

  try {
    // Use the first department to extract (or a specific dept if available)
    const extractorDept = meeting.deptIds[0];
    const result = await chat(extractorDept, prompt);

    if (result.success && result.reply) {
      const jsonMatch = result.reply.match(/\[[\s\S]*?\]/);
      if (jsonMatch) {
        const actionItems = JSON.parse(jsonMatch[0]);
        if (!Array.isArray(actionItems)) throw new Error('Expected JSON array');
        meeting.actionItems = actionItems;

        // Record in meeting messages (null-safe field access)
        meeting.messages.push({
          role: 'system', deptId: 'action-items',
          text: `[Action Items Extracted]\n${actionItems.map((item, i) =>
            `${i+1}. [${(item.priority || 'medium').toUpperCase()}] ${item.task || '(no task)'} (Owner: ${item.owner || 'unassigned'}${item.deadline_hint ? ', ' + item.deadline_hint : ''})`
          ).join('\n')}`,
          timestamp: Date.now()
        });

        persistMeeting(meeting);

        // Broadcast to UI
        const msg = JSON.stringify({
          event: 'meeting:action-items',
          data: { meetingId: meeting.id, actionItems },
          timestamp: new Date().toISOString()
        });
        if (wss) wss.clients.forEach(c => {
          if (c.readyState === 1 && c._authenticated) {
            try { c.send(msg); } catch {}
          }
        });

        console.log(`[Meetings] Extracted ${actionItems.length} action items for ${meeting.id}`);
      }
    }
  } catch (err) {
    console.error('[Meetings] Action item extraction error:', err.message);
  }
}

/**
 * GET /api/meetings/:id/action-items
 * Get action items for a meeting
 */
router.get('/:id/action-items', (req, res) => {
  const meeting = meetings.get(req.params.id);
  if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
  res.json({ actionItems: meeting.actionItems || [], meetingId: meeting.id });
});

/**
 * POST /api/meetings/:id/negotiate
 * Start negotiation mode - departments debate, vote, and reach consensus
 */
router.post('/:id/negotiate', async (req, res) => {
  const { id } = req.params;
  const { proposal, maxRounds = 3 } = req.body;
  const meeting = meetings.get(id);
  if (!meeting || meeting.status !== 'active') {
    return res.status(404).json({ error: 'Meeting not found or not active' });
  }

  // Validate
  if (!proposal || typeof proposal !== 'string' || proposal.length > 5000) {
    return res.status(400).json({ error: 'Invalid proposal' });
  }

  const roundsCapped = Math.min(Math.max(1, maxRounds), 5);

  // Return immediately, process in background
  const negotiationId = `neg_${Date.now().toString(36)}`;
  res.json({ status: 'accepted', negotiationId, maxRounds: roundsCapped });

  // Run negotiation rounds in background
  // P0 Fix #8: Add 10-minute total timeout for entire negotiation
  Promise.resolve(withMutex(`meeting:${meeting.id}`, async () => {
    try {
      await Promise.race([
        runNegotiation(meeting, proposal, roundsCapped, negotiationId, req.app.locals.wss),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Negotiation timeout')), NEGOTIATION_TIMEOUT)
        )
      ]);
    } catch (err) {
      if (err.message.includes('timeout')) {
        console.error('[Meetings] Negotiation timed out after 10 minutes');
        meeting.messages.push({
          role: 'system', deptId: 'negotiation',
          text: '[Negotiation Timeout] Process exceeded 10 minutes and was terminated',
          timestamp: Date.now(), negotiationId
        });
        persistMeeting(meeting);

        broadcastToMeeting(req.app.locals.wss, meeting.id, 'meeting:negotiation-end', {
          meetingId: meeting.id, negotiationId, result: 'timeout',
          reason: 'Exceeded 10 minute limit'
        });
      } else {
        throw err;
      }
    }
  })).catch(err => console.error('[Meetings] Negotiation error:', err));
});

/**
 * Run negotiation rounds: each dept evaluates proposal and votes
 */
async function runNegotiation(meeting, proposal, maxRounds, negotiationId, wss) {
  const targetDepts = meeting.deptIds;
  let currentProposal = sanitizeContextTags(proposal);
  let round = 0;
  const positions = {}; // { deptId: { stance: 'agree'|'disagree'|'modify', reason, suggestion } }

  // Record proposal in meeting messages
  meeting.messages.push({
    role: 'system', deptId: 'negotiation',
    text: `[Negotiation Started] Proposal: ${proposal}`,
    timestamp: Date.now(), negotiationId
  });
  persistMeeting(meeting);

  // Broadcast negotiation start
  broadcastToMeeting(wss, meeting.id, 'meeting:negotiation-start', {
    meetingId: meeting.id, negotiationId, proposal, maxRounds, deptIds: targetDepts
  });

  while (round < maxRounds) {
    round++;
    const roundPositions = {};

    // Each department evaluates the proposal
    for (const deptId of targetDepts) {
      const prompt = round === 1
        ? `[Negotiation Mode - Round ${round}/${maxRounds}]
You are evaluating this proposal: "${currentProposal}"

Based on your department's expertise, respond with EXACTLY this JSON format:
{"stance": "agree" or "disagree" or "modify", "reason": "your reasoning in 1-2 sentences", "suggestion": "your counter-proposal or modification if stance is modify/disagree, empty string if agree"}

Be concise. Consider trade-offs from your department's perspective.`
        : `[Negotiation Mode - Round ${round}/${maxRounds}]
Previous positions from other departments:
${Object.entries(positions).map(([d, p]) => `- ${d}: ${p.stance} - ${p.reason}`).join('\n')}

Current proposal: "${currentProposal}"

Based on your department's expertise and considering other departments' positions, respond with EXACTLY this JSON format:
{"stance": "agree" or "disagree" or "modify", "reason": "your reasoning in 1-2 sentences", "suggestion": "your counter-proposal or modification if stance is modify/disagree, empty string if agree"}

Try to find common ground. Be concise.`;

      try {
        const result = await chat(deptId, prompt);
        let parsed;
        if (!result.success || !result.reply) {
          parsed = { stance: 'abstain', reason: result.error || 'No response', suggestion: '' };
        } else {
          try {
            // Try to extract JSON from response
            const jsonMatch = result.reply.match(/\{[\s\S]*?\}/);
            parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { stance: 'abstain', reason: result.reply, suggestion: '' };
          } catch {
            parsed = { stance: 'abstain', reason: result.reply.substring(0, 200), suggestion: '' };
          }
        }

        roundPositions[deptId] = parsed;
        positions[deptId] = parsed;

        // Record in meeting messages (null-safe field access)
        meeting.messages.push({
          role: 'dept', deptId,
          text: `[Round ${round}] ${(parsed.stance || 'abstain').toUpperCase()}: ${parsed.reason || ''}${parsed.suggestion ? '\nSuggestion: ' + parsed.suggestion : ''}`,
          timestamp: Date.now(), negotiationId
        });
        persistMeeting(meeting);

        // Broadcast each dept's position
        broadcastToMeeting(wss, meeting.id, 'meeting:negotiation-vote', {
          meetingId: meeting.id, negotiationId, round, deptId,
          stance: parsed.stance, reason: parsed.reason, suggestion: parsed.suggestion
        });
      } catch (err) {
        roundPositions[deptId] = { stance: 'abstain', reason: 'Error: ' + err.message, suggestion: '' };
      }
    }

    // Check consensus
    const stances = Object.values(roundPositions).map(p => p.stance);
    const agreeCount = stances.filter(s => s === 'agree').length;
    const total = stances.length;

    // Broadcast round summary
    broadcastToMeeting(wss, meeting.id, 'meeting:negotiation-round', {
      meetingId: meeting.id, negotiationId, round, maxRounds,
      positions: roundPositions,
      consensus: agreeCount === total,
      agreeCount, total
    });

    if (agreeCount === total) {
      // Consensus reached!
      meeting.messages.push({
        role: 'system', deptId: 'negotiation',
        text: `[Consensus Reached in Round ${round}] All ${total} departments agree on: ${currentProposal}`,
        timestamp: Date.now(), negotiationId
      });
      persistMeeting(meeting);

      broadcastToMeeting(wss, meeting.id, 'meeting:negotiation-end', {
        meetingId: meeting.id, negotiationId, result: 'consensus', round,
        finalProposal: currentProposal, positions
      });
      return;
    }

    // P0 Fix #7: Randomly select modification to avoid first-dept bias
    if (agreeCount >= total * 0.5) {
      const modifications = Object.values(roundPositions)
        .filter(p => p.stance === 'modify' && p.suggestion)
        .map(p => p.suggestion);
      if (modifications.length > 0) {
        const randomIndex = Math.floor(Math.random() * modifications.length);
        currentProposal = modifications[randomIndex];
      }
    }
  }

  // Max rounds reached without full consensus
  const finalStances = Object.entries(positions);
  const agreeCount = finalStances.filter(([,p]) => p.stance === 'agree').length;
  const result = agreeCount > finalStances.length / 2 ? 'majority' : 'no-consensus';

  meeting.messages.push({
    role: 'system', deptId: 'negotiation',
    text: `[Negotiation Complete - ${result === 'majority' ? 'Majority Agreement' : 'No Consensus'}] After ${maxRounds} rounds: ${agreeCount}/${finalStances.length} agree`,
    timestamp: Date.now(), negotiationId
  });
  persistMeeting(meeting);

  broadcastToMeeting(wss, meeting.id, 'meeting:negotiation-end', {
    meetingId: meeting.id, negotiationId, result, round: maxRounds,
    finalProposal: currentProposal, positions,
    agreeCount, total: finalStances.length
  });
}

/**
 * Broadcast message to all authenticated WebSocket clients
 */
function broadcastToMeeting(wss, meetingId, event, data) {
  if (!wss) return;
  const msg = JSON.stringify({ event, data, timestamp: new Date().toISOString() });
  wss.clients.forEach(c => {
    if (c.readyState === 1 && c._authenticated) {
      try { c.send(msg); } catch {}
    }
  });
}

export default router;
