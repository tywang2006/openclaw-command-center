import express from 'express';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { BASE_PATH, OPENCLAW_HOME, readJsonFile, readTextFile, parseFrontmatter, getOpenClawConfig } from '../utils.js';
import { createLogger } from '../logger.js';

const log = createLogger('Capabilities');
const router = express.Router();

const SKILLS_PATH = path.join(BASE_PATH, 'skills');
const SANDBOXES_PATH = path.join(OPENCLAW_HOME, 'sandboxes');
const EXTENSIONS_PATH = path.join(OPENCLAW_HOME, 'extensions');

// Static plugin descriptions (plugins have no SKILL.md)
const PLUGIN_INFO = {
  telegram: { name: 'Telegram Plugin', description: 'Telegram 消息通道插件' },
  whatsapp: { name: 'WhatsApp Plugin', description: 'WhatsApp 消息通道插件' },
  'kimi-claw': { name: 'Kimi Claw', description: 'Kimi AI 模型桥接' },
  'openclaw-tavily': { name: 'Tavily Search', description: 'Tavily 网页搜索' },
};

// Channel display names
const CHANNEL_NAMES = {
  telegram: 'Telegram',
  whatsapp: 'WhatsApp',
};

/** Format context window size for display */
function formatSize(n) {
  if (!n) return '?';
  if (n >= 1000000) return `${(n / 1000000).toFixed(0)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(0)}K`;
  return String(n);
}

// Cache for capabilities (TTL: 30 seconds)
let capabilitiesCache = null;
let cacheTimestamp = 0;
const CACHE_TTL = 30000; // 30 seconds

/**
 * Async skill directory scanner with parallel I/O
 * @param {string} basePath - Directory to scan
 * @param {string} source - Source identifier (workspace/sandbox/extension)
 * @returns {Promise<Array>} - Array of skill objects
 */
async function scanSkillDirAsync(basePath, source, skillEntries) {
  try {
    if (!fs.existsSync(basePath)) return [];

    const dirs = await fsp.readdir(basePath, { withFileTypes: true });
    const skillDirs = dirs
      .filter(d => d.isDirectory() && !d.name.startsWith('.'))
      .map(d => d.name);

    // Limit to first 50 skills per source to prevent excessive scanning
    const MAX_SKILLS_PER_SOURCE = 50;
    const limitedDirs = skillDirs.slice(0, MAX_SKILLS_PER_SOURCE);

    // Scan skills in parallel
    const skillPromises = limitedDirs.map(async (slug) => {
      try {
        const skillMdPath = path.join(basePath, slug, 'SKILL.md');
        const metaPath = path.join(basePath, slug, '_meta.json');
        const assetsPath = path.join(basePath, slug, 'assets');

        const [skillMd, metaContent, assetsExists] = await Promise.all([
          fsp.readFile(skillMdPath, 'utf8').catch(() => null),
          fsp.readFile(metaPath, 'utf8').catch(() => null),
          fsp.access(assetsPath).then(() => true).catch(() => false)
        ]);

        if (!skillMd) return null;

        const { frontmatter } = parseFrontmatter(skillMd);
        const meta = metaContent ? JSON.parse(metaContent) : null;

        return {
          slug,
          name: frontmatter.name || slug,
          summary: frontmatter.summary || frontmatter.description || null,
          description: frontmatter.description || null,
          tags: Array.isArray(frontmatter.tags) ? frontmatter.tags : (meta?.tags || []),
          version: meta?.version || frontmatter.version || null,
          hasAssets: assetsExists,
          hasApiKey: slug in skillEntries,
          source,
        };
      } catch (err) {
        log.error(`Failed to read skill ${slug} from ${source}: ${err.message}`);
        return null;
      }
    });

    const skills = await Promise.all(skillPromises);
    return skills.filter(s => s !== null);
  } catch (err) {
    log.error(`Failed to scan skill directory ${basePath}: ${err.message}`);
    return [];
  }
}

/**
 * GET /api/system/capabilities
 * Returns system-wide capabilities: channels, plugins, skills, models.
 * All secrets (API keys, tokens) are stripped.
 * Performance: Uses 30s cache + async I/O with Promise.all
 */
