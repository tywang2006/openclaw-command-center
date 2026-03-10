const TOKEN_KEY = 'cmd_token'

// In production, BASE_URL = '/cmd/' (from vite.config.ts base).
// Strip trailing slash so '/cmd/' + '/api/foo' = '/cmd/api/foo'.
const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, '')

export function getToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string) {
  sessionStorage.setItem(TOKEN_KEY, token)
}

export function clearToken() {
  sessionStorage.removeItem(TOKEN_KEY)
}

let onUnauthorized: (() => void) | null = null

export function setOnUnauthorized(cb: () => void) {
  onUnauthorized = cb
}

export async function authedFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = getToken()
  const headers = new Headers(options.headers || {})
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }
  const fullUrl = url.startsWith('/api') ? `${API_BASE}${url}` : url
  const res = await fetch(fullUrl, { ...options, headers })
  if (res.status === 401) {
    clearToken()
    onUnauthorized?.()
  }
  return res
}
