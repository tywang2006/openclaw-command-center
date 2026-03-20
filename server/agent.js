import fs from 'fs';
import path from 'path';
import { getGateway } from './gateway.js';
import { recordChat, recordTokens } from './routes/metrics.js';
import { BASE_PATH, safeWriteFileSync } from './utils.js';
import { withFileLock } from './file-lock.js';
import { createLogger } from './logger.js';

const log = createLogger('Agent');

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
  } catch (err) {
    log.warn('Failed to load config', { error: err.message });
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
  } catch (err) {
    log.warn('[Config] Failed to load integrations:', err.message);
    return {};
  }
}

// ---- Department Context Builder ----

function loadPersona(deptId) {
  const p = path.join(BASE_PATH, 'departments', 'personas', `${deptId}.md`);
  try {
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
  } catch (err) {
    log.warn('Failed to load persona', { deptId, error: err.message });
    return '';
  }
}

// ---- API group definitions ----
// Each group maps to a set of API lines that can be selectively included per department.
// Core groups are always included. Optional groups are controlled by dept config.

const CORE_GROUPS = ['dept-mgmt', 'search', 'bulletin', 'system'];

const DEFAULT_OPTIONAL_GROUPS = ['subagents', 'export', 'notifications', 'skills-api', 'external-tools'];

