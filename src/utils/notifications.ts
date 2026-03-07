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
