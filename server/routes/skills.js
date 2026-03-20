import express from 'express';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { BASE_PATH, readJsonFile, readTextFile, parseFrontmatter, safeWriteFileSync } from '../utils.js';
import { recordAudit } from './audit.js';
import { createLogger } from '../logger.js';

const log = createLogger('Skills');
const router = express.Router();

const SKILLS_PATH = path.join(BASE_PATH, 'skills');

/**
 * Escape a string for safe inclusion as a YAML frontmatter value.
 * Wraps in double quotes and escapes backslashes, double quotes, and newlines
 * to prevent YAML injection (e.g. "test\nmalicious_key: value").
 */
function yamlEscape(str) {
  if (!str) return '""';
  return '"' + str.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"';
}

/**
 * Helper: Get skill data from a directory
 */
function getSkillData(skillDir, slug) {
  const skillPath = path.join(SKILLS_PATH, skillDir);
  const skillMdPath = path.join(skillPath, 'SKILL.md');
  const metaPath = path.join(skillPath, '_meta.json');
  const assetsPath = path.join(skillPath, 'assets');

  // Read SKILL.md
  const skillContent = readTextFile(skillMdPath);
  if (!skillContent) {
    return null;
  }

  // Parse frontmatter
  const { frontmatter, body } = parseFrontmatter(skillContent);

  // Read _meta.json
  const meta = readJsonFile(metaPath);

  // Check for assets directory
  const hasAssets = fs.existsSync(assetsPath) && fs.statSync(assetsPath).isDirectory();

  return {
    slug: slug || skillDir,
    name: frontmatter.name || skillDir,
    summary: frontmatter.summary || null,
    description: frontmatter.description || null,
    tags: frontmatter.tags || [],
    version: meta?.version || frontmatter.version || null,
    hasAssets,
    meta: meta || {},
    body: body || null
  };
}

/**
 * GET /api/skills
 * List all skills with summary information
 */
router.get('/skills', (req, res) => {
  try {
    if (!fs.existsSync(SKILLS_PATH)) {
      return res.json({ skills: [], count: 0 });
    }

    // Read all directories in skills path
    const entries = fs.readdirSync(SKILLS_PATH, { withFileTypes: true });
    const skillDirs = entries
      .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
      .map(entry => entry.name);

    // Get skill data for each directory
    const skills = [];
    for (const skillDir of skillDirs) {
      const skillData = getSkillData(skillDir, skillDir);
      if (skillData) {
        // Return summary info only (no body)
        skills.push({
          slug: skillData.slug,
          name: skillData.name,
          summary: skillData.summary,
          description: skillData.description,
          tags: skillData.tags,
          version: skillData.version,
          hasAssets: skillData.hasAssets,
          ownerId: skillData.meta.ownerId || null,
          publishedAt: skillData.meta.publishedAt || null
        });
      }
    }

    // Sort by name
    skills.sort((a, b) => a.name.localeCompare(b.name));

    res.json({
      skills,
      count: skills.length,
      lastUpdated: new Date().toISOString()
    });
  } catch (error) {
    log.error(`Error in GET /api/skills: ${error.message}`);
    res.status(500).json({ error: 'Failed to fetch skills' });
  }
});

/**
 * GET /api/skills/:slug
 * Get full skill details including markdown body
 */
