import express from 'express';
import fs from 'fs';
import path from 'path';
import { getChatHistory } from '../agent.js';
import { generateAndSave } from '../layout-generator.js';
import { BASE_PATH, readJsonFile, readTextFile, safeWriteFileSync, validateDepartmentId } from '../utils.js';
import { withFileLock } from '../file-lock.js';
import { recordAudit } from './audit.js';
import { createLogger } from '../logger.js';

const log = createLogger('Departments');
const router = express.Router();
const DEPT_CONFIG_PATH = path.join(BASE_PATH, 'departments', 'config.json');

// Input validation
const VALID_DATE = /^\d{4}-\d{2}-\d{2}$/;

function validateDeptId(id) {
  return validateDepartmentId(id);
}

function validateDate(date) {
  return typeof date === 'string' && VALID_DATE.test(date);
}

function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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
    log.error('Error in /api/departments: ' + error.message);
    res.status(500).json({ error: 'Failed to fetch departments' });
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
    log.error(`Error in /api/departments/${req.params.id}/persona: ` + error.message);
    res.status(500).json({ error: 'Failed to fetch persona' });
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
    log.error(`Error in /api/departments/${req.params.id}/daily: ` + error.message);
    res.status(500).json({ error: 'Failed to fetch daily log' });
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
    log.error(`Error in /api/departments/${req.params.id}/daily-dates: ` + error.message);
    res.status(500).json({ error: 'Failed to fetch daily dates' });
  }
});

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
    const result = await getChatHistory(id, 100);
    if (!result.success) {
      return res.status(503).json({ error: result.error || 'Failed to fetch chat history' });
    }
    const messages = result.messages;
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

    log.info(`Generated ${format} export for ${id}: ${filename}`);
  } catch (error) {
    log.error(`Error in POST /api/departments/${req.params.id}/export: ` + error.message);
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
  const result = await getChatHistory(id, 100);
  if (!result.success) {
    throw new Error(result.error || 'Failed to fetch chat history');
  }
  const messages = result.messages;
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
      log.info(`Emailed export for ${id} to ${to}`);
      res.json({ success: true });
    } else {
      res.status(502).json({ error: emailData.error || 'Failed to send email' });
    }
  } catch (error) {
    log.error(`Email export error for ${req.params.id}: ` + error.message);
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
      log.info(`Uploaded export for ${id} to Drive: ${driveData.fileId}`);
      res.json({ success: true, fileId: driveData.fileId, webViewLink: driveData.webViewLink });
    } else {
      res.status(502).json({ error: driveData.error || 'Failed to upload to Drive' });
    }
  } catch (error) {
    log.error(`Drive export error for ${req.params.id}: ` + error.message);
    res.status(500).json({ error: 'Failed to upload export to Drive' });
  }
});

/**
 * POST /api/departments
 * Create a new department
 * Body: { id, name, agent, icon, color, hue, telegramTopicId, order }
 */
