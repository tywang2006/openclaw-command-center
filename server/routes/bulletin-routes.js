import express from 'express';
import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { loadBulletin, saveBulletin } from '../agent.js';
import { BASE_PATH, readTextFile } from '../utils.js';
import { recordAudit } from './audit.js';
import { createLogger } from '../logger.js';

const log = createLogger('Bulletin');
const router = express.Router();

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

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
    log.error('Error in /api/bulletin: ' + error.message);
    res.status(500).json({ error: 'Failed to fetch bulletin' });
  }
});

/**
 * POST /api/bulletin
 * Update the bulletin board
 * Body: { content: "markdown content" }
 * C3 Fix: Only COO or human (no x-source-dept) can post bulletins
 */
router.post('/bulletin', (req, res) => {
  try {
    // C3 Fix: Only COO or human (no x-source-dept) can post bulletins
    const sourceDept = req.headers['x-source-dept'];
    if (sourceDept && sourceDept !== 'coo') {
      return res.status(403).json({ error: 'Only COO department can post to bulletin board' });
    }

    const { content } = req.body;
    if (content === undefined || typeof content !== 'string') {
      return res.status(400).json({ error: 'Content must be a string' });
    }
    const bulletinSize = Buffer.byteLength(content, 'utf8');
    if (bulletinSize > 102400) {
      return res.status(413).json({
        error: `Bulletin content too large: ${(bulletinSize / 1024).toFixed(2)} KB exceeds 100 KB limit`
      });
    }
    const success = saveBulletin(content);
    recordAudit({ action: 'bulletin:update', target: 'board', ip: req.ip });
    res.json({ success });
  } catch (error) {
    log.error('Error in POST /api/bulletin: ' + error.message);
    res.status(500).json({ error: 'Failed to update bulletin' });
  }
});

/**
 * GET /api/requests?page=1&pageSize=50
 * List all files in bulletin/requests/ and return their contents
 * Performance: Uses async I/O with Promise.all + pagination
 */
router.get('/requests', async (req, res) => {
  try {
    const requestsDir = path.join(BASE_PATH, 'departments', 'bulletin', 'requests');

    if (!fs.existsSync(requestsDir)) {
      return res.json({ requests: [], total: 0, page: 1, pageSize: DEFAULT_PAGE_SIZE, totalPages: 0 });
    }

    // Parse pagination params
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(req.query.pageSize) || DEFAULT_PAGE_SIZE));

    // List files (sync is acceptable for directory listing, bottleneck is file reads)
    const allFiles = fs.readdirSync(requestsDir)
      .filter(file => file.endsWith('.md') && !file.startsWith('.deleted') && !file.startsWith('.bak'));

    const total = allFiles.length;
    const totalPages = Math.ceil(total / pageSize);
    const startIdx = (page - 1) * pageSize;
    const endIdx = startIdx + pageSize;
    const pageFiles = allFiles.slice(startIdx, endIdx);

    // Parallel async I/O for file reads
    const requests = await Promise.all(
      pageFiles.map(async (file) => {
        const filePath = path.join(requestsDir, file);
        const [content, stats] = await Promise.all([
          fsPromises.readFile(filePath, 'utf8').catch(() => ''),
          fsPromises.stat(filePath).catch(() => ({ birthtime: new Date(), mtime: new Date() }))
        ]);

        return {
          filename: file,
          content,
          created: stats.birthtime.toISOString(),
          modified: stats.mtime.toISOString()
        };
      })
    );

    res.json({ requests, total, page, pageSize, totalPages });
  } catch (error) {
    log.error('Error in /api/requests: ' + error.message);
    res.status(500).json({ error: 'Failed to fetch requests' });
  }
});

/**
 * POST /api/requests/:filename/:action
 * Approve or deny a bulletin request
 * Moves file to approved/ or denied/ subdirectory
 */
router.post('/requests/:filename/:action', async (req, res) => {
  try {
    const { filename, action } = req.params;

    // Validate action
    if (action !== 'approve' && action !== 'deny') {
      return res.status(400).json({ error: 'Action must be "approve" or "deny"' });
    }

    // Validate filename (security: prevent path traversal, ensure .md extension)
    if (!filename.endsWith('.md') || filename.includes('/') || filename.includes('\\') || filename.startsWith('.')) {
      return res.status(400).json({ error: 'Invalid filename' });
    }

    const requestsDir = path.join(BASE_PATH, 'departments', 'bulletin', 'requests');
    const sourceFile = path.join(requestsDir, filename);

    // Check file exists
    if (!fs.existsSync(sourceFile)) {
      return res.status(404).json({ error: 'Request file not found' });
    }

    // Determine target directory
    const targetDir = path.join(requestsDir, action === 'approve' ? 'approved' : 'denied');
    const targetFile = path.join(targetDir, filename);

    // Create target directory if it doesn't exist
    await fsPromises.mkdir(targetDir, { recursive: true });

    // Move file to target directory
    await fsPromises.rename(sourceFile, targetFile);

    // Record audit entry
    recordAudit({
      action: `bulletin:request-${action}`,
      target: filename,
      ip: req.ip,
      details: { action, filename }
    });

    log.info(`Bulletin request ${action}d: ${filename}`);

    res.json({
      success: true,
      action,
      filename
    });
  } catch (error) {
    log.error(`Error in POST /api/requests/:filename/:action: ${error.message}`);
    res.status(500).json({ error: `Failed to ${req.params.action} request` });
  }
});

export default router;
