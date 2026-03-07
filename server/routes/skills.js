import express from 'express';
import fs from 'fs';
import path from 'path';

const router = express.Router();

// Skills base path
const SKILLS_PATH = '/root/.openclaw/workspace/skills';

/**
 * Helper: Parse YAML frontmatter from SKILL.md
 * Extracts content between --- markers and parses key: value pairs
 */
function parseFrontmatter(content) {
  const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---/;
  const match = content.match(frontmatterRegex);

  if (!match) {
    return { frontmatter: {}, body: content };
  }

  const frontmatterText = match[1];
  const body = content.slice(match[0].length).trim();

  const frontmatter = {};
  const lines = frontmatterText.split('\n');

  let currentKey = null;
  let currentValue = [];

  for (const line of lines) {
    // Check if line starts a new key: value pair
    const keyValueMatch = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);

    if (keyValueMatch) {
      // Save previous key if exists
      if (currentKey) {
        frontmatter[currentKey] = parseValue(currentValue.join('\n').trim());
      }

      currentKey = keyValueMatch[1];
      currentValue = [keyValueMatch[2]];
    } else if (currentKey && line.trim()) {
      // Continuation of previous value (multiline)
      currentValue.push(line);
    }
  }

  // Save last key
  if (currentKey) {
    frontmatter[currentKey] = parseValue(currentValue.join('\n').trim());
  }

  return { frontmatter, body };
}

/**
 * Helper: Parse YAML value (handle arrays, strings, etc.)
 */
function parseValue(value) {
  // Handle arrays: [item1, item2, item3]
  const arrayMatch = value.match(/^\[(.*)\]$/);
  if (arrayMatch) {
    return arrayMatch[1]
      .split(',')
      .map(item => item.trim().replace(/^['"]|['"]$/g, ''))
      .filter(item => item.length > 0);
  }

  // Handle boolean
  if (value === 'true') return true;
  if (value === 'false') return false;

  // Handle null/empty
  if (value === 'null' || value === '') return null;

  // Handle quoted strings
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }

  // Return as-is (string or multiline)
  return value;
}

/**
 * Helper: Read JSON file safely
 */
function readJsonFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(content);
    }
    return null;
  } catch (error) {
    console.error(`Error reading JSON file ${filePath}:`, error.message);
    return null;
  }
}

/**
 * Helper: Read text file safely
 */
function readTextFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf8');
    }
    return null;
  } catch (error) {
    console.error(`Error reading text file ${filePath}:`, error.message);
    return null;
  }
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

export default router;