router.get('/system/capabilities', async (req, res) => {
  try {
    // Check cache
    const now = Date.now();
    if (capabilitiesCache && (now - cacheTimestamp) < CACHE_TTL) {
      return res.json(capabilitiesCache);
    }

    const config = getOpenClawConfig();
    if (!config || Object.keys(config).length === 0) {
      return res.status(500).json({ error: 'Cannot read openclaw.json' });
    }

    // --- Channels ---
    const channels = [];
    for (const [id, cfg] of Object.entries(config.channels || {})) {
      const pluginEntry = config.plugins?.entries?.[id];
      const enabled = cfg.enabled !== false;
      const running = pluginEntry?.enabled === true;

      channels.push({
        id,
        name: CHANNEL_NAMES[id] || id,
        enabled,
        running,
        config: {
          groups: cfg.groups ? Object.keys(cfg.groups).filter(k => k !== '*').length : 0,
          dmPolicy: cfg.dmPolicy || null,
          streaming: cfg.streaming || null,
          groupPolicy: cfg.groupPolicy || null,
          selfChatMode: cfg.selfChatMode || false,
        },
      });
    }

    // --- Plugins (exclude channel plugins already shown above) ---
    const channelIds = new Set(Object.keys(config.channels || {}));
    const plugins = [];
    for (const [id, entry] of Object.entries(config.plugins?.entries || {})) {
      if (channelIds.has(id)) continue; // Skip channel plugins
      const info = PLUGIN_INFO[id] || { name: id, description: '' };
      const installInfo = config.plugins?.installs?.[id];
      plugins.push({
        id,
        name: info.name,
        enabled: entry.enabled !== false,
        description: info.description,
        version: installInfo?.version || null,
      });
    }

    // --- Skills ---
    // Collect from multiple sources: workspace > sandbox > extensions
    const skillEntries = config.skills?.entries || {};
    const skillMap = new Map(); // slug -> skill object (dedup, workspace wins)

    // Scan all three sources in parallel for maximum performance
    const [sandboxSkills, extensionSkills, workspaceSkills] = await Promise.all([
      // 1) Sandbox skills (OpenClaw built-in library)
      (async () => {
        if (!fs.existsSync(SANDBOXES_PATH)) return [];
        const sandboxes = await fsp.readdir(SANDBOXES_PATH, { withFileTypes: true });
        const agentMainDirs = sandboxes
          .filter(d => d.isDirectory() && d.name.startsWith('agent-main'))
          .map(d => d.name);

        // Scan first agent-main sandbox only to avoid excessive I/O
        if (agentMainDirs.length > 0) {
          const skillsPath = path.join(SANDBOXES_PATH, agentMainDirs[0], 'skills');
          return await scanSkillDirAsync(skillsPath, 'sandbox', skillEntries);
        }
        return [];
      })(),

      // 2) Extension skills
      (async () => {
        if (!fs.existsSync(EXTENSIONS_PATH)) return [];
        const exts = await fsp.readdir(EXTENSIONS_PATH, { withFileTypes: true });
        const extDirs = exts.filter(d => d.isDirectory()).map(d => d.name);

        // Scan first extension only to limit I/O
        if (extDirs.length > 0) {
          const skillsPath = path.join(EXTENSIONS_PATH, extDirs[0], 'skills');
          return await scanSkillDirAsync(skillsPath, 'extension', skillEntries);
        }
        return [];
      })(),

      // 3) Workspace skills (user's own — highest priority)
      scanSkillDirAsync(SKILLS_PATH, 'workspace', skillEntries)
    ]);

    // Merge skills with workspace taking priority
    for (const skill of sandboxSkills) {
      if (!skillMap.has(skill.slug)) skillMap.set(skill.slug, skill);
    }
    for (const skill of extensionSkills) {
      if (!skillMap.has(skill.slug)) skillMap.set(skill.slug, skill);
    }
    for (const skill of workspaceSkills) {
      skillMap.set(skill.slug, skill); // Workspace overwrites all
    }

    const skills = Array.from(skillMap.values());
    skills.sort((a, b) => a.name.localeCompare(b.name));

    // --- Models ---
    const primaryModel = config.agents?.defaults?.model?.primary || '';
    const fallbacks = config.agents?.defaults?.model?.fallbacks || [];
    const models = [];

    for (const [providerId, provider] of Object.entries(config.models?.providers || {})) {
      for (const model of provider.models || []) {
        const fullId = `${providerId}/${model.id}`;
        models.push({
          id: fullId,
          name: model.name || model.id,
          provider: providerId,
          contextWindow: model.contextWindow || 0,
          contextWindowFormatted: formatSize(model.contextWindow),
          maxTokens: model.maxTokens || 0,
          maxTokensFormatted: formatSize(model.maxTokens),
          isPrimary: fullId === primaryModel,
          isFallback: fallbacks.includes(fullId),
          input: model.input || ['text'],
        });
      }
    }

    const result = { channels, plugins, skills, models };

    // Update cache
    capabilitiesCache = result;
    cacheTimestamp = now;

    res.json(result);
  } catch (err) {
    log.error('Error loading capabilities', { error: err.message });
    res.status(500).json({ error: 'Failed to load capabilities' });
  }
});

export default router;
