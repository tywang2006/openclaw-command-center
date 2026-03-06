import fs from 'fs';
import path from 'path';
import { getGateway } from './gateway.js';

const BASE_PATH = '/root/.openclaw/workspace';

// Sub-agent persistence helpers
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

/**
 * Append a chat exchange to daily log
 */
function appendDailyLog(deptId, userMsg, agentReply, source = 'app') {
  const today = new Date().toISOString().split('T')[0];
  const time = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  const dailyDir = path.join(BASE_PATH, 'departments', deptId, 'daily');
  const dailyPath = path.join(dailyDir, `${today}.md`);

  try {
    if (!fs.existsSync(dailyDir)) {
      fs.mkdirSync(dailyDir, { recursive: true });
    }

    let content = '';
    if (!fs.existsSync(dailyPath)) {
      content += `# ${deptId} 日志 - ${today}\n\n`;
    }
    content += `## ${time} [${source}]\n`;
    content += `**用户**: ${userMsg}\n\n`;
    content += `**回复**: ${agentReply}\n\n---\n\n`;

    fs.appendFileSync(dailyPath, content, 'utf8');
  } catch (err) {
    console.error(`[Agent] Failed to write daily log for ${deptId}:`, err.message);
  }
}

/**
 * Load department persona from file
 */
function loadPersona(deptId) {
  const personaPath = path.join(BASE_PATH, 'departments', 'personas', `${deptId}.md`);
  try {
    if (fs.existsSync(personaPath)) {
      return fs.readFileSync(personaPath, 'utf8');
    }
  } catch {}
  return `你是 ${deptId} 部门的 AI 代理。`;
}

/**
 * Load department memory
 */
function loadMemory(deptId) {
  const memPath = path.join(BASE_PATH, 'departments', deptId, 'memory', 'MEMORY.md');
  try {
    if (fs.existsSync(memPath)) {
      return fs.readFileSync(memPath, 'utf8');
    }
  } catch {}
  return '';
}

/**
 * Load bulletin board
 */
function loadBulletin() {
  const bPath = path.join(BASE_PATH, 'departments', 'bulletin', 'board.md');
  try {
    if (fs.existsSync(bPath)) {
      return fs.readFileSync(bPath, 'utf8');
    }
  } catch {}
  return '';
}

/**
 * Build department context to include in gateway messages.
 * This gives the OpenClaw agent awareness of which department it is acting as.
 */
function buildDepartmentContext(deptId) {
  const persona = loadPersona(deptId);
  const memory = loadMemory(deptId);
  const bulletin = loadBulletin();

  const personaSnippet = persona.split('\n').slice(0, 20).join('\n');
  const memorySnippet = memory ? memory.substring(0, 1000) : '(暂无记忆)';
  const bulletinSnippet = bulletin ? bulletin.substring(0, 600) : '(暂无公告)';

  return `[部门角色指令]
${personaSnippet}

[你的记忆]
${memorySnippet}

[公告板]
${bulletinSnippet}

[规则]
- 你是一人公司 OpenClaw 的一个部门 AI 代理
- 老板（用户）直接跟你对话，你要认真回复
- 回复要简洁专业，符合你的部门角色
- 用中文回复
- 如果老板分配了任务，确认收到并说明计划`;
}

/**
 * Chat with a department agent via OpenClaw Gateway
 */