function buildApiGroup(groupId, CMD, integ) {
  const lines = [];
  switch (groupId) {
    // ---- Core groups (always included) ----
    case 'dept-mgmt':
      lines.push(`### 部门管理`);
      lines.push(`- 部门列表: ${CMD} GET /departments`);
      lines.push(`- 跨部门对话（异步，立即返回）: ${CMD} POST /departments/{id}/chat '{"message":"...","async":true,"sourceDept":"${'{自己部门ID}'}"}'`);
      lines.push(`- 全员广播: ${CMD} POST /broadcast '{"command":"..."}'`);
      lines.push(`- 读取部门记忆: ${CMD} GET /departments/{id}/memory`);
      lines.push(`- 更新部门记忆: ${CMD} PUT /departments/{id}/memory '{"content":"..."}'`);
      lines.push(`- 读取部门日志: ${CMD} GET /departments/{id}/daily/{YYYY-MM-DD}`);
      lines.push(`- 可用日志日期: ${CMD} GET /departments/{id}/daily-dates`);
      lines.push(`- 聊天历史: ${CMD} GET /departments/{id}/history`);
      lines.push(`- 记忆历史版本: ${CMD} GET /departments/{id}/memory/history`);
      lines.push(`- 读取 Persona: ${CMD} GET /departments/{id}/persona`);
      lines.push(`- 创建部门: ${CMD} POST /departments '{"id":"xxx","name":"名称","agent":"代理名"}'`);
      lines.push(`- 更新部门: ${CMD} PUT /departments/{id} '{"name":"新名称"}'`);
      lines.push(`- 删除部门: ${CMD} DELETE /departments/{id}`);
      break;
    case 'search':
      lines.push(`### 搜索`);
      lines.push(`- 全局搜索（记忆/日志/公告）: ${CMD} GET '/search?q=关键词'`);
      lines.push(`- 跨部门记忆搜索: ${CMD} GET '/memory/search?q=关键词'`);
      break;
    case 'bulletin':
      lines.push(`### 公告板`);
      lines.push(`- 读取公告: ${CMD} GET /bulletin`);
      lines.push(`- 发布公告: ${CMD} POST /bulletin '{"content":"..."}'`);
      break;
    case 'system':
      lines.push(`### 系统`);
      lines.push(`- 系统能力: ${CMD} GET /system/capabilities`);
      lines.push(`- 活跃会话: ${CMD} GET /system/sessions`);
      lines.push(`- 运行指标: ${CMD} GET /metrics`);
      break;

    // ---- Optional groups ----
    case 'email':
      if (integ.gmail?.enabled && integ.gmail?.email) {
        lines.push(`### 邮件（已配置 ${integ.gmail.email}）`);
        lines.push(`- 发邮件: ${CMD} POST /email/send '{"to":"收件人","subject":"主题","body":"正文"}'`);
        lines.push(`- 邮件状态: ${CMD} GET /email/status`);
      }
      break;
    case 'drive':
      if (integ.drive?.enabled || (integ.gogcli?.enabled && integ.gogcli?.account)) {
        lines.push(`### Google Drive`);
        lines.push(`- 文件列表: ${CMD} GET /drive/files`);
        lines.push(`- 上传文件: ${CMD} POST /drive/upload '{"filename":"文件名.md","content":"内容"}'`);
        lines.push(`- 备份所有部门: ${CMD} POST /drive/backup`);
        lines.push(`- 备份单个部门: ${CMD} POST /drive/backup '{"deptId":"部门ID"}'`);
        lines.push(`- Drive 状态: ${CMD} GET /drive/status`);
      }
      break;
    case 'sheets':
      if (integ['google-sheets']?.enabled) {
        const sid = integ['google-sheets'].defaultSpreadsheetId;
        lines.push(`### Google Sheets${sid ? '（默认表: ' + sid + '）' : ''}`);
        lines.push(`- 读写表格: bash /root/.openclaw/workspace/skills/google-sheet/scripts/sheets.js read "Sheet1!A1:D10"${sid ? ' ' + sid : ''}`);
      }
      break;
    case 'subagents':
      lines.push(`### 子代理管理`);
      lines.push(`- 列出子代理: ${CMD} GET /departments/{id}/subagents`);
      lines.push(`- 创建子代理: ${CMD} POST /departments/{id}/subagents '{"task":"任务描述","name":"名称"}'`);
      lines.push(`- 删除子代理: ${CMD} DELETE /departments/{id}/subagents/{subId}`);
      lines.push(`- **向子代理派活: 必须使用 sessions_spawn 工具（见"本部门子代理"章节），不要用 API**`);
      break;
    case 'export':
      lines.push(`### 导出`);
      lines.push(`- 导出对话: ${CMD} POST /departments/{id}/export '{"format":"markdown"}'`);
      lines.push(`- 导出并发邮件: ${CMD} POST /departments/{id}/export/email '{"to":"收件人"}'`);
      lines.push(`- 导出到 Drive: ${CMD} POST /departments/{id}/export/drive`);
      break;
    case 'cron':
      lines.push(`### 定时任务`);
      lines.push(`- 任务列表: ${CMD} GET /cron/jobs`);
      lines.push(`- 创建定时任务: ${CMD} POST /cron/jobs '{"name":"名称","cron":"0 9 * * *","deptId":"部门","message":"指令"}'`);
      lines.push(`- 立即执行: ${CMD} POST /cron/jobs/{id}/run`);
      lines.push(`- 启停任务: ${CMD} POST /cron/jobs/{id}/toggle`);
      lines.push(`- 更新任务: ${CMD} PUT /cron/jobs/{id} '{"name":"新名称"}'`);
      lines.push(`- 删除任务: ${CMD} DELETE /cron/jobs/{id}`);
      break;
    case 'workflows':
      lines.push(`### 工作流`);
      lines.push(`- 工作流列表: ${CMD} GET /workflows`);
      lines.push(`- 创建工作流: ${CMD} POST /workflows '{"name":"名称","steps":[...]}'`);
      lines.push(`- 执行工作流: ${CMD} POST /workflows/{id}/run`);
      lines.push(`- 更新工作流: ${CMD} PUT /workflows/{id} '{"name":"新名称"}'`);
      lines.push(`- 删除工作流: ${CMD} DELETE /workflows/{id}`);
      break;
    case 'files':
      lines.push(`### 文件管理`);
      lines.push(`- 文件列表: ${CMD} GET /files/list`);
      lines.push(`- 转换格式: ${CMD} POST /files/convert '{"filename":"文件名","format":"csv"}'`);
      lines.push(`- 删除文件: ${CMD} DELETE /files/{filename}`);
      break;
    case 'notifications':
      lines.push(`### 通知`);
      lines.push(`- 通知列表: ${CMD} GET /notifications`);
      lines.push(`- 未读统计: ${CMD} GET /notifications/summary`);
      lines.push(`- 标记已读: ${CMD} PUT /notifications/{id}/read`);
      lines.push(`- 全部已读: ${CMD} PUT /notifications/read-all`);
      break;
    case 'auto-backup':
      lines.push(`### 自动备份`);
      lines.push(`- 备份状态: ${CMD} GET /integrations/autobackup`);
      lines.push(`- 立即备份: ${CMD} POST /integrations/autobackup/run`);
      break;
    case 'skills-api':
      lines.push(`### 技能`);
      lines.push(`- 技能列表: ${CMD} GET /skills`);
      lines.push(`- 技能详情: ${CMD} GET /skills/{slug}`);
      lines.push(`- 执行技能: ${CMD} POST /skills/{slug}/execute '{"deptId":"部门","message":"指令"}'`);
      break;
    case 'external-tools':
      lines.push(`### 外部工具`);
      lines.push(`- 网络搜索: bash /root/.openclaw/workspace/skills/cmd-center/tools/web-search.sh "关键词" 5`);
      lines.push(`- AI 生成图片: bash /root/.openclaw/workspace/skills/cmd-center/tools/image-gen.sh "描述" 1024x1024`);
      lines.push(`- 语音转文字: bash /root/.openclaw/workspace/skills/cmd-center/tools/voice-transcribe.sh /path/audio.mp3 zh`);
      break;
  }
  return lines;
}

/**
 * Build the tools/API section for a department's context.
 * Reads dept config for `apiGroups` to determine which API groups to include.
 * - `["*"]` or missing/empty → core + default optional groups
 * - Explicit list → core + listed groups only
 */
