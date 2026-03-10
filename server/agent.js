import fs from 'fs';
import path from 'path';
import { getGateway } from './gateway.js';
import { recordChat, recordTokens } from './routes/metrics.js';

const BASE_PATH = process.env.OPENCLAW_WORKSPACE || path.join(process.env.OPENCLAW_HOME || path.join(process.env.HOME || '/root', '.openclaw'), 'workspace');

// ---- Config / mappings ----

function loadConfig() {
  try {
    const configPath = path.join(BASE_PATH, 'departments', 'config.json');
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch { return { departments: {} }; }
}

/**
 * Build the Telegram session key for a department.
 * Maps deptId -> `agent:main:telegram:group:{groupId}:topic:{telegramTopicId}`
 * Falls back to `agent:main:{deptId}` if no topic mapping exists.
 */
function getSessionKey(deptId) {
  const config = loadConfig();
  const dept = config.departments?.[deptId];
  if (dept?.telegramTopicId !== undefined) {
    const gid = config.groupId || '';
    return `agent:main:telegram:group:${gid}:topic:${dept.telegramTopicId}`;
  }
  return `agent:main:${deptId}`;
}

// ---- Sub-agent persistence ----

function subAgentsPath(deptId) {
  return path.join(BASE_PATH, 'departments', deptId, 'subagents.json');
}

function loadSubAgents(deptId) {
  const p = subAgentsPath(deptId);
  try {
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    }
  } catch (err) {
    console.error(`[SubAgent] Failed to load ${p}:`, err.message);
  }
  return { count: 0, agents: {} };
}

function saveSubAgents(deptId, data) {
  const p = subAgentsPath(deptId);
  try {
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error(`[SubAgent] Failed to save ${p}:`, err.message);
  }
}

// ---- Chat via OpenClaw Gateway ----

/**
 * Chat with a department agent via OpenClaw Gateway.
 * Uses the same session as the Telegram topic for unified conversation.
 * No context wrapping — OpenClaw handles system prompts natively.
 */
async function chat(deptId, userMessage, images) {
  const gateway = getGateway();

  if (!gateway.isReady) {
    try {
      await gateway.waitForReady(5000);
    } catch {
      return { success: false, error: 'Gateway not connected, please try again later' };
    }
  }

  const sessionKey = getSessionKey(deptId);

  // Build attachments from base64 images
  const attachments = [];
  if (Array.isArray(images)) {
    for (const dataUrl of images) {
      if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image/')) {
        const match = dataUrl.match(/^data:(image\/[^;]+);base64,(.+)$/);
        if (match) {
          attachments.push({ mimeType: match[1], data: match[2] });
        }
      }
    }
  }

  try {
    const startMs = Date.now();
    const result = await gateway.sendAgentMessage(sessionKey, userMessage, attachments);
    const durationMs = Date.now() - startMs;

    // Record metrics
    if (result.text) {
      recordChat(deptId, durationMs, false);
      if (result.usage) {
        recordTokens(deptId, result.usage);
      }
      return { success: true, reply: result.text };
    }

    recordChat(deptId, durationMs, true);
    return { success: false, error: 'Gateway returned empty response' };
  } catch (err) {
    console.error(`[Agent] Chat ${deptId} error:`, err.message);
    recordChat(deptId, 0, true);
    return { success: false, error: err.message };
  }
}

/**
 * Get chat history for a department from OpenClaw Gateway.
 */
async function getChatHistory(deptId, limit = 30) {
  const gateway = getGateway();
  if (!gateway.isReady) return [];

  const sessionKey = getSessionKey(deptId);
  try {
    const messages = await gateway.getChatHistory(sessionKey, limit);
    return messages.map(m => {
      let text = '';
      if (typeof m.content === 'string') {
        text = m.content;
      } else if (Array.isArray(m.content)) {
        text = m.content
          .filter(c => c.type === 'text' && c.text)
          .map(c => c.text)
          .join('\n');
      }
      return {
        role: m.role === 'user' ? 'user' : 'assistant',
        text,
        timestamp: m.timestamp || null,
      };
    }).filter(m => m.text && m.role !== 'toolResult' && m.role !== 'toolCall');
  } catch (err) {
    console.error(`[Agent] History ${deptId} error:`, err.message);
    return [];
  }
}

// ---- Bulletin ----

function loadBulletin() {
  const bPath = path.join(BASE_PATH, 'departments', 'bulletin', 'board.md');
  try { return fs.existsSync(bPath) ? fs.readFileSync(bPath, 'utf8') : ''; } catch { return ''; }
}

function saveBulletin(content) {
  const bPath = path.join(BASE_PATH, 'departments', 'bulletin', 'board.md');
  try { fs.writeFileSync(bPath, content, 'utf8'); return true; } catch { return false; }
}

// ---- Memory ----

