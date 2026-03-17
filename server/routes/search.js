import express from 'express';
import fs from 'fs';
import path from 'path';
import { BASE_PATH } from '../utils.js';

const router = express.Router();

const DEPARTMENTS_PATH = path.join(BASE_PATH, 'departments');

/**
 * GET /search?q=keyword&scope=memory,daily,bulletin&deptId=engineering&limit=50
 */
router.get('/search', (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) {
      return res.status(400).json({ error: 'q parameter is required' });
    }

    const scopeStr = req.query.scope || 'memory,daily,bulletin,chat';
    const scopes = scopeStr.split(',').map(s => s.trim());
    const filterDept = req.query.deptId || null;
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
    const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');

    const results = [];

    // Discover departments
    let deptIds = [];
    const configPath = path.join(DEPARTMENTS_PATH, 'config.json');
    if (fs.existsSync(configPath)) {
      try {
        const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        deptIds = Object.keys(cfg.departments || {});
      } catch { /* fallback */ }
    }
    if (deptIds.length === 0) {
      try {
        deptIds = fs.readdirSync(DEPARTMENTS_PATH).filter(d => {
          const p = path.join(DEPARTMENTS_PATH, d);
          return fs.statSync(p).isDirectory() && d !== 'bulletin' && d !== 'personas';
        });
      } catch { /* empty */ }
    }

    if (filterDept) {
      deptIds = deptIds.filter(id => id === filterDept);
    }

    // Search memory
    if (scopes.includes('memory')) {
      for (const deptId of deptIds) {
        const memPath = path.join(DEPARTMENTS_PATH, deptId, 'memory', 'MEMORY.md');
        if (!fs.existsSync(memPath)) continue;
        const matches = searchFile(memPath, regex, q);
        if (matches.length > 0) {
          results.push({ type: 'memory', deptId, file: 'MEMORY.md', date: null, matches });
        }
      }
    }

    // Search daily logs (last 30 days)
    if (scopes.includes('daily')) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 30);
      const cutoffStr = cutoff.toISOString().slice(0, 10);

      for (const deptId of deptIds) {
        const dailyDir = path.join(DEPARTMENTS_PATH, deptId, 'daily');
        if (!fs.existsSync(dailyDir)) continue;

        let files;
        try { files = fs.readdirSync(dailyDir).filter(f => f.endsWith('.md')).sort().reverse(); }
        catch { continue; }

        for (const file of files) {
          const dateStr = file.replace('.md', '');
          if (dateStr < cutoffStr) break;
          const filePath = path.join(dailyDir, file);
          const matches = searchFile(filePath, regex, q);
          if (matches.length > 0) {
            results.push({ type: 'daily', deptId, file, date: dateStr, matches });
          }
        }
      }
    }

    // Search bulletin
    if (scopes.includes('bulletin')) {
      const bulletinPath = path.join(DEPARTMENTS_PATH, 'bulletin', 'board.md');
      if (fs.existsSync(bulletinPath)) {
        const matches = searchFile(bulletinPath, regex, q);
        if (matches.length > 0) {
          results.push({ type: 'bulletin', deptId: null, file: 'board.md', date: null, matches });
        }
      }
    }

    // Search chat (last 20 session files from agents/main/sessions/)
    if (scopes.includes('chat')) {
      const WORKSPACE = path.join(BASE_PATH, '..');
      const sessionsDir = path.join(WORKSPACE, 'agents', 'main', 'sessions');
      if (fs.existsSync(sessionsDir)) {
        try {
          const files = fs.readdirSync(sessionsDir)
            .filter(f => f.endsWith('.jsonl'))
            .map(f => ({
              name: f,
              path: path.join(sessionsDir, f),
              mtime: fs.statSync(path.join(sessionsDir, f)).mtime.getTime()
            }))
            .sort((a, b) => b.mtime - a.mtime)
            .slice(0, 20);

          for (const file of files) {
            const matches = searchJsonl(file.path, regex, q);
            if (matches.length > 0) {
              results.push({ type: 'chat', deptId: null, file: file.name, date: null, matches });
            }
          }
        } catch (err) {
          console.error('[Search] Chat search error:', err.message);
        }
      }
    }

    // Sort: daily (newest first) -> memory -> chat -> bulletin
    results.sort((a, b) => {
      const order = { daily: 0, memory: 1, chat: 2, bulletin: 3 };
      if (order[a.type] !== order[b.type]) return order[a.type] - order[b.type];
      if (a.date && b.date) return b.date.localeCompare(a.date);
      return 0;
    });

    res.json({ results: results.slice(0, limit), total: results.length, query: q });
  } catch (error) {
    console.error('[Search] Error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

function searchFile(filePath, regex, rawQuery) {
  let content;
  try { content = fs.readFileSync(filePath, 'utf8'); }
  catch { return []; }

  const lines = content.split('\n');
  const matches = [];

  for (let i = 0; i < lines.length; i++) {
    if (regex.test(lines[i])) {
      regex.lastIndex = 0;
      const contextLines = [];
      if (i > 0) contextLines.push(lines[i - 1]);
      contextLines.push(lines[i].replace(regex, '**$&**'));
      if (i < lines.length - 1) contextLines.push(lines[i + 1]);
      matches.push({ line: i + 1, text: contextLines.join('\n') });
      if (matches.length >= 10) break;
    }
  }
  return matches;
}

function searchJsonl(filePath, regex, rawQuery) {
  let content;
  try { content = fs.readFileSync(filePath, 'utf8'); }
  catch { return []; }

  const lines = content.split('\n').filter(Boolean);
  const matches = [];

  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      const text = obj.text || '';
      if (regex.test(text)) {
        regex.lastIndex = 0;
        const timestamp = obj.timestamp || obj.time || null;
        matches.push({
          text: text.substring(0, 200).replace(regex, '**$&**'),
          timestamp,
          file: path.basename(filePath)
        });
        if (matches.length >= 10) break;
      }
    } catch {}
  }
  return matches;
}

export default router;