function buildToolsSection(deptId) {
  const integ = loadIntegrations();
  // Prefix with OPENCLAW_DEPT_ID so cmd-api.sh sends x-source-dept header
  const CMD = `OPENCLAW_DEPT_ID=${deptId} bash /root/.openclaw/workspace/skills/cmd-center/cmd-api.sh`;
  const lines = [];

  // ---- Universal API wrapper ----
  lines.push(`### 通用 API 调用方式`);
  lines.push(`所有 Command Center API 均可通过以下格式调用:`);
  lines.push(`  ${CMD} <METHOD> <ENDPOINT> [JSON_BODY]`);
  lines.push(``);

  // Determine which API groups this department can use
  const config = loadConfig();
  const dept = config.departments?.[deptId];
  const deptApiGroups = dept?.apiGroups;

  // Resolve groups to include
  let optionalGroups;
  if (!deptApiGroups || deptApiGroups.length === 0 || (deptApiGroups.length === 1 && deptApiGroups[0] === '*')) {
    // Wildcard or missing: include all known optional groups
    optionalGroups = ['email', 'drive', 'sheets', 'subagents', 'export', 'cron', 'workflows', 'files', 'notifications', 'auto-backup', 'skills-api', 'external-tools'];
  } else {
    optionalGroups = deptApiGroups.filter(g => !CORE_GROUPS.includes(g));
  }

  // Always include core groups
  for (const group of CORE_GROUPS) {
    lines.push(...buildApiGroup(group, CMD, integ));
  }

  // Include resolved optional groups
  for (const group of optionalGroups) {
    lines.push(...buildApiGroup(group, CMD, integ));
  }

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

  // Dynamic tools section (filtered by department's apiGroups config)
  const tools = buildToolsSection(deptId);
  parts.push(`## 可用工具（自动同步，直接调用即可）

**核心原则：所有任务必须优先使用 Command Center 内置 API，绝对不要自己写脚本实现已有功能。**
**回复原则：直接给出结果或执行操作，不要向用户解释你使用了什么 API、工具或实现手段。用户只关心结果，不关心过程。**
- 备份 → /drive/backup 或 /integrations/autobackup/run
- 发邮件 → /email/send
- 搜索 → /search?q= 或 网络搜索工具
- 读写表格 → Google Sheets 工具
- 定时任务 → /cron/jobs
- 工作流 → /workflows
- 跨部门协作 → /departments/{id}/chat 或 /broadcast
- 文件管理 → /files/list, /files/convert
- 通知 → /notifications
- 导出 → /departments/{id}/export

${tools}`);

  // Cross-department capability index — so each dept knows who can do what
  const deptIndex = [];
  const allDepts = Object.entries(config.departments || {});
  if (allDepts.length > 1) {
    const allSubAgents = loadAllSubAgents(config);
    deptIndex.push(`## 跨部门协作索引`);
    deptIndex.push(`如果收到的任务不在你的专长范围内，请通过跨部门对话 API 委派给合适的部门。`);
    deptIndex.push(``);
    for (const [id, d] of allDepts) {
      if (id === deptId) continue; // skip self
      const skillsLabel = (d.skills && d.skills[0] !== '*')
        ? d.skills.join(', ')
        : '全能';
      const groupsLabel = (d.apiGroups && d.apiGroups[0] !== '*')
        ? d.apiGroups.join(', ')
        : '全部';
      deptIndex.push(`- **${d.name}** (${id}): 技能=[${skillsLabel}] API=[${groupsLabel}]`);
      // List active sub-agents for this department (cap at 5)
      const subData = allSubAgents[id];
      if (subData) {
        const activeEntries = Object.entries(subData.agents).filter(([, a]) => a.status === 'active');
        const shown = activeEntries.slice(0, 5);
        for (const [, agent] of shown) {
          const taskBrief = agent.task.length > 50 ? agent.task.slice(0, 50) + '...' : agent.task;
          const subSkills = Array.isArray(agent.skills) && agent.skills.length > 0
            ? agent.skills.join(', ')
            : '';
          deptIndex.push(`  - 子代理「${agent.name}」: 任务=${taskBrief}${subSkills ? ', 技能=[' + subSkills + ']' : ''}`);
        }
        if (activeEntries.length > 5) {
          deptIndex.push(`  - ...及其他 ${activeEntries.length - 5} 个子代理`);
        }
      }
    }
    parts.push(deptIndex.join('\n'));

    // List own department's sub-agents
    const ownSubData = allSubAgents[deptId];
    if (ownSubData && Object.keys(ownSubData.agents).length > 0) {
      const deptName = dept?.name || deptId;
      const ownSubs = [`## 本部门子代理`];
      const activeAgents = Object.entries(ownSubData.agents).filter(([, a]) => a.status === 'active');

      // Sub-agent list
      for (const [subId, agent] of activeAgents) {
        const subSkills = Array.isArray(agent.skills) && agent.skills.length > 0
          ? ', 技能=[' + agent.skills.join(', ') + ']'
          : '';
        ownSubs.push(`- 「${agent.name}」(${subId}): 任务=${agent.task}${subSkills}`);
      }

      // sessions_spawn delegation guide
      if (activeAgents.length > 0) {
        ownSubs.push('');
        ownSubs.push(`### 向子代理派活`);
        ownSubs.push(`**必须使用 sessions_spawn 工具，不要用 bash cmd-api.sh 调用 chat 接口。**`);
        ownSubs.push('');
        ownSubs.push(`格式:`);
        ownSubs.push('sessions_spawn(');
        ownSubs.push(`  task="你是「{名字}」，隶属于 ${deptName}。角色: {任务}。\\n\\n请完成：{具体工作}",`);
        ownSubs.push(`  label="{名字}: {简述}"`);
        ownSubs.push(')');

        // Concrete example using first sub-agent
        const [, firstAgent] = activeAgents[0];
        ownSubs.push('');
        ownSubs.push(`示例 — 派活给「${firstAgent.name}」:`);
        ownSubs.push('sessions_spawn(');
        ownSubs.push(`  task="你是「${firstAgent.name}」，隶属于 ${deptName}。角色: ${firstAgent.task}。\\n\\n请完成：分析首页加载速度问题并给出优化方案",`);
        ownSubs.push(`  label="${firstAgent.name}: 首页优化"`);
        ownSubs.push(')');

        ownSubs.push('');
        ownSubs.push('注意：sessions_spawn 是非阻塞的，立即返回。结果自动回报给你。可同时派活多个子代理。');
      }

      if (ownSubs.length > 1) {
        parts.push(ownSubs.join('\n'));
      }
    }
  }

  // Bulletin (capped at 4KB to prevent context overflow)
  // Sanitize bulletin content to prevent context tag injection from user-posted bulletins
  if (bulletin.trim()) {
    let trimmed = sanitizeContextTags(bulletin.trim());
    if (Buffer.byteLength(trimmed, 'utf8') > 4096) {
      trimmed = trimmed.slice(-4000);
      const nl = trimmed.indexOf('\n');
      if (nl > 0) trimmed = trimmed.slice(nl + 1);
      trimmed = '...(earlier entries truncated)\n' + trimmed;
    }
    parts.push(`## 公告板\n${trimmed}`);
  }

  return parts.join('\n\n');
}

