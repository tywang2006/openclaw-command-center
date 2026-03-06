import fs from 'fs';
import path from 'path';
import { chat, appendDailyLog } from './agent.js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8102890327:AAGMn9Ft2GA2T2ODOuZWDFqs1kI2BN6HWwc';
const GROUP_ID = process.env.TELEGRAM_GROUP_ID || '-1003570960670';
const TG_API = `https://api.telegram.org/bot${BOT_TOKEN}`;
const BASE_PATH = '/root/.openclaw/workspace';

let lastUpdateId = 0;
let pollingTimer = null;
let isPolling = false; // Guard against concurrent polls

/**
 * Load config to map topic IDs to department IDs
 */
function loadTopicMap() {
  try {
    const configPath = path.join(BASE_PATH, 'departments', 'config.json');
    const content = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(content);
    const map = {};
    for (const [topicId, dept] of Object.entries(config.departments)) {
      map[topicId] = { id: dept.id, name: dept.name };
      map[dept.id] = topicId; // reverse: deptId -> topicId
    }
    return map;
  } catch (err) {
    console.error('[Telegram] Failed to load topic map:', err.message);
    return {};
  }
}

/**
 * Send a text message to a Telegram topic
 */
async function sendToTelegram(topicId, text) {
  try {
    const params = new URLSearchParams({
      chat_id: GROUP_ID,
      text: text.substring(0, 4096), // Telegram limit
      parse_mode: 'Markdown',
    });
    if (topicId !== '1') {
      params.set('message_thread_id', topicId);
    }
    const res = await fetch(`${TG_API}/sendMessage?${params}`);
    const data = await res.json();
    if (!data.ok) {
      // Retry without parse_mode (Markdown might fail)
      params.delete('parse_mode');
      const res2 = await fetch(`${TG_API}/sendMessage?${params}`);
      return await res2.json();
    }
    return data;
  } catch (err) {
    console.error('[Telegram] Send error:', err.message);
    return null;
  }
}

/**
 * Poll Telegram for new messages using getUpdates
 */
async function pollUpdates(wss) {
  if (isPolling) return; // Skip if previous poll still running
  isPolling = true;
  try {
    const url = `${TG_API}/getUpdates?offset=${lastUpdateId + 1}&timeout=5&allowed_updates=["message"]`;
    const res = await fetch(url);
    const data = await res.json();

    if (!data.ok || !Array.isArray(data.result)) return;

    const topicMap = loadTopicMap();

    for (const update of data.result) {
      lastUpdateId = update.update_id;

      const msg = update.message;
      if (!msg) continue;

      // Only process messages from our group
      if (String(msg.chat?.id) !== GROUP_ID) continue;

      // Determine which department this message is for
      const threadId = msg.message_thread_id ? String(msg.message_thread_id) : '1';
      const deptInfo = topicMap[threadId] || null;

      if (!deptInfo) continue;
      const deptId = deptInfo.id;

      // Build activity message
      const fromName = msg.from?.first_name || msg.from?.username || 'Unknown';
      const isBot = msg.from?.is_bot || false;
      const text = msg.text || msg.caption || (msg.photo ? '[图片]' : '[消息]');

      // Skip bot messages (our own replies) to avoid loops
      if (isBot) continue;

      // Skip service messages (topic created, pinned, etc.)
      if (!msg.text && !msg.caption) continue;

      console.log(`[Telegram] ${deptId} <- ${fromName}: ${text.substring(0, 60)}`);

      // Broadcast user message to WebSocket clients
      const userActivity = {
        event: 'activity:new',
        data: {
          deptId,
          topicId: threadId,
          role: 'user',
          text,
          fromName,
          isBot: false,
          messageId: msg.message_id,
          source: 'telegram',
        },
        timestamp: new Date().toISOString(),
      };

      broadcast(wss, userActivity);

      // Trigger AI agent response (async, don't block polling)
      handleAgentResponse(wss, deptId, deptInfo.name, threadId, text);
    }
  } catch (err) {
    console.error('[Telegram] Poll error:', err.message);
  } finally {
    isPolling = false;
  }
}

/**
 * Handle AI agent response to a Telegram message
 */
async function handleAgentResponse(wss, deptId, deptName, topicId, userMessage) {
  try {
    const result = await chat(deptId, userMessage);

    let replyText;
    if (result.success && result.reply) {
      replyText = result.reply;
    } else {
      // Always respond, even on error
      const reason = result.error || '未知错误';
      if (reason.includes('429') || reason.includes('quota') || reason.includes('rate')) {
        replyText = `[系统通知] AI 服务暂时达到调用限额，请稍后再试。(${reason.substring(0, 100)})`;
      } else {
        replyText = `[系统通知] 暂时无法回复: ${reason.substring(0, 200)}`;
      }
      console.error(`[Telegram] Agent ${deptId} error:`, result.error);
    }

    console.log(`[Telegram] ${deptId} -> ${replyText.substring(0, 60)}`);

    // Send reply back to Telegram
    await sendToTelegram(topicId, replyText);

    // Broadcast agent reply to WebSocket clients
    const botActivity = {
      event: 'activity:new',
      data: {
        deptId,
        topicId,
        role: 'assistant',
        text: replyText,
        fromName: deptName,
        isBot: true,
        source: 'telegram',
      },
      timestamp: new Date().toISOString(),
    };

    broadcast(wss, botActivity);
  } catch (err) {
    console.error(`[Telegram] Agent response error for ${deptId}:`, err.message);
  }
}

/**
 * Broadcast a message to all WebSocket clients
 */
function broadcast(wss, message) {
  const payload = JSON.stringify(message);
  wss.clients.forEach(client => {
    if (client.readyState === 1) {
      try { client.send(payload); } catch {}
    }
  });
}

/**
 * Start polling loop
 */
function startPolling(wss) {
  console.log('[Telegram] Starting message polling...');

  // Initial poll to set lastUpdateId (skip old messages)
  fetch(`${TG_API}/getUpdates?offset=-1`)
    .then(res => res.json())
    .then(data => {
      if (data.ok && data.result.length > 0) {
        lastUpdateId = data.result[data.result.length - 1].update_id;
        console.log(`[Telegram] Initialized at update_id: ${lastUpdateId}`);
      }
      // Start polling loop
      const poll = async () => {
        await pollUpdates(wss);
        pollingTimer = setTimeout(poll, 1000);
      };
      poll();
    })
    .catch(err => {
      console.error('[Telegram] Init error:', err.message);
      setTimeout(() => startPolling(wss), 5000);
    });
}

/**
 * Stop polling
 */
function stopPolling() {
  if (pollingTimer) {
    clearTimeout(pollingTimer);
    pollingTimer = null;
  }
  console.log('[Telegram] Polling stopped');
}

export { startPolling, stopPolling };
