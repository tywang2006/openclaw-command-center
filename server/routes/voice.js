import express from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { BASE_PATH, OPENCLAW_HOME, readJsonFile, getConfigValue } from '../utils.js';
import { getEncryptionKey, decryptSensitiveFields, migratePlaintextFields } from '../crypto.js';
import { createLogger } from '../logger.js';

const log = createLogger('Voice');
const router = express.Router();

const CONFIG_PATH = path.join(BASE_PATH, '..', 'command-center', 'integrations.json');
const UPLOAD_DIR = path.join(BASE_PATH, '..', 'command-center', 'uploads');

/** Sanitise a user-supplied filename to prevent traversal / special chars */
function sanitizeFilename(name) {
  // Strip directory components and null bytes
  let clean = path.basename(name).replace(/\0/g, '');
  // Replace anything that isn't alphanumeric, dot, dash, underscore
  clean = clean.replace(/[^a-zA-Z0-9._\-]/g, '_');
  // Collapse multiple dots (prevents hidden-file tricks)
  clean = clean.replace(/\.{2,}/g, '.');
  return clean || 'unnamed';
}

// Ensure upload directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const safeName = sanitizeFilename(file.originalname);
    cb(null, uniqueSuffix + '-' + safeName);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 25 * 1024 * 1024 // 25MB max
  },
  fileFilter: (req, file, cb) => {
    const allowedMimeTypes = [
      'audio/webm',
      'audio/wav',
      'audio/mp4',
      'audio/mpeg',
      'audio/ogg',
      'audio/x-m4a'
    ];
    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only audio files are allowed.'));
    }
  }
});


/**
 * Helper: Get OpenAI API key
 * Resolution order:
 * 1. integrations.json voice.apiKeyOverride
 * 2. openclaw.json skills.entries['openai-whisper-api'].apiKey
 */
function getApiKey() {
  // Try integrations.json override (with decryption)
  const integrationsConfig = readJsonFile(CONFIG_PATH);
  if (integrationsConfig) {
    const key = getEncryptionKey();
    migratePlaintextFields(integrationsConfig, key);
    decryptSensitiveFields(integrationsConfig, key);
    if (integrationsConfig.voice?.apiKeyOverride) {
      return integrationsConfig.voice.apiKeyOverride;
    }
  }

  // Try openclaw.json
  const apiKey = getConfigValue('skills.entries.openai-whisper-api.apiKey');
  return apiKey || null;
}

/**
 * GET /voice/status
 * Return whether voice transcription is available (API key configured)
 */
router.get('/voice/status', (req, res) => {
  try {
    const apiKey = getApiKey();
    res.json({ configured: !!apiKey });
  } catch (error) {
    log.error('Error in GET /voice/status: ' + error.message);
    res.status(500).json({ error: 'Failed to check voice status' });
  }
});

/**
 * POST /voice/transcribe
 * Transcribe audio file using OpenAI Whisper API
 * Multipart form data: audio file + optional language parameter
 */
router.post('/voice/transcribe', upload.single('audio'), async (req, res) => {
  let uploadedFilePath = null;

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Audio file is required' });
    }

    uploadedFilePath = req.file.path;
    const language = req.body.language || 'zh'; // Default to Chinese

    log.info(`Transcribing audio file: ${req.file.originalname} (${req.file.size} bytes)`);

    // Get API key
    const apiKey = getApiKey();
    if (!apiKey) {
      return res.status(400).json({
        error: 'OpenAI API key not configured',
        hint: 'Set apiKeyOverride in integrations config or configure openai-whisper-api skill'
      });
    }

    try {
      // Read file and prepare FormData
      const fileBuffer = fs.readFileSync(uploadedFilePath);
      const blob = new Blob([fileBuffer], { type: req.file.mimetype });

      const formData = new FormData();
      formData.append('file', blob, req.file.originalname);
      formData.append('model', 'whisper-1');
      formData.append('language', language);

      // Call OpenAI Whisper API
      const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`
        },
        body: formData
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI API returned ${response.status}: ${errorText}`);
      }

      const result = await response.json();

      log.info(`Transcription successful: ${result.text.substring(0, 100)}...`);

      res.json({
        success: true,
        text: result.text
      });
    } catch (error) {
      log.error('Transcription failed: ' + error.message);
      res.status(502).json({
        error: 'Failed to transcribe audio'
      });
    }
  } catch (error) {
    log.error('Error in POST /voice/transcribe: ' + error.message);
    res.status(500).json({ error: 'Transcription request failed' });
  } finally {
    // Clean up uploaded file
    if (uploadedFilePath && fs.existsSync(uploadedFilePath)) {
      try {
        fs.unlinkSync(uploadedFilePath);
        log.info(`Cleaned up temp file: ${uploadedFilePath}`);
      } catch (error) {
        log.error('Failed to delete temp file: ' + error.message);
      }
    }
  }
});

export default router;
