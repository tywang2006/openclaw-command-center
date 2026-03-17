import express from 'express';
import fs from 'fs';
import path from 'path';
import { BASE_PATH, OPENCLAW_HOME, readJsonFile, readTextFile, parseFrontmatter, getOpenClawConfig } from '../utils.js';

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

/**
 * GET /api/system/capabilities
 * Returns system-wide capabilities: channels, plugins, skills, models.
 * All secrets (API keys, tokens) are stripped.
 */
router.get('/system/capabilities', (req, res) => {
  try {
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

    function scanSkillDir(basePath, source) {
      if (!fs.existsSync(basePath)) return;
      const dirs = fs.readdirSync(basePath, { withFileTypes: true })
        .filter(d => d.isDirectory() && !d.name.startsWith('.'))
        .map(d => d.name);

      for (const slug of dirs) {
        if (source !== 'workspace' && skillMap.has(slug)) continue; // workspace takes priority
        const skillMd = readTextFile(path.join(basePath, slug, 'SKILL.md'));
        if (!skillMd) continue;

        const { frontmatter } = parseFrontmatter(skillMd);
        const meta = readJsonFile(path.join(basePath, slug, '_meta.json'));
        const hasAssets = fs.existsSync(path.join(basePath, slug, 'assets'));

        skillMap.set(slug, {
          slug,
          name: frontmatter.name || slug,
          summary: frontmatter.summary || frontmatter.description || null,
          description: frontmatter.description || null,
          tags: Array.isArray(frontmatter.tags) ? frontmatter.tags : (meta?.tags || []),
          version: meta?.version || frontmatter.version || null,
          hasAssets,
          hasApiKey: slug in skillEntries,
          source,
        });
      }
    }

    // 1) Sandbox skills (OpenClaw built-in library)
    if (fs.existsSync(SANDBOXES_PATH)) {
      const sandboxes = fs.readdirSync(SANDBOXES_PATH, { withFileTypes: true })
        .filter(d => d.isDirectory() && d.name.startsWith('agent-main'));
      for (const sb of sandboxes) {
        scanSkillDir(path.join(SANDBOXES_PATH, sb.name, 'skills'), 'sandbox');
      }
    }

    // 2) Extension skills
    if (fs.existsSync(EXTENSIONS_PATH)) {
      const exts = fs.readdirSync(EXTENSIONS_PATH, { withFileTypes: true })
        .filter(d => d.isDirectory());
      for (const ext of exts) {
        scanSkillDir(path.join(EXTENSIONS_PATH, ext.name, 'skills'), 'extension');
      }
    }

    // 3) Workspace skills (user's own — highest priority, overwrites above)
    scanSkillDir(SKILLS_PATH, 'workspace');

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

    res.json({ channels, plugins, skills, models });
  } catch (err) {
    console.error('[capabilities] Error:', err);
    res.status(500).json({ error: 'Failed to load capabilities' });
  }
});

export default router;