function loadMemory(deptId) {
  const memPath = path.join(BASE_PATH, 'departments', deptId, 'memory', 'MEMORY.md');
  try { return fs.existsSync(memPath) ? fs.readFileSync(memPath, 'utf8') : ''; } catch { return ''; }
}

function saveMemory(deptId, content) {
  const memPath = path.join(BASE_PATH, 'departments', deptId, 'memory', 'MEMORY.md');
  try {
    // Create backup before overwriting
    if (fs.existsSync(memPath)) {
      const existing = fs.readFileSync(memPath, 'utf8');
      if (existing.trim()) {
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const bakPath = path.join(BASE_PATH, 'departments', deptId, 'memory', `MEMORY.${ts}.md.bak`);
        fs.writeFileSync(bakPath, existing, 'utf8');
      }
    }
    fs.writeFileSync(memPath, content, 'utf8');
    return true;
  } catch { return false; }
}

function clearHistory(deptId) {
  console.log(`[Agent] History clear requested for ${deptId} (managed by gateway)`);
}

// ---- Broadcast ----

async function broadcastCommand(command) {
  const config = loadConfig();
  const gateway = getGateway();
  if (!gateway.isReady) {
    try { await gateway.waitForReady(5000); } catch { return []; }
  }

  const departments = Object.entries(config.departments || {}).map(([id, dept]) => ({ ...dept, id }));
  const tasks = departments.map(async (dept) => {
    const sessionKey = getSessionKey(dept.id);
    try {
      const startMs = Date.now();
      const result = await gateway.sendAgentMessage(sessionKey, `[Broadcast] ${command}`);
      const durationMs = Date.now() - startMs;

      recordChat(dept.id, durationMs, !result.text);
      if (result.usage) {
        recordTokens(dept.id, result.usage);
      }

      return { deptId: dept.id, name: dept.name, reply: result.text || '[Empty response]' };
    } catch (err) {
      recordChat(dept.id, 0, true);
      return { deptId: dept.id, name: dept.name, reply: `[Error] ${err.message}` };
    }
  });

  const results = await Promise.allSettled(tasks);
  return results.map((r, i) =>
    r.status === 'fulfilled' ? r.value : { deptId: departments[i].id, name: departments[i].name, reply: `[Error] ${r.reason?.message}` }
  );
}

// ---- Sub-agents ----

function createSubAgent(deptId, task, name) {
  const data = loadSubAgents(deptId);
  data.count++;
  const subId = `${deptId}-sub-${data.count}`;
  const agentName = name || `Sub-agent #${data.count}`;
  data.agents[subId] = { name: agentName, task, status: 'active', created: new Date().toISOString() };
  saveSubAgents(deptId, data);
  console.log(`[SubAgent] Created ${subId} "${agentName}" for "${task.substring(0, 50)}"`);
  return { subId, name: agentName };
}

async function chatSubAgent(deptId, subId, userMessage) {
  const data = loadSubAgents(deptId);
  const agent = data.agents[subId];
  if (!agent) return { success: false, error: `Sub-agent ${subId} not found` };

  const gateway = getGateway();
  if (!gateway.isReady) return { success: false, error: 'Gateway not connected' };

  const sessionKey = `agent:main:${deptId}:sub:${subId}`;
  try {
    const startMs = Date.now();
    const result = await gateway.sendAgentMessage(sessionKey, userMessage);
    const durationMs = Date.now() - startMs;

    if (result.text) {
      recordChat(deptId, durationMs, false);
      if (result.usage) {
        recordTokens(deptId, result.usage);
      }
      return { success: true, reply: result.text };
    }

    recordChat(deptId, durationMs, true);
    return { success: false, error: 'Empty response' };
  } catch (err) {
    recordChat(deptId, 0, true);
    return { success: false, error: err.message };
  }
}

function listSubAgents(deptId) {
  const data = loadSubAgents(deptId);
  return Object.entries(data.agents).map(([id, agent]) => ({
    id, name: agent.name, task: agent.task, status: agent.status,
  }));
}

function removeSubAgent(deptId, subId) {
  const data = loadSubAgents(deptId);
  const agent = data.agents[subId];
  if (!agent) return false;
  const archivePath = path.join(BASE_PATH, 'departments', deptId, 'subagent-archives.json');
  let archives = [];
  try { if (fs.existsSync(archivePath)) archives = JSON.parse(fs.readFileSync(archivePath, 'utf8')); } catch {}
  archives.push({ id: subId, ...agent, archived: new Date().toISOString() });
  try { fs.writeFileSync(archivePath, JSON.stringify(archives, null, 2), 'utf8'); } catch {}
  delete data.agents[subId];
  saveSubAgents(deptId, data);
  console.log(`[SubAgent] Archived and removed ${subId} "${agent.name}"`);
  return true;
}

// ---- Exports ----

export {
  chat, getChatHistory, getSessionKey,
  saveBulletin, saveMemory, clearHistory, loadMemory, loadBulletin,
  createSubAgent, chatSubAgent, listSubAgents, removeSubAgent,
  broadcastCommand,
};