router.get('/skills/:slug', (req, res) => {
  try {
    const { slug } = req.params;

    // Validate slug (alphanumeric, hyphens, underscores only)
    if (!/^[a-z0-9_-]+$/i.test(slug)) {
      return res.status(400).json({ error: 'Invalid skill slug' });
    }

    const skillPath = path.join(SKILLS_PATH, slug);

    // Check if skill directory exists
    if (!fs.existsSync(skillPath) || !fs.statSync(skillPath).isDirectory()) {
      return res.status(404).json({ error: 'Skill not found' });
    }

    // Get full skill data
    const skillData = getSkillData(slug, slug);

    if (!skillData) {
      return res.status(404).json({ error: 'Skill data not found' });
    }

    // Return full skill details
    res.json({
      skill: {
        slug: skillData.slug,
        name: skillData.name,
        summary: skillData.summary,
        description: skillData.description,
        tags: skillData.tags,
        version: skillData.version,
        hasAssets: skillData.hasAssets,
        ownerId: skillData.meta.ownerId || null,
        publishedAt: skillData.meta.publishedAt || null,
        markdown: skillData.body,
        meta: skillData.meta
      }
    });
  } catch (error) {
    log.error(`Error in GET /api/skills/${req.params.slug}: ${error.message}`);
    res.status(500).json({ error: 'Failed to fetch skill details' });
  }
});

/**
 * GET /api/skills/:slug/assets
 * List assets for a specific skill
 */
router.get('/skills/:slug/assets', (req, res) => {
  try {
    const { slug } = req.params;

    // Validate slug
    if (!/^[a-z0-9_-]+$/i.test(slug)) {
      return res.status(400).json({ error: 'Invalid skill slug' });
    }

    const assetsPath = path.join(SKILLS_PATH, slug, 'assets');

    // Check if assets directory exists
    if (!fs.existsSync(assetsPath) || !fs.statSync(assetsPath).isDirectory()) {
      return res.json({ assets: [], count: 0 });
    }

    // List all files in assets directory
    const files = fs.readdirSync(assetsPath, { withFileTypes: true });
    const assets = files
      .filter(file => file.isFile() && !file.name.startsWith('.'))
      .map(file => {
        const filePath = path.join(assetsPath, file.name);
        const stats = fs.statSync(filePath);
        return {
          name: file.name,
          size: stats.size,
          modified: stats.mtime.toISOString()
        };
      });

    res.json({
      slug,
      assets,
      count: assets.length
    });
  } catch (error) {
    log.error(`Error in GET /api/skills/${req.params.slug}/assets: ${error.message}`);
    res.status(500).json({ error: 'Failed to fetch skill assets' });
  }
});

/**
 * POST /api/skills/:slug/execute
 * Execute a skill by sending it to a department agent via the Gateway.
 * Body: { deptId: string, params?: Record<string, string> }
 */
router.post('/skills/:slug/execute', async (req, res) => {
  try {
    const { slug } = req.params;
    const { deptId, params } = req.body;

    if (!/^[a-z0-9_-]+$/i.test(slug)) {
      return res.status(400).json({ error: 'Invalid skill slug' });
    }
    if (!deptId || typeof deptId !== 'string') {
      return res.status(400).json({ error: 'deptId is required' });
    }

    const skillPath = path.join(SKILLS_PATH, slug);
    if (!fs.existsSync(skillPath) || !fs.statSync(skillPath).isDirectory()) {
      return res.status(404).json({ error: 'Skill not found' });
    }

    const skillData = getSkillData(slug, slug);
    if (!skillData) {
      return res.status(404).json({ error: 'Skill data not found' });
    }

    // Build the execution message
    let message = `Execute skill: ${skillData.name}`;
    if (skillData.summary) {
      message += `\nDescription: ${skillData.summary}`;
    }
    if (params && typeof params === 'object') {
      const paramLines = Object.entries(params)
        .filter(([, v]) => v !== undefined && v !== '')
        .map(([k, v]) => `  ${k}: ${v}`);
      if (paramLines.length > 0) {
        message += `\nParameters:\n${paramLines.join('\n')}`;
      }
    }
    if (skillData.body) {
      message += `\n\nSkill instructions:\n${skillData.body}`;
    }

    // Send through the Gateway via agent.js chat function
    const { chat } = await import('../agent.js');
    const result = await chat(deptId, message, null, { traceId: req.traceId });

    recordAudit({ action: 'skill:execute', target: slug, deptId, details: { success: result.success }, ip: req.ip });

    if (result.success) {
      res.json({
        success: true,
        skill: slug,
        deptId,
        reply: result.reply,
      });
    } else {
      res.json({
        success: false,
        skill: slug,
        deptId,
        error: result.error || 'Skill execution failed',
      });
    }
  } catch (error) {
    log.error(`Error in POST /api/skills/${req.params.slug}/execute: ${error.message}`);
    res.status(500).json({ error: 'Failed to execute skill' });
  }
});