router.post('/departments', async (req, res) => {
  try {
    await withFileLock(DEPT_CONFIG_PATH, async () => {
      const { id, name, agent, icon, color, hue, telegramTopicId, order, skills, apiGroups } = req.body;

      // H17 Fix: Use shared validation
      if (!id || !validateDeptId(id)) {
        return res.status(400).json({ success: false, error: 'Invalid department ID' });
      }
      if (!name) {
        return res.status(400).json({ success: false, error: 'Name is required' });
      }

      // Validate and sanitize text fields to prevent stored XSS
      if (typeof name !== 'string' || name.length > 100) {
        return res.status(400).json({ success: false, error: 'Name must be a string of 100 chars or less' });
      }
      if (agent !== undefined && (typeof agent !== 'string' || agent.length > 100)) {
        return res.status(400).json({ success: false, error: 'Agent must be a string of 100 chars or less' });
      }
      if (icon !== undefined && (typeof icon !== 'string' || icon.length > 50 || !/^[a-zA-Z0-9_-]+$/.test(icon))) {
        return res.status(400).json({ success: false, error: 'Icon must be alphanumeric (max 50 chars)' });
      }
      if (color !== undefined && (typeof color !== 'string' || !/^#[0-9a-fA-F]{3,8}$/.test(color))) {
        return res.status(400).json({ success: false, error: 'Color must be a valid hex color (e.g. #94a3b8)' });
      }
      if (hue !== undefined && (typeof hue !== 'number' || !Number.isFinite(hue) || hue < 0 || hue > 360)) {
        return res.status(400).json({ success: false, error: 'Hue must be a number between 0 and 360' });
      }
      if (order !== undefined && (typeof order !== 'number' || !Number.isFinite(order) || order < 0 || order > 999)) {
        return res.status(400).json({ success: false, error: 'Order must be a number between 0 and 999' });
      }
      const safeName = escapeHtml(name);
      const safeAgent = escapeHtml(agent || name);

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

      // Check telegram topic ID uniqueness
      if (telegramTopicId !== undefined && telegramTopicId !== null) {
        const existingDeptWithTopic = Object.entries(config.departments).find(
          ([deptId, dept]) => dept.telegramTopicId === telegramTopicId
        );
        if (existingDeptWithTopic) {
          return res.status(409).json({
            success: false,
            error: `Telegram topic ID ${telegramTopicId} is already used by department: ${existingDeptWithTopic[0]}`
          });
        }
      }

      config.departments[id] = {
        name: safeName,
        agent: safeAgent,
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

      // Create default persona file
      const personaDir = path.join(BASE_PATH, 'departments', 'personas');
      if (!fs.existsSync(personaDir)) {
        fs.mkdirSync(personaDir, { recursive: true });
      }
      const personaPath = path.join(personaDir, `${id}.md`);
      if (!fs.existsSync(personaPath)) {
        const defaultPersona = `# ${name} 部门人设

## 角色定位
${agent || name}

## 职责范围
- 待补充

## 工作风格
- 待补充

## 技能专长
${Array.isArray(skills) && skills.length > 0 ? skills.map(s => `- ${s}`).join('\n') : '- 待补充'}
`;
        safeWriteFileSync(personaPath, defaultPersona);
        log.info(`Created default persona file: ${personaPath}`);
      }

      // Rebuild layout with new department
      try {
        generateAndSave();
        log.info(`Auto-rebuilt layout after creating department: ${id}`);
      } catch (layoutError) {
        log.error('Layout auto-rebuild failed: ' + layoutError.message);
      }

      recordAudit({ action: 'dept:create', target: id, details: { name }, ip: req.ip });
      res.json({ success: true, department: { id, ...config.departments[id] } });
    });
  } catch (error) {
    log.error('Error in POST /api/departments: ' + error.message);
    res.status(500).json({ success: false, error: 'Failed to create department' });
  }
});

/**
 * PUT /api/departments/:id
 * Update an existing department
 * Body: { name, agent, icon, color, hue, telegramTopicId, order }
 */
router.put('/departments/:id', async (req, res) => {
  try {
    await withFileLock(DEPT_CONFIG_PATH, async () => {
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

      // Check telegram topic ID uniqueness (if changing)
      if (telegramTopicId !== undefined && telegramTopicId !== null) {
        const currentTopicId = config.departments[id].telegramTopicId;
        if (telegramTopicId !== currentTopicId) {
          const existingDeptWithTopic = Object.entries(config.departments).find(
            ([deptId, dept]) => deptId !== id && dept.telegramTopicId === telegramTopicId
          );
          if (existingDeptWithTopic) {
            return res.status(409).json({
              success: false,
              error: `Telegram topic ID ${telegramTopicId} is already used by department: ${existingDeptWithTopic[0]}`
            });
          }
        }
      }

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
          log.info(`Auto-rebuilt layout after updating department: ${id}`);
        } catch (layoutError) {
          log.error('Layout auto-rebuild failed: ' + layoutError.message);
        }
      }

      recordAudit({ action: 'dept:update', target: id, details: req.body, ip: req.ip });
      res.json({ success: true, department: { id, ...config.departments[id] } });
    });
  } catch (error) {
    log.error(`Error in PUT /api/departments/${req.params.id}: ` + error.message);
    res.status(500).json({ success: false, error: 'Failed to update department' });
  }
});

/**
 * DELETE /api/departments/:id
 * Delete a department and clean up all associated files
 */
router.delete('/departments/:id', async (req, res) => {
  try {
    await withFileLock(DEPT_CONFIG_PATH, async () => {
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

      // Clean up department directory (contains memory, daily, subagents, etc.)
      const deptDir = path.join(BASE_PATH, 'departments', id);
      if (fs.existsSync(deptDir)) {
        try {
          fs.rmSync(deptDir, { recursive: true, force: true });
          log.info(`Removed department directory: ${deptDir}`);
        } catch (cleanupError) {
          log.error(`Failed to remove department directory ${deptDir}: ${cleanupError.message}`);
        }
      }

      // Clean up persona file
      const personaPath = path.join(BASE_PATH, 'departments', 'personas', `${id}.md`);
      if (fs.existsSync(personaPath)) {
        try {
          fs.unlinkSync(personaPath);
          log.info(`Removed persona file: ${personaPath}`);
        } catch (cleanupError) {
          log.error(`Failed to remove persona file ${personaPath}: ${cleanupError.message}`);
        }
      }

      // Rebuild layout after department deletion
      try {
        generateAndSave();
        log.info(`Auto-rebuilt layout after deleting department: ${id}`);
      } catch (layoutError) {
        log.error('Layout auto-rebuild failed: ' + layoutError.message);
      }

      recordAudit({ action: 'dept:delete', target: id, ip: req.ip });
      res.json({ success: true });
    });
  } catch (error) {
    log.error(`Error in DELETE /api/departments/${req.params.id}: ` + error.message);
    res.status(500).json({ success: false, error: 'Failed to delete department' });
  }
});

export default router;