async function chat(deptId, userMessage) {
  const gateway = getGateway();

  if (!gateway.isReady) {
    try {
      await gateway.waitForReady(5000);
    } catch {
      return { success: false, error: 'Gateway 未连接，请稍后重试' };
    }
  }

  const sessionKey = `agent:main:${deptId}`;
  const context = buildDepartmentContext(deptId);
  const fullMessage = `${context}\n---\n${userMessage}`;

  try {
    const result = await gateway.sendAgentMessage(sessionKey, fullMessage);

    if (result.text) {
      appendDailyLog(deptId, userMessage, result.text, 'chat');
      return { success: true, reply: result.text };
    }
    return { success: false, error: 'Gateway 返回空响应' };
  } catch (err) {
    console.error(`[Agent] Chat ${deptId} error:`, err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Save bulletin content to file
 */
function saveBulletin(content) {
  const bPath = path.join(BASE_PATH, 'departments', 'bulletin', 'board.md');
  try {
    fs.writeFileSync(bPath, content, 'utf8');
    return true;
  } catch (err) {
    console.error('[Agent] Failed to save bulletin:', err.message);
    return false;
  }
}

/**
 * Broadcast a command to all departments via Gateway.
 * Each department agent reads the command and responds with their plan.
 * Uses parallel execution with Promise.allSettled for efficiency.
 */
async function broadcastCommand(command) {
  const configPath = path.join(BASE_PATH, 'departments', 'config.json');
  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    return [];
  }

  const gateway = getGateway();
  if (!gateway.isReady) {
    try {
      await gateway.waitForReady(5000);
    } catch {
      return [];
    }
  }

  const departments = Object.values(config.departments || {});

  // Create parallel tasks for all departments
  const broadcastTasks = departments.map(async (dept) => {
    const deptId = dept.id;
    const sessionKey = `agent:main:${deptId}`;
    const context = buildDepartmentContext(deptId);

    const broadcastMessage = `${context}

---
# 全公司广播命令
老板刚刚向全公司发布了以下命令。你必须：
1. 确认收到
2. 说明你的部门将如何执行
3. 列出具体行动计划
4. 预估完成时间

这是军事化管理的公司，服从命令，高效执行。
---
[全公司广播] ${command}`;

    try {
      const result = await gateway.sendAgentMessage(sessionKey, broadcastMessage);
      const reply = result.text || '[Error] 空响应';
      appendDailyLog(deptId, `[全公司广播] ${command}`, reply, 'broadcast');
      return { deptId, name: dept.name, reply };
    } catch (err) {
      const errReply = `[Error] ${err.message}`;
      appendDailyLog(deptId, `[全公司广播] ${command}`, errReply, 'broadcast');
      return { deptId, name: dept.name, reply: errReply };
    }
  });

  // Execute all broadcasts in parallel
  const results = await Promise.allSettled(broadcastTasks);

  // Extract responses from settled promises
  const responses = results.map((result, idx) => {
    if (result.status === 'fulfilled') {
      return result.value;
    } else {
      // Handle unexpected promise rejection
      const dept = departments[idx];
      const errReply = `[Error] Promise rejected: ${result.reason?.message || 'Unknown error'}`;
      return { deptId: dept.id, name: dept.name, reply: errReply };
    }
  });

  return responses;
}

/**
 * Save memory for a department
 */
function saveMemory(deptId, content) {
  const memPath = path.join(BASE_PATH, 'departments', deptId, 'memory', 'MEMORY.md');
  try {
    fs.writeFileSync(memPath, content, 'utf8');
    return true;
  } catch (err) {
    console.error('[Agent] Failed to save memory:', err.message);
    return false;
  }
}

/**
 * Clear conversation history for a department.
 * Conversation history is now managed by the gateway via session keys.
 */
function clearHistory(deptId) {
  console.log(`[Agent] History clear requested for ${deptId} (managed by gateway)`);
}

/**
 * Create a sub-agent for a department to handle a specific task
 */
function createSubAgent(deptId, task, name) {
  const data = loadSubAgents(deptId);
  data.count++;
  const subId = `${deptId}-sub-${data.count}`;
  const agentName = name || `子代理 #${data.count}`;

  data.agents[subId] = {
    name: agentName,
    task,
    status: 'active',
    created: new Date().toISOString(),
  };

  saveSubAgents(deptId, data);
  console.log(`[SubAgent] Created ${subId} "${agentName}" for "${task.substring(0, 50)}"`);
  return { subId, name: agentName };
}

/**
 * Chat with a specific sub-agent via Gateway
 */
async function chatSubAgent(deptId, subId, userMessage) {
  const data = loadSubAgents(deptId);
  const agent = data.agents[subId];
  if (!agent) return { success: false, error: `Sub-agent ${subId} not found` };

  const gateway = getGateway();
  if (!gateway.isReady) {
    return { success: false, error: 'Gateway 未连接' };
  }

  const sessionKey = `agent:main:${deptId}:sub:${subId}`;
  const persona = loadPersona(deptId);
  const personaSnippet = persona.split('\n').slice(0, 8).join('\n');

  const fullMessage = `[子代理模式]
部门: ${deptId}
子代理名称: ${agent.name}
任务: ${agent.task}

${personaSnippet}

回复要简洁专业，围绕你的任务。用中文回复。
---
${userMessage}`;

  try {
    const result = await gateway.sendAgentMessage(sessionKey, fullMessage);
    if (result.text) {
      appendDailyLog(deptId, `[${agent.name}] ${userMessage}`, result.text, `sub:${subId}`);
      return { success: true, reply: result.text };
    }
    return { success: false, error: '空响应' };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * List sub-agents for a department
 */
function listSubAgents(deptId) {
  const data = loadSubAgents(deptId);
  return Object.entries(data.agents).map(([id, agent]) => ({
    id,
    name: agent.name,
    task: agent.task,
    status: agent.status,
  }));
}

/**
 * Remove a sub-agent — archive its metadata before deleting
 */
function removeSubAgent(deptId, subId) {
  const data = loadSubAgents(deptId);
  const agent = data.agents[subId];
  if (!agent) return false;

  // Archive to subagent-archives.json
  const archivePath = path.join(BASE_PATH, 'departments', deptId, 'subagent-archives.json');
  let archives = [];
  try {
    if (fs.existsSync(archivePath)) {
      archives = JSON.parse(fs.readFileSync(archivePath, 'utf8'));
    }
  } catch {}

  archives.push({
    id: subId,
    name: agent.name,
    task: agent.task,
    status: agent.status,
    created: agent.created || null,
    archived: new Date().toISOString(),
  });

  try {
    fs.writeFileSync(archivePath, JSON.stringify(archives, null, 2), 'utf8');
  } catch (err) {
    console.error(`[SubAgent] Failed to archive ${subId}:`, err.message);
  }

  // Remove from active list
  delete data.agents[subId];
  saveSubAgents(deptId, data);
  console.log(`[SubAgent] Archived and removed ${subId} "${agent.name}"`);
  return true;
}

export {
  chat, saveBulletin, saveMemory, clearHistory, loadMemory, loadBulletin,
  createSubAgent, chatSubAgent, listSubAgents, removeSubAgent,
  broadcastCommand, appendDailyLog,
};