/**
 * Strip context-injection tags from untrusted input.
 * Handles case variations, extra whitespace, and HTML-entity encoded forms
 * to prevent users from injecting fake <department_context> or <subagent_context> blocks.
 */
function sanitizeContextTags(text) {
  if (!text) return text;
  return text
    .replace(/<\s*\/?\s*department_context\s*>/gi, '')
    .replace(/<\s*\/?\s*subagent_context\s*>/gi, '')
    .replace(/&lt;\s*\/?\s*department_context\s*&gt;/gi, '')
    .replace(/&lt;\s*\/?\s*subagent_context\s*&gt;/gi, '');
}

function wrapWithContext(deptId, userMessage) {
  const ctx = buildDepartmentContext(deptId);
  if (!ctx) return userMessage;
  // Strip any fake context tags from user message to prevent context injection
  const sanitized = sanitizeContextTags(userMessage);
  return `<department_context>\n${ctx}\n</department_context>\n\n${sanitized}`;
}

/**
 * Strip context tags from message text (for clean chat history display).
 */
function stripContextTags(text) {
  if (!text) return text;
  return text
    .replace(/<department_context>[\s\S]*?<\/department_context>\s*/g, '')
    .replace(/<subagent_context>[\s\S]*?<\/subagent_context>\s*/g, '')
    .trim();
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
    log.error('Failed to load subagents file', { path: p, error: err.message });
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
    safeWriteFileSync(p, JSON.stringify(data, null, 2));
  } catch (err) {
    log.error('Failed to save subagents file', { path: p, error: err.message });
  }
}

// ---- Bulk sub-agent loader (cached per call) ----

function loadAllSubAgents(config) {
  const result = {};
  for (const id of Object.keys(config.departments || {})) {
    const data = loadSubAgents(id);
    if (data && Object.keys(data.agents).length > 0) {
      result[id] = data;
    }
  }
  return result;
}

// ---- Chat via OpenClaw Gateway ----

// H7 Fix: AI response size limit (500KB)
const MAX_RESPONSE_SIZE = 512000;

/**
 * Chat with a department agent via OpenClaw Gateway.
 * Prepends dynamic department context (persona + enabled tools) to each message.
 * Tools section is built from integrations.json at runtime — new configs auto-sync.
 */
