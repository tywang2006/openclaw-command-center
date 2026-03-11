import express from 'express';
import nodemailer from 'nodemailer';
import path from 'path';
import { BASE_PATH, readJsonFile } from '../utils.js';

const router = express.Router();

const CONFIG_PATH = path.join(BASE_PATH, '..', 'command-center', 'integrations.json');

/**
 * Helper: Get Gmail configuration
 */
function getGmailConfig() {
  const config = readJsonFile(CONFIG_PATH);
  return config?.gmail || { enabled: false, email: '', appPassword: '' };
}

/**
 * Helper: Create nodemailer transporter
 */
function createTransporter(gmailConfig) {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: gmailConfig.email,
      pass: gmailConfig.appPassword
    }
  });
}

/**
 * Helper: Validate email address
 */
function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
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

    const transporter = createTransporter(gmailConfig);

    try {
      await transporter.verify();
      res.json({ success: true, message: 'Gmail connection successful' });
    } catch (error) {
      console.error('[Email] Gmail verification failed:', error);
      res.status(502).json({ error: 'Gmail connection failed', detail: error.message });
    }
  } catch (error) {
    console.error('[Email] Error in POST /email/test:', error);
    res.status(500).json({ error: 'Failed to test email connection' });
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

    const gmailConfig = getGmailConfig();

    if (!gmailConfig.enabled) {
      return res.status(400).json({ error: 'Gmail integration is disabled' });
    }

    if (!gmailConfig.email || !gmailConfig.appPassword) {
      return res.status(400).json({ error: 'Gmail not configured' });
    }

    const transporter = createTransporter(gmailConfig);

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
