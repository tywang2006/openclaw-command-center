import express from 'express';
import fs from 'fs';
import path from 'path';

const router = express.Router();

const OPENCLAW_CONFIG = '/root/.openclaw/openclaw.json';
const SKILLS_PATH = '/root/.openclaw/workspace/skills';

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

/** Parse YAML frontmatter from SKILL.md */
function parseFrontmatter(content) {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return { frontmatter: {}, body: content };

  const body = content.slice(match[0].length).trim();
  const frontmatter = {};
  let currentKey = null;
  let currentValue = [];

  for (const line of match[1].split('\n')) {
    const kv = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (kv) {
      if (currentKey) frontmatter[currentKey] = parseValue(currentValue.join('\n').trim());
      currentKey = kv[1];
      currentValue = [kv[2]];
    } else if (currentKey && line.trim()) {
      currentValue.push(line);
    }
  }
  if (currentKey) frontmatter[currentKey] = parseValue(currentValue.join('\n').trim());

  return { frontmatter, body };
}

function parseValue(value) {
  const arr = value.match(/^\[(.*)\]$/);
  if (arr) return arr[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null' || value === '') return null;
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
    return value.slice(1, -1);
  return value;
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function readText(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

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
    const config = readJson(OPENCLAW_CONFIG);
    if (!config) {
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
    const skillEntries = config.skills?.entries || {};
    const skills = [];

    if (fs.existsSync(SKILLS_PATH)) {
      const dirs = fs.readdirSync(SKILLS_PATH, { withFileTypes: true })
        .filter(d => d.isDirectory() && !d.name.startsWith('.'))
        .map(d => d.name);

      for (const slug of dirs) {
        const skillMd = readText(path.join(SKILLS_PATH, slug, 'SKILL.md'));
        if (!skillMd) continue;

        const { frontmatter } = parseFrontmatter(skillMd);
        const meta = readJson(path.join(SKILLS_PATH, slug, '_meta.json'));
        const hasAssets = fs.existsSync(path.join(SKILLS_PATH, slug, 'assets'));

        skills.push({
          slug,
          name: frontmatter.name || slug,
          summary: frontmatter.summary || frontmatter.description || null,
          description: frontmatter.description || null,
          tags: Array.isArray(frontmatter.tags) ? frontmatter.tags : (meta?.tags || []),
          version: meta?.version || frontmatter.version || null,
          hasAssets,
          hasApiKey: slug in skillEntries,
        });
      }

      skills.sort((a, b) => a.name.localeCompare(b.name));
    }

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