async function chat(deptId, userMessage, images, options = {}) {
  const traceId = options.traceId || '';
  const gateway = getGateway();

  if (!gateway.isReady) {
    try {
      await gateway.waitForReady(15000);
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

  // H1 fix: Retry logic with exponential backoff for transient errors (max 2 retries)
  const MAX_RETRIES = 2;
  const RETRY_DELAYS = [1000, 3000]; // 1s, 3s

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const startMs = Date.now();
      const result = await gateway.sendAgentMessage(sessionKey, wrappedMessage, attachments, { traceId });
      const durationMs = Date.now() - startMs;

      // H24 fix: Accept empty text if tool results were generated
      const hasToolResults = result.toolResults && Array.isArray(result.toolResults) && result.toolResults.length > 0;
      const hasText = result.text && result.text.trim().length > 0;

      if (hasText || hasToolResults) {
        // H7 Fix: Truncate AI response to MAX_RESPONSE_SIZE (500KB)
        let replyText = result.text || '';
        if (Buffer.byteLength(replyText, 'utf8') > MAX_RESPONSE_SIZE) {
          log.warn(`Chat ${deptId} response truncated from ${Buffer.byteLength(replyText, 'utf8')} to ${MAX_RESPONSE_SIZE} bytes`, { traceId, deptId });
          replyText = replyText.substring(0, MAX_RESPONSE_SIZE);
        }

        recordChat(deptId, durationMs, false);
        if (result.usage) {
          recordTokens(deptId, result.usage);
        }
        log.info(`Chat ${deptId} completed in ${durationMs}ms (text=${hasText}, tools=${hasToolResults})`, { traceId, deptId, durationMs });
        return { success: true, reply: replyText };
      }

      recordChat(deptId, durationMs, true);
      log.warn(`Chat ${deptId} empty response (no text or tool results)`, { traceId, deptId, durationMs });
      return { success: false, error: 'Gateway returned empty response' };
    } catch (err) {
      // Check for transient errors (network, timeout, 5xx)
      const isTransient = err.message.includes('timeout') ||
        err.message.includes('connection lost') ||
        err.message.includes('Gateway connection lost') ||
        err.message.includes('WebSocket not open') ||
        err.message.includes('ECONNREFUSED') ||
        err.message.includes('ETIMEDOUT') ||
        /5\d{2}/.test(err.message); // Match 5xx status codes

      const isClientError = /4\d{2}/.test(err.message) ||
        err.message.includes('Invalid request') ||
        err.message.includes('Bad request');

      // Only retry on transient errors, not on client/business logic errors
      if (isTransient && !isClientError && attempt < MAX_RETRIES) {
        const delay = RETRY_DELAYS[attempt];
        log.warn(`Chat ${deptId} transient error (attempt ${attempt + 1}/${MAX_RETRIES}), retrying in ${delay}ms: ${err.message}`, { traceId, deptId, attempt: attempt + 1, delay });

        // Wait with exponential backoff before retry
        await new Promise(r => setTimeout(r, delay));

        // Re-check gateway readiness before retry
        if (!gateway.isReady) {
          try {
            await gateway.waitForReady(15000);
          } catch (waitErr) {
            log.warn(`Gateway not ready after retry wait: ${waitErr.message}`, { traceId, deptId });
            // Continue to retry anyway - the sendAgentMessage call will fail if truly not ready
          }
        }
        continue;
      }

      // Non-transient error or retries exhausted
      log.error(`Chat ${deptId} error (attempt ${attempt + 1}/${MAX_RETRIES + 1}): ${err.message}`, { traceId, deptId, isTransient, isClientError });
      recordChat(deptId, 0, true);
      return { success: false, error: err.message };
    }
  }
  // Safety net: should never reach here
  return { success: false, error: 'Exhausted all retry attempts' };
}

// H9 fix: Track pending async requests for timeout and disconnect handling
const ASYNC_REQUEST_TIMEOUT_MS = 120000; // 120 seconds
const asyncRequestTracking = new Map(); // Map<requestId, { deptId, traceId, timer, timestamp }>

/**
 * Fire-and-forget chat: send message to department agent, return immediately.
 * The response will arrive via WebSocket streaming events.
 * H9 fix: Now tracks requests with timeout and handles gateway disconnect events.
 */
function chatAsync(deptId, userMessage, options = {}) {
  const traceId = options.traceId || '';
  const gateway = getGateway();
  if (!gateway.isReady) {
    return { success: false, error: 'Gateway not connected' };
  }

  const sessionKey = getSessionKey(deptId);
  const wrappedMessage = wrapWithContext(deptId, userMessage);

  try {
    const requestId = gateway.sendAgentMessageAsync(sessionKey, wrappedMessage, [], { traceId });

    // H9 fix: Set up timeout for async request
    const timer = setTimeout(() => {
      if (asyncRequestTracking.has(requestId)) {
        asyncRequestTracking.delete(requestId);
        log.error(`Async chat ${deptId} timeout after ${ASYNC_REQUEST_TIMEOUT_MS}ms (requestId=${requestId})`, { traceId, deptId, requestId });
        // Note: Cannot directly notify caller since this is fire-and-forget
        // Error will be logged and tracked in metrics
        recordChat(deptId, ASYNC_REQUEST_TIMEOUT_MS, true);
      }
    }, ASYNC_REQUEST_TIMEOUT_MS);

    // Track this async request
    asyncRequestTracking.set(requestId, {
      deptId,
      traceId,
      timer,
      timestamp: Date.now(),
      sessionKey
    });

    log.info(`Async chat sent to ${deptId}, requestId=${requestId}`, { traceId, deptId, requestId });
    return { success: true, status: 'sent', requestId };
  } catch (err) {
    log.error(`Async chat ${deptId} error: ${err.message}`, { traceId, deptId });
    return { success: false, error: err.message };
  }
}

/**
 * H9 fix: Clean up completed async request tracking
 */
function cleanupAsyncRequest(requestId) {
  const tracked = asyncRequestTracking.get(requestId);
  if (tracked) {
    clearTimeout(tracked.timer);
    asyncRequestTracking.delete(requestId);
  }
}

/**
 * H9 fix: Handle gateway disconnect - fail all pending async requests
 */
function handleGatewayDisconnect() {
  const pendingCount = asyncRequestTracking.size;
  if (pendingCount > 0) {
    log.warn(`Gateway disconnected with ${pendingCount} pending async requests`, { pendingCount });
    for (const [requestId, tracked] of asyncRequestTracking) {
      clearTimeout(tracked.timer);
      recordChat(tracked.deptId, Date.now() - tracked.timestamp, true);
      log.error(`Async chat ${tracked.deptId} failed: gateway disconnected (requestId=${requestId})`, {
        traceId: tracked.traceId,
        deptId: tracked.deptId,
        requestId
      });
    }
    asyncRequestTracking.clear();
  }
}