/**
 * POST /api/skills
 * Create a new custom skill
 */
router.post('/skills', (req, res) => {
  try {
    // C15 Fix: Only human operators can create skills
    const sourceDept = req.headers['x-source-dept'];
    if (sourceDept) {
      return res.status(403).json({ error: 'AI agents cannot create or modify skills. Ask a human operator.' });
    }

    const { slug, name, summary, description, tags, content } = req.body;

    // Validate slug
    if (!slug || !/^[a-z0-9][a-z0-9_-]*$/.test(slug)) {
      return res.status(400).json({ error: 'Invalid slug: lowercase letters, numbers, hyphens only' });
    }
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'name is required' });
    }

    const skillPath = path.join(SKILLS_PATH, slug);
    if (fs.existsSync(skillPath)) {
      return res.status(409).json({ error: `Skill "${slug}" already exists` });
    }

    // Build SKILL.md with frontmatter (values escaped to prevent YAML injection)
    const fmLines = [`---`, `name: ${yamlEscape(name)}`];
    if (summary) fmLines.push(`summary: ${yamlEscape(summary)}`);
    if (description) fmLines.push(`description: ${yamlEscape(description)}`);
    if (tags) {
      const tagList = Array.isArray(tags) ? tags : tags.split(',').map(t => t.trim()).filter(Boolean);
      fmLines.push(`tags: [${tagList.map(t => yamlEscape(t)).join(', ')}]`);
    }
    fmLines.push(`---`);
    const skillMd = fmLines.join('\n') + '\n\n' + (content || '');

    // Create directory and files
    fs.mkdirSync(skillPath, { recursive: true });
    safeWriteFileSync(path.join(skillPath, 'SKILL.md'), skillMd);
    safeWriteFileSync(path.join(skillPath, '_meta.json'), JSON.stringify({
      ownerId: 'local',
      publishedAt: new Date().toISOString(),
      version: '0.1.0'
    }, null, 2));

    recordAudit({ action: 'skill:create', target: slug, details: { name }, ip: req.ip });
    res.json({ success: true, slug });
  } catch (error) {
    log.error(`Error in POST /api/skills: ${error.message}`);
    res.status(500).json({ error: 'Failed to create skill' });
  }
});

/**
 * PUT /api/skills/:slug
 * Edit an existing skill
 */
router.put('/skills/:slug', (req, res) => {
  try {
    const { slug } = req.params;
    if (!/^[a-z0-9_-]+$/i.test(slug)) {
      return res.status(400).json({ error: 'Invalid skill slug' });
    }

    const skillPath = path.join(SKILLS_PATH, slug);
    const skillMdPath = path.join(skillPath, 'SKILL.md');
    if (!fs.existsSync(skillMdPath)) {
      return res.status(404).json({ error: 'Skill not found' });
    }

    // Read existing
    const existing = readTextFile(skillMdPath);
    const { frontmatter: fm, body: oldBody } = parseFrontmatter(existing);

    // Merge fields
    const { name, summary, description, tags, content } = req.body;
    if (name !== undefined) fm.name = name;
    if (summary !== undefined) fm.summary = summary;
    if (description !== undefined) fm.description = description;
    if (tags !== undefined) {
      fm.tags = Array.isArray(tags) ? tags : tags.split(',').map(t => t.trim()).filter(Boolean);
    }

    // Rebuild SKILL.md (string values escaped to prevent YAML injection)
    const fmLines = [`---`];
    for (const [k, v] of Object.entries(fm)) {
      if (v === null || v === undefined) continue;
      if (Array.isArray(v)) {
        fmLines.push(`${k}: [${v.map(item => yamlEscape(String(item))).join(', ')}]`);
      } else {
        fmLines.push(`${k}: ${yamlEscape(String(v))}`);
      }
    }
    fmLines.push(`---`);
    const newBody = content !== undefined ? content : oldBody;
    safeWriteFileSync(skillMdPath, fmLines.join('\n') + '\n\n' + (newBody || ''));

    recordAudit({ action: 'skill:update', target: slug, details: { fields: Object.keys(req.body) }, ip: req.ip });
    res.json({ success: true, slug });
  } catch (error) {
    log.error(`Error in PUT /api/skills/${req.params.slug}: ${error.message}`);
    res.status(500).json({ error: 'Failed to update skill' });
  }
});

