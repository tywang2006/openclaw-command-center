import express from 'express';
import nodemailer from 'nodemailer';
import path from 'path';
import { BASE_PATH, readJsonFile } from '../utils.js';
import { getEncryptionKey, decryptSensitiveFields, migratePlaintextFields } from '../crypto.js';
import { recordAudit } from './audit.js';
import { createLogger } from '../logger.js';

const log = createLogger('Email');
const router = express.Router();

const CONFIG_PATH = path.join(BASE_PATH, '..', 'command-center', 'integrations.json');

/**
 * Sanitize HTML content to prevent XSS via email.
 * Strips dangerous tags (script, iframe, object, embed) and on* event handlers.
 */
function sanitizeHtml(html) {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<iframe\b[^>]*>.*?<\/iframe>/gi, '')
    .replace(/<object\b[^>]*>.*?<\/object>/gi, '')
    .replace(/<embed\b[^>]*\/?>/gi, '')
    .replace(/\bon\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]*)/gi, '');
}

/**
 * Helper: Get Gmail configuration (with decryption)
 */
function getGmailConfig() {
  const config = readJsonFile(CONFIG_PATH);
  if (!config) return { enabled: false, email: '', appPassword: '' };
  const key = getEncryptionKey();
  migratePlaintextFields(config, key);
  decryptSensitiveFields(config, key);
  return config?.gmail || { enabled: false, email: '', appPassword: '' };
}

/**
 * Helper: Create nodemailer transporter
 */
async function createTransporter(gmailConfig) {
  // Try 587 first (STARTTLS), fallback to 465 (SSL) if blocked
  const configs = [
    { port: 587, secure: false },
    { port: 465, secure: true },
  ];

  for (const cfg of configs) {
    try {
      const transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: cfg.port,
        secure: cfg.secure,
        auth: {
          user: gmailConfig.email,
          pass: gmailConfig.appPassword
        },
        connectionTimeout: 10000,
      });
      await transporter.verify();
      return transporter;
    } catch (err) {
      log.info(`Port ${cfg.port} failed: ${err.message}`);
    }
  }
  throw new Error('Cannot connect to Gmail SMTP on any port');
}

/**
 * Helper: Validate email address
 */
function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Helper: Extract domain from email address
 */
function getDomain(email) {
  if (!email || typeof email !== 'string') return null;
  const parts = email.split('@');
  return parts.length === 2 ? parts[1].toLowerCase() : null;
}

/**
 * Helper: Get allowed email domains from config
 */
function getAllowedDomains() {
  const config = readJsonFile(CONFIG_PATH);
  // Allow configuring allowedDomains in integrations.json under gmail
  if (config?.gmail?.allowedDomains && Array.isArray(config.gmail.allowedDomains)) {
    return config.gmail.allowedDomains.map(d => d.toLowerCase());
  }
  // Default: empty array (allow all for backward compatibility)
  return [];
}

/**
 * Helper: Validate recipient addresses against domain whitelist
 * Returns { valid: boolean, error?: string }
 */
function validateRecipients(to, cc, bcc) {
  const allowedDomains = getAllowedDomains();

  // Parse recipients (support comma-separated lists)
  const parseEmails = (field) => {
    if (!field) return [];
    if (typeof field === 'string') {
      return field.split(',').map(e => e.trim()).filter(e => e);
    }
    if (Array.isArray(field)) {
      return field.map(e => String(e).trim()).filter(e => e);
    }
    return [];
  };

  const toList = parseEmails(to);
  const ccList = parseEmails(cc);
  const bccList = parseEmails(bcc);
  const allRecipients = [...toList, ...ccList, ...bccList];

  // Check max recipients limit
  if (allRecipients.length === 0) {
    return { valid: false, error: 'At least one recipient is required' };
  }
  if (allRecipients.length > 10) {
    return { valid: false, error: `Too many recipients (max 10, got ${allRecipients.length})` };
  }

  // Validate email format
  for (const email of allRecipients) {
    if (!isValidEmail(email)) {
      return { valid: false, error: `Invalid email address: ${email}` };
    }
  }

  // Validate against domain whitelist (only if configured)
  if (allowedDomains.length > 0) {
    for (const email of allRecipients) {
      const domain = getDomain(email);
      if (!domain || !allowedDomains.includes(domain)) {
        return {
          valid: false,
          error: `Recipient domain not allowed: ${email}. Allowed domains: ${allowedDomains.join(', ')}`
        };
      }
    }
  }

  return { valid: true };
}