/**
 * Get chat history for a department from OpenClaw Gateway.
 * Returns: { success: boolean, messages: array, error?: string }
 */
async function getChatHistory(deptId, limit = 30) {
  const gateway = getGateway();
  if (!gateway.isReady) {
    return { success: false, messages: [], error: 'Gateway not ready' };
  }

  const sessionKey = getSessionKey(deptId);
  try {
    const messages = await gateway.getChatHistory(sessionKey, limit);
    const cleaned = messages.map(m => {
      let text = '';
      if (typeof m.content === 'string') {
        text = m.content;
      } else if (Array.isArray(m.content)) {
        text = m.content
          .filter(c => c.type === 'text' && c.text)
          .map(c => c.text)
          .join('\n');
      }
      // Strip context tags from user messages
      const cleanedText = stripContextTags(text);
      return {
        role: m.role === 'user' ? 'user' : 'assistant',
        text: cleanedText,
        timestamp: m.timestamp || null,
      };
    }).filter(m => m.text && m.role !== 'toolResult' && m.role !== 'toolCall');

    return { success: true, messages: cleaned };
  } catch (err) {
    log.error('History fetch error', { deptId, error: err.message });
    return { success: false, messages: [], error: err.message };
  }
}

// ---- Bulletin ----

function loadBulletin() {
  const bPath = path.join(BASE_PATH, 'departments', 'bulletin', 'board.md');
  try {
    return fs.existsSync(bPath) ? fs.readFileSync(bPath, 'utf8') : '';
  } catch (err) {
    log.warn('Failed to load bulletin', { error: err.message });
    return '';
  }
}

function saveBulletin(content) {
  const bPath = path.join(BASE_PATH, 'departments', 'bulletin', 'board.md');
  try {
    safeWriteFileSync(bPath, content);
    return true;
  } catch (err) {
    log.warn('Failed to save bulletin', { error: err.message });
    return false;
  }
}

// ---- Memory ----

function loadMemory(deptId) {
  const memPath = path.join(BASE_PATH, 'departments', deptId, 'memory', 'MEMORY.md');
  try {
    return fs.existsSync(memPath) ? fs.readFileSync(memPath, 'utf8') : '';
  } catch (err) {
    log.warn('Failed to load memory', { deptId, error: err.message });
    return '';
  }
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
        safeWriteFileSync(bakPath, existing);
      }
    }
    safeWriteFileSync(memPath, content);

    // Rotate: keep only last 50 backup files
    const memDir = path.join(BASE_PATH, 'departments', deptId, 'memory');
    try {
      const bakFiles = fs.readdirSync(memDir)
        .filter(f => f.endsWith('.md.bak'))
        .sort()
        .reverse();
      if (bakFiles.length > 50) {
        for (const old of bakFiles.slice(50)) {
          fs.unlinkSync(path.join(memDir, old));
        }
      }
    } catch (err) {
      log.warn('Failed to rotate memory backups', { deptId, error: err.message });
    }

    return true;
  } catch (err) {
    log.warn('Failed to save memory', { deptId, error: err.message });
    return false;
  }
}

function clearHistory(deptId) {
  log.info('History clear requested (managed by gateway)', { deptId });
}

// ---- Broadcast ----

async function broadcastCommand(command, options = {}) {
  const traceId = options.traceId || '';
  const config = loadConfig();
  const gateway = getGateway();
  if (!gateway.isReady) {
    try { await gateway.waitForReady(15000); } catch { return []; }
  }

  const departments = Object.entries(config.departments || {}).map(([id, dept]) => ({ ...dept, id }));
  log.info(`Broadcast started: ${command.substring(0, 60)}`, { traceId, deptCount: departments.length });

  // Overall timeout: 3 minutes for the entire broadcast operation
  const BROADCAST_TIMEOUT_MS = 180000;
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Broadcast timeout')), BROADCAST_TIMEOUT_MS);
  });

  const broadcastPromise = (async () => {
    // Process departments with concurrency limit of 3
    const CONCURRENCY = 3;
    const results = [];
    for (let i = 0; i < departments.length; i += CONCURRENCY) {
      const batch = departments.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.allSettled(batch.map(async (dept) => {
        const sessionKey = getSessionKey(dept.id);
        try {
          const startMs = Date.now();
          const wrappedCmd = wrapWithContext(dept.id, `[Broadcast] ${command}`);
          const result = await gateway.sendAgentMessage(sessionKey, wrappedCmd, [], { traceId });
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
      }));
      results.push(...batchResults);
    }

    return results.map((r, i) =>
      r.status === 'fulfilled' ? r.value : { deptId: departments[i].id, name: departments[i].name, reply: `[Error] ${r.reason?.message}` }
    );
  })();

  try {
    return await Promise.race([broadcastPromise, timeoutPromise]);
  } catch (err) {
    // Timeout occurred - return partial results with timeout flag
    log.warn(`Broadcast timeout after ${BROADCAST_TIMEOUT_MS}ms, returning partial results`, { traceId });
    const partialResults = departments.map(dept => ({
      deptId: dept.id,
      name: dept.name,
      reply: '[Timeout - no response]',
      timeout: true
    }));
    return partialResults;
  }
}

// ---- Sub-agents ----

// Sub-agent TTL: 24 hours
const SUB_AGENT_TTL = 24 * 60 * 60 * 1000;

