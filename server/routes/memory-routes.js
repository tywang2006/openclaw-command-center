import express from 'express';
import fs from 'fs';
import path from 'path';
import { loadMemory, saveMemory, sanitizeContextTags } from '../agent.js';
import { BASE_PATH, readTextFile, validateDepartmentId } from '../utils.js';
import { recordAudit } from './audit.js';
import { createLogger } from '../logger.js';

const log = createLogger('Memory');
const router = express.Router();

function validateDeptId(id) {
  return validateDepartmentId(id);
}

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
    log.error(`Error in /api/departments/${req.params.id}/memory: ` + error.message);
    res.status(500).json({ error: 'Failed to fetch department memory' });
  }
});

/**
 * PUT /api/departments/:id/memory
 * Update department's MEMORY.md content
 * Body: { content: "markdown content" }
 * C3 Fix: Cross-department memory write restriction
 */
router.put('/departments/:id/memory', (req, res) => {
  try {
    const { id } = req.params;
    if (!validateDeptId(id)) {
      return res.status(400).json({ error: 'Invalid department ID' });
    }

    // C3 Fix: Cross-department memory write restriction
    const sourceDept = req.headers['x-source-dept'];
    if (sourceDept && sourceDept !== id && sourceDept !== 'coo') {
      return res.status(403).json({ error: 'Cross-department memory write not allowed. Only COO can write to other departments.' });
    }

    const { content } = req.body;
    if (content === undefined || typeof content !== 'string') {
      return res.status(400).json({ error: 'Content must be a string' });
    }
    // C8 Fix: Sanitize memory content to prevent context tag injection
    const safeContent = sanitizeContextTags(content);
    const size = Buffer.byteLength(safeContent, 'utf8');
    if (size > 51200) {
      return res.status(413).json({
        error: `Memory content too large: ${(size / 1024).toFixed(2)} KB exceeds 50 KB limit`
      });
    }
    const success = saveMemory(id, safeContent);
    recordAudit({ action: 'memory:update', target: id, deptId: id, ip: req.ip });
    res.json({ success, departmentId: id });
  } catch (error) {
    log.error(`Error in PUT /api/departments/${req.params.id}/memory: ` + error.message);
    res.status(500).json({ error: 'Failed to save department memory' });
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
    log.error(`Error in /api/departments/${req.params.id}/memory/history: ` + error.message);
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
    if (!filename.endsWith('.md.bak') || filename.includes('..') || filename.includes('/') || filename.includes('\\') || filename.includes('\0')) {
      return res.status(400).json({ error: 'Invalid filename' });
    }
    const expectedDir = path.resolve(path.join(BASE_PATH, 'departments', id, 'memory'));
    const filePath = path.resolve(path.join(expectedDir, filename));
    if (!filePath.startsWith(expectedDir + path.sep)) {
      return res.status(400).json({ error: 'Invalid filename' });
    }
    const content = readTextFile(filePath);
    res.json({ content, filename, exists: fs.existsSync(filePath) });
  } catch (error) {
    log.error(`Error in /api/departments/${req.params.id}/memory/history: ` + error.message);
    res.status(500).json({ error: 'Failed to fetch memory version' });
  }
});

export default router;
