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
  const fullUrl = url.startsWith('/') ? `${API_BASE}${url}` : url
  const res = await fetch(fullUrl, { ...options, headers })
  if (res.status === 401) {
    clearToken()
    onUnauthorized?.()
  }
  return res
}

/**
 * Extract a meaningful error message from an API response or error object.
 * Handles common patterns:
 * - Response JSON with { error: "..." }
 * - Response JSON with { message: "..." }
 * - HTTP status codes
 * - Error objects with .message
 * - Network errors
 */
export async function extractErrorMessage(
  error: unknown,
  fallbackMessage: string = '操作失败'
): Promise<string> {
  // If it's a Response object, try to extract JSON error
  if (error instanceof Response) {
    try {
      const data = await error.json()
      if (data.error) {
        return typeof data.error === 'string' ? data.error : JSON.stringify(data.error)
      }
      if (data.message) {
        return data.message
      }
    } catch {
      // JSON parse failed, fall through to status code
    }

    // Map HTTP status codes to user-friendly messages
    switch (error.status) {
      case 400:
        return '请求参数错误'
      case 401:
        return '未授权，请重新登录'
      case 403:
        return '没有权限执行此操作'
      case 404:
        return '请求的资源不存在'
      case 409:
        return '操作冲突，请稍后重试'
      case 429:
        return '请求过于频繁，请稍后重试'
      case 500:
        return '服务器内部错误'
      case 502:
        return '网关错误'
      case 503:
        return '服务暂时不可用'
      default:
        return `HTTP ${error.status}: ${error.statusText || fallbackMessage}`
    }
  }

  // If it's an Error object with a message
  if (error instanceof Error) {
    // Filter out generic/unhelpful messages
    if (error.message && !error.message.match(/^(Failed to fetch|NetworkError|Load failed)$/i)) {
      return error.message
    }
    // Network error
    if (error.message.match(/^(Failed to fetch|NetworkError|Load failed)$/i)) {
      return '网络连接失败，请检查网络'
    }
  }

  // If it's a string
  if (typeof error === 'string') {
    return error
  }

  // Fallback
  return fallbackMessage
}