/**
 * DELETE /api/skills/:slug
 * Delete a skill
 */
router.delete('/skills/:slug', (req, res) => {
  try {
    // C15 Fix: Only human operators can delete skills
    const sourceDept = req.headers['x-source-dept'];
    if (sourceDept) {
      return res.status(403).json({ error: 'AI agents cannot create or modify skills. Ask a human operator.' });
    }

    const { slug } = req.params;
    if (!/^[a-z0-9_-]+$/i.test(slug)) {
      return res.status(400).json({ error: 'Invalid skill slug' });
    }

    // Protect core skill
    if (slug === 'cmd-center') {
      return res.status(403).json({ error: 'Core skill cannot be deleted' });
    }

    const skillPath = path.join(SKILLS_PATH, slug);
    if (!fs.existsSync(skillPath) || !fs.statSync(skillPath).isDirectory()) {
      return res.status(404).json({ error: 'Skill not found' });
    }

    fs.rmSync(skillPath, { recursive: true, force: true });
    recordAudit({ action: 'skill:delete', target: slug, ip: req.ip });
    res.json({ success: true });
  } catch (error) {
    log.error(`Error in DELETE /api/skills/${req.params.slug}: ${error.message}`);
    res.status(500).json({ error: 'Failed to delete skill' });
  }
});

/**
 * POST /api/skills/install
 * Install a skill from a GitHub repository
 */
