import fs from 'fs';
import path from 'path';
import { getGateway } from './gateway.js';
import { recordChat, recordTokens } from './routes/metrics.js';
import { BASE_PATH } from './utils.js';

// ---- Config / mappings ----

let _configCache = null;
let _configMtime = 0;

function loadConfig() {
  const configPath = path.join(BASE_PATH, 'departments', 'config.json');
  try {
    const stat = fs.statSync(configPath);
    if (_configCache && stat.mtimeMs === _configMtime) {
      return _configCache;
    }
    _configCache = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    _configMtime = stat.mtimeMs;
    return _configCache;
  } catch {
    return { departments: {} };
  }
}

// ---- Integrations config (cached with mtime) ----

const INTEGRATIONS_PATH = path.join(BASE_PATH, '..', 'command-center', 'integrations.json');
let _integCache = null;
let _integMtime = 0;

function loadIntegrations() {
  try {
    const stat = fs.statSync(INTEGRATIONS_PATH);
    if (_integCache && stat.mtimeMs === _integMtime) return _integCache;
    _integCache = JSON.parse(fs.readFileSync(INTEGRATIONS_PATH, 'utf8'));
    _integMtime = stat.mtimeMs;
    return _integCache;
  } catch {
    return {};
  }
}

// ---- Department Context Builder ----

function loadPersona(deptId) {
  const p = path.join(BASE_PATH, 'departments', 'personas', `${deptId}.md`);
  try { return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''; } catch { return ''; }
}

function buildToolsSection() {
  const integ = loadIntegrations();
  const CMD = 'bash /root/.openclaw/workspace/skills/cmd-center/cmd-api.sh';
  const lines = [];

  if (integ.gmail?.enabled && integ.gmail?.email) {
    lines.push(`- 发邮件（已配置 ${integ.gmail.email}）: ${CMD} POST /email/send '{"to":"收件人","subject":"主题","body":"正文"}'`);
  }
  if (integ.drive?.enabled) {
    lines.push(`- Google Drive 文件列表: ${CMD} GET /drive/files`);
    lines.push(`- Google Drive 上传: ${CMD} POST /drive/upload`);
    lines.push(`- Google Drive 备份: ${CMD} POST /drive/backup`);
  }
  if (integ['google-sheets']?.enabled) {
    const sid = integ['google-sheets'].defaultSpreadsheetId;
    lines.push(`- Google Sheets 读写${sid ? '（默认表: ' + sid + '）' : ''}: bash /root/.openclaw/workspace/skills/google-sheet/scripts/sheets.js read "Sheet1!A1:D10"${sid ? ' ' + sid : ''}`);
  }

  // Always-available tools (from skills)
  lines.push(`- 网络搜索: bash /root/.openclaw/workspace/skills/cmd-center/tools/web-search.sh "关键词" 5`);
  lines.push(`- AI 生成图片: bash /root/.openclaw/workspace/skills/cmd-center/tools/image-gen.sh "描述" 1024x1024`);
  lines.push(`- 语音转文字: bash /root/.openclaw/workspace/skills/cmd-center/tools/voice-transcribe.sh /path/audio.mp3 zh`);

  // Cross-department API
  lines.push(`- 跨部门对话: ${CMD} POST /departments/{id}/chat '{"message":"..."}'`);
  lines.push(`- 全员广播: ${CMD} POST /broadcast '{"command":"..."}'`);

  return lines.join('\n');
}

function buildDepartmentContext(deptId) {
  const config = loadConfig();
  const dept = config.departments?.[deptId];
  const persona = loadPersona(deptId);
  const bulletin = loadBulletin();

  const parts = [];

  // Persona: strip the old static tools section, use dynamic one
  if (persona) {
    const clean = persona.replace(/## 集成工具[\s\S]*$/, '').trim();
    parts.push(clean);
  } else if (dept) {
    parts.push(`你是 ${dept.agent || deptId}，${dept.name} 部门负责人。`);
  }

  // Dynamic tools section
  const tools = buildToolsSection();
  parts.push(`## 可用工具（自动同步，直接调用即可）\n${tools}`);

  // Bulletin (brief)
  if (bulletin.trim()) {
    parts.push(`## 公告板\n${bulletin.trim()}`);
  }

  return parts.join('\n\n');
}

function wrapWithContext(deptId, userMessage) {
  const ctx = buildDepartmentContext(deptId);
  if (!ctx) return userMessage;
  return `<department_context>\n${ctx}\n</department_context>\n\n${userMessage}`;
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
 * Prepends dynamic department context (persona + enabled tools) to each message.
 * Tools section is built from integrations.json at runtime — new configs auto-sync.
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
  const wrappedMessage = wrapWithContext(deptId, userMessage);

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
    const result = await gateway.sendAgentMessage(sessionKey, wrappedMessage, attachments);
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
      const wrappedCmd = wrapWithContext(dept.id, `[Broadcast] ${command}`);
      const result = await gateway.sendAgentMessage(sessionKey, wrappedCmd);
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
