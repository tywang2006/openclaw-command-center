import express from 'express';
import nodemailer from 'nodemailer';
import path from 'path';
import { BASE_PATH, readJsonFile } from '../utils.js';
import { getEncryptionKey, decryptSensitiveFields, migratePlaintextFields } from '../crypto.js';
import { recordAudit } from './audit.js';

const router = express.Router();

const CONFIG_PATH = path.join(BASE_PATH, '..', 'command-center', 'integrations.json');

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
      console.log(`[Email] Port ${cfg.port} failed: ${err.message}`);
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
 * Helper: Get allowed email domains from config
 */
function getAllowedDomains() {
  const config = readJsonFile(CONFIG_PATH);
  // Allow configuring allowedDomains in integrations.json under gmail
  if (config?.gmail?.allowedDomains && Array.isArray(config.gmail.allowedDomains)) {
    return config.gmail.allowedDomains.map(d => d.toLowerCase());
  }
  // Default: only allow sending to the sender's own domain
  const gmailConfig = config?.gmail || {};
  if (gmailConfig.email) {
    const domain = gmailConfig.email.split('@')[1];
    if (domain) return [domain.toLowerCase()];
  }
  return [];
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
    console.error('[Email] Error in GET /email/status:', error);
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
    console.error('[Email] Error in POST /email/test:', error);
    res.status(502).json({ error: 'Gmail connection failed', detail: error.message });
  }
});

/**
 * POST /email/send
 * Send email via Gmail
 * Body: { to, subject, body, html?, attachments? }
 */
router.post('/email/send', async (req, res) => {
  try {
    const { to, subject, body, html, attachments } = req.body;

    // Validation
    if (!to || !isValidEmail(to)) {
      return res.status(400).json({ error: 'Valid recipient email is required' });
    }

    if (!subject || !subject.trim()) {
      return res.status(400).json({ error: 'Subject is required' });
    }

    if (!body && !html) {
      return res.status(400).json({ error: 'Email body or html content is required' });
    }

    // Domain whitelist check
    const allowedDomains = getAllowedDomains();
    if (allowedDomains.length > 0) {
      const recipientDomain = to.split('@')[1]?.toLowerCase();
      if (!recipientDomain || !allowedDomains.includes(recipientDomain)) {
        return res.status(403).json({
          error: `Recipient domain not allowed. Allowed domains: ${allowedDomains.join(', ')}`,
        });
      }
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

    if (html) {
      mailOptions.html = html;
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
      console.log(`[Email] Sent email to ${to}: ${info.messageId}`);
      recordAudit({ action: 'email:send', target: to, details: { subject }, ip: req.ip });
      res.json({ success: true, messageId: info.messageId });
    } catch (error) {
      console.error('[Email] Failed to send email:', error);
      res.status(502).json({ error: 'Failed to send email', detail: error.message });
    }
  } catch (error) {
    console.error('[Email] Error in POST /email/send:', error);
    res.status(500).json({ error: 'Failed to send email' });
  }
});

export default router;