router.post('/skills/install', (req, res) => {
  try {
    // C15 Fix: Only human operators can install skills from external sources
    const sourceDept = req.headers['x-source-dept'];
    if (sourceDept) {
      return res.status(403).json({ error: 'AI agents cannot create or modify skills. Ask a human operator.' });
    }

    const { url } = req.body;
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'url is required' });
    }

    // Normalize URL
    let gitUrl = url.trim();
    if (!gitUrl.startsWith('http') && !gitUrl.startsWith('git@')) {
      // Treat as clawhub slug: user/repo
      gitUrl = `https://github.com/${gitUrl}`;
    }
    // Ensure .git suffix for clone
    if (!gitUrl.endsWith('.git')) {
      gitUrl += '.git';
    }

    // SSRF protection: only allow HTTPS and git@ protocols
    if (!gitUrl.startsWith('https://') && !gitUrl.startsWith('git@')) {
      return res.status(400).json({ error: 'Only HTTPS and git@ URLs are allowed' });
    }

    // Clone to temp dir
    const tmpDir = path.join(SKILLS_PATH, '.tmp-install-' + Date.now());
    try {
      execFileSync('git', ['clone', '--depth=1', gitUrl, tmpDir], {
        timeout: 30000,
        stdio: 'pipe'
      });
    } catch (cloneErr) {
      log.error(`Git clone failed: ${cloneErr.message}`);
      return res.status(400).json({ error: 'Failed to clone repository. Check the URL and try again.' });
    }

    // Validate SKILL.md exists
    const skillMdPath = path.join(tmpDir, 'SKILL.md');
    if (!fs.existsSync(skillMdPath)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      return res.status(400).json({ error: 'Repository does not contain SKILL.md' });
    }

    // Extract slug from frontmatter or directory name
    const skillContent = readTextFile(skillMdPath);
    const { frontmatter } = parseFrontmatter(skillContent);
    const slug = frontmatter.slug || path.basename(gitUrl, '.git');
    const skillName = frontmatter.name || slug;

    // H-1 Fix: Validate slug to prevent path traversal from malicious frontmatter
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(slug)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      return res.status(400).json({ error: `Invalid skill slug "${slug}": must be lowercase alphanumeric with hyphens/underscores` });
    }

    // Check if already exists
    const targetPath = path.join(SKILLS_PATH, slug);
    if (fs.existsSync(targetPath)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      return res.status(409).json({ error: `Skill "${slug}" already exists` });
    }

    // Move to skills directory (remove .git to save space)
    const gitDir = path.join(tmpDir, '.git');
    if (fs.existsSync(gitDir)) {
      fs.rmSync(gitDir, { recursive: true, force: true });
    }
    fs.renameSync(tmpDir, targetPath);

    // Write/update _meta.json
    const metaPath = path.join(targetPath, '_meta.json');
    const existingMeta = readJsonFile(metaPath) || {};
    existingMeta.installedFrom = url;
    existingMeta.installedAt = new Date().toISOString();
    if (!existingMeta.ownerId) existingMeta.ownerId = 'community';
    safeWriteFileSync(metaPath, JSON.stringify(existingMeta, null, 2));

    res.json({ success: true, slug, name: skillName });
  } catch (error) {
    log.error(`Error in POST /api/skills/install: ${error.message}`);
    // Clean up temp dir if it exists
    const tmpPattern = path.join(SKILLS_PATH, '.tmp-install-*');
    try {
      const entries = fs.readdirSync(SKILLS_PATH);
      for (const e of entries) {
        if (e.startsWith('.tmp-install-')) {
          fs.rmSync(path.join(SKILLS_PATH, e), { recursive: true, force: true });
        }
      }
    } catch {}
    res.status(500).json({ error: 'Failed to install skill' });
  }
});

/**
 * GET /api/memory/search
 * Search across all department memories.
 * Query: ?q=searchTerm
 * H25 Fix: Returns only metadata (deptId, matchCount, preview) to prevent leaking detailed memory content.
 */
router.get('/memory/search', (req, res) => {
  try {
    const { q } = req.query;
    if (!q || typeof q !== 'string' || q.trim().length < 2) {
      return res.status(400).json({ error: 'Query must be at least 2 characters' });
    }

    const query = q.trim().toLowerCase();
    const deptsPath = path.join(BASE_PATH, 'departments');

    if (!fs.existsSync(deptsPath)) {
      return res.json({ results: [], count: 0 });
    }

    const results = [];
    const entries = fs.readdirSync(deptsPath, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;

      const memPath = path.join(deptsPath, entry.name, 'memory', 'MEMORY.md');
      if (!fs.existsSync(memPath)) continue;

      try {
        const content = fs.readFileSync(memPath, 'utf8');
        if (!content.toLowerCase().includes(query)) continue;

        // H25 Fix: Count matches and get first match preview only
        const lines = content.split('\n');
        let matchCount = 0;
        let firstMatchPreview = '';

        for (let i = 0; i < lines.length; i++) {
          if (lines[i].toLowerCase().includes(query)) {
            matchCount++;
            if (!firstMatchPreview) {
              // Only store first match preview (50 chars max)
              firstMatchPreview = lines[i].trim().substring(0, 50);
            }
          }
        }

        // Only return metadata, not full matching text
        results.push({
          deptId: entry.name,
          matchCount,
          preview: firstMatchPreview,
        });
      } catch {
        // Skip unreadable files
      }
    }

    res.json({
      query: q.trim(),
      results,
      count: results.length,
    });
  } catch (error) {
    log.error(`Error in GET /api/memory/search: ${error.message}`);
    res.status(500).json({ error: 'Failed to search memories' });
  }
});

export default router;
