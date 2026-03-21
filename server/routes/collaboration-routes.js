import express from 'express';
import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { BASE_PATH, readJsonFile } from '../utils.js';
import { createLogger } from '../logger.js';

const log = createLogger('Collaboration');
const router = express.Router();

/**
 * GET /api/collaboration
 * Returns inter-department links for the office canvas.
 * Sources:
 *   1. Org structure: default department (COO) ↔ all others
 *   2. Bulletin requests: actual cross-department communications
 * Returns: { links: [{ from: deptId, to: deptId, label: string, type: 'org'|'request' }] }
 * Performance: Uses async I/O with Promise.all for file reads
 */
router.get('/collaboration', async (req, res) => {
  try {
    const configPath = path.join(BASE_PATH, 'departments', 'config.json');
    const config = readJsonFile(configPath) || { departments: {} };
    const deptEntries = config.departments || {};
    const deptIds = Object.keys(deptEntries);
    const links = [];
    const seen = new Set();

    const addLink = (from, to, label, type) => {
      const key = `${from}:${to}`;
      if (seen.has(key)) return;
      seen.add(key);
      links.push({ from, to, label, type });
    };

    // Only show RECENT cross-department request links (last 1 hour)
    // Old/completed requests should not show visual collaboration
    const requestsDir = path.join(BASE_PATH, 'departments', 'bulletin', 'requests');
    const ONE_HOUR_MS = 60 * 60 * 1000;
    const now = Date.now();
    if (fs.existsSync(requestsDir)) {
      // List files (sync)
      const allFiles = fs.readdirSync(requestsDir)
        .filter(f => f.endsWith('.md') && !f.startsWith('.'));

      // Parallel async stat to filter by time
      const fileStats = await Promise.all(
        allFiles.map(async (f) => {
          try {
            const stat = await fsPromises.stat(path.join(requestsDir, f));
            return { file: f, mtime: stat.mtimeMs, recent: (now - stat.mtimeMs) < ONE_HOUR_MS };
          } catch {
            return { file: f, mtime: 0, recent: false };
          }
        })
      );

      const recentFiles = fileStats.filter(fs => fs.recent).map(fs => fs.file);
      const deptIdSet = new Set(deptIds);

      // Process recent files
      for (const file of recentFiles) {
        // Parse filename pattern: from_to_date.md
        const parts = file.replace('.md', '').split('_');
        if (parts.length >= 2 && deptIdSet.has(parts[0]) && deptIdSet.has(parts[1])) {
          addLink(parts[0], parts[1], file.replace('.md', ''), 'request');
          continue;
        }
        // Fallback: scan content for dept ID mentions (only if filename parsing failed)
        try {
          const content = await fsPromises.readFile(path.join(requestsDir, file), 'utf8');
          const lowerContent = content.toLowerCase();
          for (const fromId of deptIdSet) {
            if (!lowerContent.includes(fromId)) continue;
            for (const toId of deptIdSet) {
              if (fromId === toId) continue;
              if (lowerContent.includes(toId)) {
                addLink(fromId, toId, file.replace('.md', ''), 'request');
              }
            }
          }
        } catch {
          // Skip file if read fails
        }
      }
    }

    res.json({ links });
  } catch (error) {
    log.error('Error in /api/collaboration: ' + error.message);
    res.status(500).json({ error: 'Failed to fetch collaboration data' });
  }
});

export default router;
