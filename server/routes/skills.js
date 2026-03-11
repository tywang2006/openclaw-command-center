import express from 'express';
import fs from 'fs';
import path from 'path';
import { BASE_PATH, readJsonFile, readTextFile, parseFrontmatter } from '../utils.js';

const router = express.Router();

const SKILLS_PATH = path.join(BASE_PATH, 'skills');

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
    console.error('Error in GET /api/skills:', error);
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
    console.error(`Error in GET /api/skills/${req.params.slug}:`, error);
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
    console.error(`Error in GET /api/skills/${req.params.slug}/assets:`, error);
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
    const result = await chat(deptId, message);

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
    console.error(`Error in POST /api/skills/${req.params.slug}/execute:`, error);
    res.status(500).json({ error: 'Failed to execute skill' });
  }
});

/**
 * GET /api/memory/search
 * Search across all department memories.
 * Query: ?q=searchTerm
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

        // Find matching lines with context
        const lines = content.split('\n');
        const matches = [];
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].toLowerCase().includes(query)) {
            matches.push({
              line: i + 1,
              text: lines[i].trim().substring(0, 200),
            });
            if (matches.length >= 5) break;
          }
        }

        results.push({
          deptId: entry.name,
          matches,
          totalSize: content.length,
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
    console.error('Error in GET /api/memory/search:', error);
    res.status(500).json({ error: 'Failed to search memories' });
  }
});

export default router;
