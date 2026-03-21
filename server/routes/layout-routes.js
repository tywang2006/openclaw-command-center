import express from 'express';
import fs from 'fs';
import path from 'path';
import { generateAndSave, generateLayout } from '../layout-generator.js';
import { BASE_PATH } from '../utils.js';
import { createLogger } from '../logger.js';

const log = createLogger('Layout');
const router = express.Router();

/**
 * GET /api/layout
 * Generate and return office layout based on current department configuration.
 * No file I/O — always reflects the live department config.
 */
router.get('/layout', (req, res) => {
  try {
    const configPath = path.join(BASE_PATH, 'departments', 'config.json');
    if (!fs.existsSync(configPath)) {
      return res.json(generateLayout([]));
    }
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const departments = Object.entries(config.departments || {})
      .map(([id, dept]) => ({ id, hue: dept.hue ?? 200, order: dept.order ?? 99 }));
    res.json(generateLayout(departments));
  } catch (error) {
    log.error('Layout generate failed: ' + error.message);
    res.status(500).json({ error: 'Layout generation failed' });
  }
});

/**
 * POST /api/layout/rebuild
 * Regenerate the office layout based on current department configuration
 */
router.post('/layout/rebuild', async (req, res) => {
  try {
    log.info('Layout rebuild requested');
    const result = generateAndSave();
    res.json({ success: true, ...result });
  } catch (error) {
    log.error('Layout rebuild failed: ' + error.message);
    res.status(500).json({ success: false, error: 'Layout rebuild failed' });
  }
});

export default router;
