import express from 'express';
import webpush from 'web-push';
import fs from 'fs';
import path from 'path';
import { safeWriteFileSync } from '../utils.js';

const CONFIG_PATH = path.join(process.env.HOME || '/root', '.openclaw/command-center/push-config.json');
const MAX_SUBSCRIPTIONS = 50;

let vapidKeys = null;
let subscriptions = [];

function loadConfig() {
  try {
    const data = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    vapidKeys = data.vapidKeys;
    subscriptions = data.subscriptions || [];
    webpush.setVapidDetails('mailto:admin@chaoclaw.com', vapidKeys.publicKey, vapidKeys.privateKey);
  } catch {
    vapidKeys = webpush.generateVAPIDKeys();
    subscriptions = [];
    webpush.setVapidDetails('mailto:admin@chaoclaw.com', vapidKeys.publicKey, vapidKeys.privateKey);
    saveConfig();
  }
}

function saveConfig() {
  const dir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  safeWriteFileSync(CONFIG_PATH, JSON.stringify({ vapidKeys, subscriptions }, null, 2), { mode: 0o600 });
}

loadConfig();

const router = express.Router();

router.get('/vapid-key', (req, res) => {
  res.json({ publicKey: vapidKeys.publicKey });
});

router.post('/subscribe', (req, res) => {
  const { subscription } = req.body;
  if (!subscription || !subscription.endpoint) return res.status(400).json({ error: 'Invalid subscription' });
  const exists = subscriptions.find(s => s.endpoint === subscription.endpoint);
  if (!exists) {
    subscriptions.push(subscription);
    if (subscriptions.length > MAX_SUBSCRIPTIONS) subscriptions.shift();
    saveConfig();
  }
  res.json({ success: true });
});

router.post('/unsubscribe', (req, res) => {
  const { endpoint } = req.body;
  subscriptions = subscriptions.filter(s => s.endpoint !== endpoint);
  saveConfig();
  res.json({ success: true });
});

export async function sendPush({ title, body, category, url }) {
  if (!subscriptions.length) return;
  const payload = JSON.stringify({ title, body, category: category || 'info', url: url || '/cmd/' });
  const stale = [];
  await Promise.allSettled(subscriptions.map(async (sub, i) => {
    try {
      await webpush.sendNotification(sub, payload);
    } catch (err) {
      if (err.statusCode === 410 || err.statusCode === 404) stale.push(i);
    }
  }));
  if (stale.length) {
    subscriptions = subscriptions.filter((_, i) => !stale.includes(i));
    saveConfig();
  }
}

export default router;
