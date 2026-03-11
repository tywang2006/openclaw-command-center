import express from 'express';
import fs from 'fs';
import path from 'path';
import { OPENCLAW_HOME } from '../utils.js';

const router = express.Router();
const OPENCLAW_CONFIG = path.join(OPENCLAW_HOME, 'openclaw.json');

/**
 * Helper: Read openclaw.json
 */
function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(OPENCLAW_CONFIG, 'utf8'));
  } catch (error) {
    console.error('[SystemConfig] Error reading openclaw.json:', error.message);
    return null;
  }
}

/**
 * Helper: Write openclaw.json
 */
function writeConfig(data) {
  try {
    fs.writeFileSync(OPENCLAW_CONFIG, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('[SystemConfig] Error writing openclaw.json:', error.message);
    return false;
  }
}

/**
 * Helper: Mask API key string → first 8 + "..."
 */
function maskKey(key) {
  if (!key || typeof key !== 'string') return null;
  if (key.length <= 12) return '***';
  return key.substring(0, 8) + '...' + key.substring(key.length - 4);
}

// ================================================
// Feature 2: AI Model Configuration
// ================================================

/**
 * GET /system/config/models
 * Return providers + primary/fallbacks with masked API keys
 */
router.get('/system/config/models', (req, res) => {
  try {
    const config = readConfig();
    if (!config) return res.status(500).json({ error: 'Failed to read config' });

    const providers = {};
    for (const [id, prov] of Object.entries(config.models?.providers || {})) {
      providers[id] = {
        baseUrl: prov.baseUrl,
        api: prov.api,
        hasApiKey: !!prov.apiKey,
        apiKeyPreview: maskKey(prov.apiKey),
        models: prov.models || [],
      };
    }

    const defaults = config.agents?.defaults?.model || {};

    res.json({
      providers,
      primary: defaults.primary || null,
      fallbacks: defaults.fallbacks || [],
    });
  } catch (error) {
    console.error('[SystemConfig] GET /system/config/models error:', error);
    res.status(500).json({ error: 'Failed to fetch model config' });
  }
});

/**
 * PUT /system/config/models
 * Update primary/fallbacks/provider apiKey
 * Body: { primary?, fallbacks?, providers?: { [id]: { apiKey?, baseUrl? } } }
 */
router.put('/system/config/models', (req, res) => {
  try {
    const config = readConfig();
    if (!config) return res.status(500).json({ error: 'Failed to read config' });

    const { primary, fallbacks, providers } = req.body;

    // Update primary/fallbacks
    if (!config.agents) config.agents = {};
    if (!config.agents.defaults) config.agents.defaults = {};
    if (!config.agents.defaults.model) config.agents.defaults.model = {};

    if (primary !== undefined) {
      config.agents.defaults.model.primary = primary;
    }
    if (fallbacks !== undefined) {
      if (!Array.isArray(fallbacks)) {
        return res.status(400).json({ error: 'fallbacks must be an array' });
      }
      config.agents.defaults.model.fallbacks = fallbacks;
    }

    // Update provider keys
    if (providers && typeof providers === 'object') {
      if (!config.models) config.models = {};
      if (!config.models.providers) config.models.providers = {};

      for (const [id, updates] of Object.entries(providers)) {
        if (!config.models.providers[id]) continue;
        if (updates.apiKey !== undefined) {
          config.models.providers[id].apiKey = updates.apiKey;
        }
        if (updates.baseUrl !== undefined) {
          config.models.providers[id].baseUrl = updates.baseUrl;
        }
      }
    }

    if (!writeConfig(config)) {
      return res.status(500).json({ error: 'Failed to save config' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('[SystemConfig] PUT /system/config/models error:', error);
    res.status(500).json({ error: 'Failed to update model config' });
  }
});

/**
 * POST /system/config/models/test
 * Test provider API key
 * Body: { provider: "moonshot" | "google" }
 */
router.post('/system/config/models/test', async (req, res) => {
  try {
    const config = readConfig();
    if (!config) return res.status(500).json({ error: 'Failed to read config' });

    const { provider } = req.body;
    if (!provider) return res.status(400).json({ error: 'provider is required' });

    const prov = config.models?.providers?.[provider];
    if (!prov) return res.status(404).json({ error: `Provider "${provider}" not found` });
    if (!prov.apiKey) return res.status(400).json({ error: 'No API key configured for this provider' });

    try {
      if (prov.api === 'openai-completions') {
        // OpenAI-compatible: test /v1/models
        const response = await fetch(`${prov.baseUrl}/models`, {
          headers: { 'Authorization': `Bearer ${prov.apiKey}` },
        });
        if (!response.ok) throw new Error(`API returned ${response.status}`);
        res.json({ success: true, message: `${provider} API key is valid` });
      } else if (prov.api === 'google-generative-ai') {
        // Google: list models
        const response = await fetch(
          `${prov.baseUrl}/v1beta/models?key=${prov.apiKey}`
        );
        if (!response.ok) throw new Error(`API returned ${response.status}`);
        res.json({ success: true, message: `${provider} API key is valid` });
      } else {
        res.json({ success: true, message: `Cannot verify API type "${prov.api}", assumed valid` });
      }
    } catch (error) {
      res.status(502).json({ error: `API test failed: ${error.message}` });
    }
  } catch (error) {
    console.error('[SystemConfig] POST /system/config/models/test error:', error);
    res.status(500).json({ error: 'Test failed' });
  }
});

// ================================================
// Feature 3: Telegram Settings
// ================================================

/**
 * GET /system/config/telegram
 * Return telegram config with masked botToken
 */
router.get('/system/config/telegram', (req, res) => {
  try {
    const config = readConfig();
    if (!config) return res.status(500).json({ error: 'Failed to read config' });

    const tg = config.channels?.telegram || {};

    res.json({
      enabled: tg.enabled || false,
      hasBotToken: !!tg.botToken,
      botTokenPreview: maskKey(tg.botToken),
      dmPolicy: tg.dmPolicy || null,
      allowFrom: tg.allowFrom || [],
      groups: tg.groups || {},
      streaming: tg.streaming || null,
      groupPolicy: tg.groupPolicy || null,
    });
  } catch (error) {
    console.error('[SystemConfig] GET /system/config/telegram error:', error);
    res.status(500).json({ error: 'Failed to fetch telegram config' });
  }
});

/**
 * PUT /system/config/telegram
 * Update telegram settings
 */
router.put('/system/config/telegram', (req, res) => {
  try {
    const config = readConfig();
    if (!config) return res.status(500).json({ error: 'Failed to read config' });

    if (!config.channels) config.channels = {};
    if (!config.channels.telegram) config.channels.telegram = {};

    const updates = req.body;
    const tg = config.channels.telegram;

    if (updates.enabled !== undefined) tg.enabled = !!updates.enabled;
    if (updates.botToken !== undefined) tg.botToken = updates.botToken;
    if (updates.dmPolicy !== undefined) tg.dmPolicy = updates.dmPolicy;
    if (updates.allowFrom !== undefined) {
      tg.allowFrom = Array.isArray(updates.allowFrom) ? updates.allowFrom
        : typeof updates.allowFrom === 'string' ? updates.allowFrom.split(',').map(s => s.trim()).filter(Boolean)
        : tg.allowFrom;
    }
    if (updates.groups !== undefined) tg.groups = updates.groups;
    if (updates.streaming !== undefined) tg.streaming = updates.streaming;
    if (updates.groupPolicy !== undefined) tg.groupPolicy = updates.groupPolicy;

    if (!writeConfig(config)) {
      return res.status(500).json({ error: 'Failed to save config' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('[SystemConfig] PUT /system/config/telegram error:', error);
    res.status(500).json({ error: 'Failed to update telegram config' });
  }
});

/**
 * POST /system/config/telegram/test
 * Test bot token via getMe
 */
router.post('/system/config/telegram/test', async (req, res) => {
  try {
    const config = readConfig();
    if (!config) return res.status(500).json({ error: 'Failed to read config' });

    const botToken = req.body.botToken || config.channels?.telegram?.botToken;
    if (!botToken) return res.status(400).json({ error: 'No bot token configured' });

    try {
      const response = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
      const data = await response.json();
      if (data.ok) {
        res.json({ success: true, message: `Bot: @${data.result.username} (${data.result.first_name})` });
      } else {
        throw new Error(data.description || 'Invalid token');
      }
    } catch (error) {
      res.status(502).json({ error: `Telegram test failed: ${error.message}` });
    }
  } catch (error) {
    console.error('[SystemConfig] POST /system/config/telegram/test error:', error);
    res.status(500).json({ error: 'Test failed' });
  }
});

// ================================================
// Feature 5: Plugin Management
// ================================================

/**
 * PUT /system/config/plugins/:id
 * Toggle plugin enabled state
 * Body: { enabled: boolean }
 */
router.put('/system/config/plugins/:id', (req, res) => {
  try {
    const config = readConfig();
    if (!config) return res.status(500).json({ error: 'Failed to read config' });

    const { id } = req.params;
    const { enabled } = req.body;

    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled must be a boolean' });
    }

    if (!config.plugins) config.plugins = {};
    if (!config.plugins.entries) config.plugins.entries = {};

    if (!config.plugins.entries[id]) {
      config.plugins.entries[id] = {};
    }
    config.plugins.entries[id].enabled = enabled;

    if (!writeConfig(config)) {
      return res.status(500).json({ error: 'Failed to save config' });
    }

    res.json({ success: true, id, enabled });
  } catch (error) {
    console.error('[SystemConfig] PUT /system/config/plugins/:id error:', error);
    res.status(500).json({ error: 'Failed to update plugin config' });
  }
});

// ================================================
// Feature 6: Skill API Keys
// ================================================

/**
 * GET /system/config/skills
 * Return skill entries with masked API keys
 */
router.get('/system/config/skills', (req, res) => {
  try {
    const config = readConfig();
    if (!config) return res.status(500).json({ error: 'Failed to read config' });

    const entries = config.skills?.entries || {};
    const skills = [];

    for (const [slug, entry] of Object.entries(entries)) {
      skills.push({
        slug,
        hasApiKey: !!entry.apiKey,
        apiKeyPreview: maskKey(entry.apiKey),
      });
    }

    res.json({ skills });
  } catch (error) {
    console.error('[SystemConfig] GET /system/config/skills error:', error);
    res.status(500).json({ error: 'Failed to fetch skill config' });
  }
});

/**
 * PUT /system/config/skills/:slug
 * Update or remove a skill's API key
 * Body: { apiKey: "new-key" } or { apiKey: null } to remove
 */
router.put('/system/config/skills/:slug', (req, res) => {
  try {
    const config = readConfig();
    if (!config) return res.status(500).json({ error: 'Failed to read config' });

    const { slug } = req.params;
    if (!config.skills) config.skills = {};
    if (!config.skills.entries) config.skills.entries = {};

    const { apiKey } = req.body;

    if (apiKey === null || apiKey === '') {
      // Remove API key
      if (config.skills.entries[slug]) {
        delete config.skills.entries[slug].apiKey;
        if (Object.keys(config.skills.entries[slug]).length === 0) {
          delete config.skills.entries[slug];
        }
      }
    } else if (typeof apiKey === 'string') {
      if (!config.skills.entries[slug]) {
        config.skills.entries[slug] = {};
      }
      config.skills.entries[slug].apiKey = apiKey;
    } else {
      return res.status(400).json({ error: 'apiKey must be a string or null' });
    }

    if (!writeConfig(config)) {
      return res.status(500).json({ error: 'Failed to save config' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('[SystemConfig] PUT /system/config/skills/:slug error:', error);
    res.status(500).json({ error: 'Failed to update skill config' });
  }
});

/**
 * POST /system/config/skills/:slug/test
 * Test a skill's API key
 */
router.post('/system/config/skills/:slug/test', async (req, res) => {
  try {
    const config = readConfig();
    if (!config) return res.status(500).json({ error: 'Failed to read config' });

    const { slug } = req.params;
    const apiKey = req.body.apiKey || config.skills?.entries?.[slug]?.apiKey;

    if (!apiKey) {
      return res.status(400).json({ error: 'No API key configured for this skill' });
    }

    try {
      if (slug.includes('openai') || slug === 'openai-image-gen' || slug === 'openai-whisper-api') {
        // OpenAI-type: test /v1/models
        const response = await fetch('https://api.openai.com/v1/models', {
          headers: { 'Authorization': `Bearer ${apiKey}` },
        });
        if (!response.ok) throw new Error(`API returned ${response.status}`);
        res.json({ success: true, message: 'OpenAI API key is valid' });
      } else if (slug.includes('tavily')) {
        // Tavily: test /search
        const response = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: apiKey, query: 'test', max_results: 1 }),
        });
        if (!response.ok) throw new Error(`API returned ${response.status}`);
        res.json({ success: true, message: 'Tavily API key is valid' });
      } else if (slug.includes('nano-banana') || slug.includes('google')) {
        // Google AI: list models
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
        );
        if (!response.ok) throw new Error(`API returned ${response.status}`);
        res.json({ success: true, message: 'Google AI API key is valid' });
      } else {
        res.json({ success: true, message: 'Cannot verify this skill type, assumed valid' });
      }
    } catch (error) {
      res.status(502).json({ error: `API test failed: ${error.message}` });
    }
  } catch (error) {
    console.error('[SystemConfig] POST /system/config/skills/:slug/test error:', error);
    res.status(500).json({ error: 'Test failed' });
  }
});

export default router;