/**
 * GET /email/status
 * Return Gmail integration status
 */
router.get('/email/status', (req, res) => {
  try {
    const gmailConfig = getGmailConfig();
    const configured = !!(gmailConfig.email && gmailConfig.appPassword);

    res.json({
      configured,
      enabled: gmailConfig.enabled,
      email: gmailConfig.email || null
    });
  } catch (error) {
    log.error(`Error in GET /email/status: ${error.message}`);
    res.status(500).json({ error: 'Failed to fetch email status' });
  }
});

/**
 * POST /email/test
 * Test Gmail connection
 */
router.post('/email/test', async (req, res) => {
  try {
    const gmailConfig = getGmailConfig();

    if (!gmailConfig.email || !gmailConfig.appPassword) {
      return res.status(400).json({ error: 'Gmail not configured' });
    }

    const transporter = await createTransporter(gmailConfig);
      res.json({ success: true, message: 'Gmail connection successful' });
  } catch (error) {
    log.error(`Error in POST /email/test: ${error.message}`);
    res.status(502).json({ error: 'Gmail connection failed', detail: error.message });
  }
});

/**
 * POST /email/send
 * Send email via Gmail
 * Body: { to, cc?, bcc?, subject, body, html?, attachments? }
 */
router.post('/email/send', async (req, res) => {
  try {
    const { to, cc, bcc, subject, body, html, attachments } = req.body;

    // Validate subject
    if (!subject || !subject.trim()) {
      return res.status(400).json({ error: 'Subject is required' });
    }

    // Validate body
    if (!body && !html) {
      return res.status(400).json({ error: 'Email body or html content is required' });
    }

    // Validate recipients (format, count, domain whitelist)
    const validation = validateRecipients(to, cc, bcc);
    if (!validation.valid) {
      return res.status(403).json({ error: validation.error });
    }

    const gmailConfig = getGmailConfig();

    if (!gmailConfig.enabled) {
      return res.status(400).json({ error: 'Gmail integration is disabled' });
    }

    if (!gmailConfig.email || !gmailConfig.appPassword) {
      return res.status(400).json({ error: 'Gmail not configured' });
    }

    const transporter = await createTransporter(gmailConfig);

    // Build mail options
    const mailOptions = {
      from: gmailConfig.email,
      to,
      subject,
      text: body,
    };

    if (cc) mailOptions.cc = cc;
    if (bcc) mailOptions.bcc = bcc;

    if (html) {
      mailOptions.html = sanitizeHtml(html);
    }

    if (attachments && Array.isArray(attachments)) {
      mailOptions.attachments = attachments.map(att => ({
        filename: att.filename,
        content: att.content,
        contentType: att.contentType
      }));
    }

    try {
      const info = await transporter.sendMail(mailOptions);
      const recipientCount = [to, cc, bcc].filter(Boolean).join(',').split(',').length;
      log.info(`Sent email to ${recipientCount} recipient(s): ${info.messageId}`);
      recordAudit({ action: 'email:send', target: to, details: { subject, recipientCount }, ip: req.ip });
      res.json({ success: true, messageId: info.messageId });
    } catch (error) {
      log.error(`Failed to send email: ${error.message}`);
      res.status(502).json({ error: 'Failed to send email', detail: error.message });
    }
  } catch (error) {
    log.error(`Error in POST /email/send: ${error.message}`);
    res.status(500).json({ error: 'Failed to send email' });
  }
});

export default router;
