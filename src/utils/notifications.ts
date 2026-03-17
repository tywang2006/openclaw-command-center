// Browser Notification API wrapper with localStorage preferences

interface NotificationPrefs {
  enabled: boolean
  errors: boolean
  gateway: boolean
  slow: boolean
  slowThresholdMs: number
}

const PREFS_KEY = 'openclaw-notification-prefs'

const DEFAULT_PREFS: NotificationPrefs = {
  enabled: false,
  errors: true,
  gateway: true,
  slow: true,
  slowThresholdMs: 30000,
}

export function getNotificationPrefs(): NotificationPrefs {
  try {
    const stored = localStorage.getItem(PREFS_KEY)
    if (stored) return { ...DEFAULT_PREFS, ...JSON.parse(stored) }
  } catch {}
  return { ...DEFAULT_PREFS }
}

export function saveNotificationPrefs(prefs: NotificationPrefs): void {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
}

export async function requestPermission(): Promise<boolean> {
  if (!('Notification' in window)) return false
  if (Notification.permission === 'granted') return true
  if (Notification.permission === 'denied') return false
  const result = await Notification.requestPermission()
  return result === 'granted'
}

export function showNotification(title: string, body: string): void {
  const prefs = getNotificationPrefs()
  if (!prefs.enabled) return
  if (!('Notification' in window)) return
  if (Notification.permission !== 'granted') return

  try {
    new Notification(title, {
      body,
      icon: '/favicon.ico',
      tag: title, // Prevents duplicate notifications
    })
  } catch {}
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

export async function subscribePush(): Promise<boolean> {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
    const reg = await navigator.serviceWorker.register('/cmd/sw.js');
    const res = await fetch('/cmd/api/push/vapid-key');
    const { publicKey } = await res.json();
    const appServerKey = urlBase64ToUint8Array(publicKey);
    const subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: appServerKey as BufferSource,
    });
    await fetch('/cmd/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription }),
    });
    return true;
  } catch (e) {
    console.error('Push subscribe failed:', e);
    return false;
  }
}

export async function unsubscribePush(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker.ready;
    const subscription = await reg.pushManager.getSubscription();
    if (subscription) {
      const endpoint = subscription.endpoint;
      await subscription.unsubscribe();
      await fetch('/cmd/api/push/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint }),
      });
    }
  } catch (e) {
    console.error('Push unsubscribe failed:', e);
  }
}