async function createSubAgent(deptId, task, name, skills) {
  return withFileLock(subAgentsPath(deptId), () => {
    const data = loadSubAgents(deptId);
    // Cap active sub-agents per department
    const activeCount = Object.values(data.agents).filter(a => a.status === 'active').length;
    if (activeCount >= 10) {
      throw new Error('Max 10 active sub-agents per department');
    }
    data.count++;
    const subId = `${deptId}-sub-${data.count}`;
    // Sanitize name: strip shell-significant chars, cap length
    const rawName = name || `Sub-agent #${data.count}`;
    const agentName = rawName.replace(/[`$\\'"(){}<>|;&]/g, '').slice(0, 50);
    const entry = {
      name: agentName,
      task,
      status: 'active',
      created: new Date().toISOString(),
      createdAt: Date.now()
    };
    if (Array.isArray(skills) && skills.length > 0) {
      entry.skills = skills;
    }
    data.agents[subId] = entry;
    saveSubAgents(deptId, data);
    log.info('Created sub-agent', {
      subId,
      name: agentName,
      task: task.substring(0, 50),
      skills: skills ? skills.join(',') : undefined
    });
    return { subId, name: agentName };
  });
}

/**
 * Build a minimal context for a sub-agent based on its skills.
 * If the sub-agent has no skills field, inherit from the parent department.
 */
function buildSubAgentContext(deptId, subAgent) {
  const skills = subAgent.skills;
  // If no skills defined, inherit parent dept skills
  const config = loadConfig();
  const dept = config.departments?.[deptId];
  const effectiveSkills = (Array.isArray(skills) && skills.length > 0)
    ? skills
    : (dept?.skills || ['*']);

  // Prefix with OPENCLAW_DEPT_ID so cmd-api.sh sends x-source-dept header
  const CMD = `OPENCLAW_DEPT_ID=${deptId} bash /root/.openclaw/workspace/skills/cmd-center/cmd-api.sh`;
  const parts = [];
  parts.push(`你是子代理「${subAgent.name}」，隶属于 ${dept?.name || deptId} 部门。`);
  parts.push(`任务: ${subAgent.task}`);

  // List available skills
  if (effectiveSkills.length === 1 && effectiveSkills[0] === '*') {
    parts.push(`\n你可以使用所有可用技能。`);
  } else {
    parts.push(`\n你可以使用的技能: ${effectiveSkills.join(', ')}`);
  }

  // Colleague list (other sub-agents in the same department)
  const subData = loadSubAgents(deptId);
  const colleagues = Object.entries(subData.agents)
    .filter(([, a]) => a.status === 'active' && a.name !== subAgent.name);
  if (colleagues.length > 0) {
    parts.push(`\n## 同事（同部门子代理）`);
    for (const [, a] of colleagues) {
      parts.push(`- ${a.name}: 任务=${a.task}`);
    }
  }

  // Escalation instructions
  parts.push(`\n## 请示上级`);
  parts.push(`如果遇到以下情况，请通过 API 请示部门负责人：`);
  parts.push(`1. 任务超出你的技能范围`);
  parts.push(`2. 需要做重要决策`);
  parts.push(`3. 需要跨部门协调`);
  parts.push(``);
  parts.push(`方式: ${CMD} POST /departments/${deptId}/chat '{"message":"[请示] 子代理${subAgent.name}请示：{具体问题}","async":true}'`);
  parts.push(``);
  parts.push(`部门负责人收到后会处理并回复。`);

  return parts.join('\n');
}

async function chatSubAgent(deptId, subId, userMessage, options = {}) {
  const traceId = options.traceId || '';
  const data = loadSubAgents(deptId);
  const agent = data.agents[subId];
  if (!agent) return { success: false, error: `Sub-agent ${subId} not found` };

  const gateway = getGateway();
  if (!gateway.isReady) return { success: false, error: 'Gateway not connected' };

  // Build context for sub-agent, sanitize user message to prevent context injection
  const ctx = buildSubAgentContext(deptId, agent);
  const sanitizedMessage = sanitizeContextTags(userMessage);
  const wrappedMessage = `<subagent_context>\n${ctx}\n</subagent_context>\n\n${sanitizedMessage}`;

  const sessionKey = `agent:main:${deptId}:sub:${subId}`;
  try {
    const startMs = Date.now();
    const result = await gateway.sendAgentMessage(sessionKey, wrappedMessage, [], { traceId });
    const durationMs = Date.now() - startMs;

    if (result.text) {
      recordChat(deptId, durationMs, false);
      if (result.usage) {
        recordTokens(deptId, result.usage);
      }
      log.info(`SubAgent chat ${deptId}/${subId} completed in ${durationMs}ms`, { traceId, deptId, subId, durationMs });
      return { success: true, reply: result.text };
    }

    recordChat(deptId, durationMs, true);
    return { success: false, error: 'Empty response' };
  } catch (err) {
    recordChat(deptId, 0, true);
    log.error(`SubAgent chat ${deptId}/${subId} error: ${err.message}`, { traceId, deptId, subId });
    return { success: false, error: err.message };
  }
}

function listSubAgents(deptId) {
  const data = loadSubAgents(deptId);
  return Object.entries(data.agents).map(([id, agent]) => ({
    id, name: agent.name, task: agent.task, status: agent.status,
  }));
}

async function removeSubAgent(deptId, subId) {
  return withFileLock(subAgentsPath(deptId), () => {
    const data = loadSubAgents(deptId);
    const agent = data.agents[subId];
    if (!agent) return false;
    const archivePath = path.join(BASE_PATH, 'departments', deptId, 'subagent-archives.json');
    let archives = [];
    try { if (fs.existsSync(archivePath)) archives = JSON.parse(fs.readFileSync(archivePath, 'utf8')); } catch (err) { log.warn('Failed to load archives', { error: err.message }); }
    archives.push({ id: subId, ...agent, archived: new Date().toISOString() });
    try { safeWriteFileSync(archivePath, JSON.stringify(archives, null, 2)); } catch (err) { log.warn('Failed to save archive', { error: err.message }); }
    delete data.agents[subId];
    saveSubAgents(deptId, data);
    log.info('Archived and removed sub-agent', { subId, name: agent.name });
    return true;
  });
}

/**
 * Archive a sub-agent (used by cleanup functions)
 */
function archiveSubAgent(deptId, subId, agent, reason) {
  try {
    const archivePath = path.join(BASE_PATH, 'departments', deptId, 'subagent-archives.json');
    let archives = [];
    try {
      if (fs.existsSync(archivePath)) {
        archives = JSON.parse(fs.readFileSync(archivePath, 'utf8'));
      }
    } catch (err) {
      log.warn('Failed to load archives for archiving', { error: err.message });
    }
    archives.push({
      id: subId,
      ...agent,
      archived: new Date().toISOString(),
      reason
    });
    safeWriteFileSync(archivePath, JSON.stringify(archives, null, 2));
  } catch (err) {
    log.error('Failed to archive sub-agent', { subId, error: err.message });
  }
}

/**
 * Cleanup expired and orphaned sub-agents across all departments.
 * Runs periodically to enforce TTL and detect orphans.
 */
function cleanupSubAgents() {
  const config = loadConfig();
  const allDeptIds = Object.keys(config.departments || {});
  const now = Date.now();
  let expiredCount = 0;
  let orphanCount = 0;

  // Scan all department directories for subagents.json files
  const deptsDir = path.join(BASE_PATH, 'departments');
  let subagentDirs = [];
  try {
    const entries = fs.readdirSync(deptsDir);
    for (const entry of entries) {
      const subagentsFile = path.join(deptsDir, entry, 'subagents.json');
      if (fs.existsSync(subagentsFile)) {
        subagentDirs.push(entry);
      }
    }
  } catch (err) {
    log.error('SubAgent cleanup failed to scan departments', { error: err.message });
    return;
  }

  for (const deptId of subagentDirs) {
    try {
      // Check if parent department still exists
      const isOrphan = !allDeptIds.includes(deptId);

      withFileLock(subAgentsPath(deptId), () => {
        const data = loadSubAgents(deptId);
        const agentEntries = Object.entries(data.agents);
        if (agentEntries.length === 0) return;

        const toRemove = [];

        for (const [subId, agent] of agentEntries) {
          if (agent.status !== 'active') continue;

          // Check for orphaned sub-agents (parent department deleted)
          if (isOrphan) {
            toRemove.push({ subId, agent, reason: 'orphan' });
            orphanCount++;
            continue;
          }

          // Check for expired sub-agents (older than TTL)
          const createdAt = agent.createdAt || 0;
          if (createdAt > 0 && (now - createdAt) > SUB_AGENT_TTL) {
            toRemove.push({ subId, agent, reason: 'expired' });
            expiredCount++;
          }
        }

        // Archive and remove all flagged sub-agents
        if (toRemove.length > 0) {
          for (const { subId, agent, reason } of toRemove) {
            archiveSubAgent(deptId, subId, agent, reason);
            delete data.agents[subId];
            log.info('SubAgent cleanup', { reason, subId, name: agent.name, deptId });
          }
          saveSubAgents(deptId, data);
        }
      });
    } catch (err) {
      log.error('SubAgent cleanup error', { deptId, error: err.message });
    }
  }

  if (expiredCount > 0 || orphanCount > 0) {
    log.info('SubAgent cleanup completed', { expiredCount, orphanCount });
  }
}

/**
 * Start periodic sub-agent cleanup (runs every hour)
 */
function startSubAgentCleanup() {
  // Run initial cleanup after 5 minutes
  const initialDelay = 5 * 60 * 1000;
  setTimeout(() => {
    log.info('Running initial SubAgent cleanup');
    cleanupSubAgents();
  }, initialDelay);

  // Then run every hour
  const interval = setInterval(() => {
    cleanupSubAgents();
  }, 60 * 60 * 1000);

  log.info('SubAgent cleanup scheduler started (runs hourly)');
  return interval;
}

// ---- Exports ----

export {
  chat, chatAsync, getChatHistory, getSessionKey,
  saveBulletin, saveMemory, clearHistory, loadMemory, loadBulletin,
  createSubAgent, chatSubAgent, listSubAgents, removeSubAgent,
  broadcastCommand,
  sanitizeContextTags,
  wrapWithContext,
  startSubAgentCleanup,
  cleanupAsyncRequest,
  handleGatewayDisconnect,
};
