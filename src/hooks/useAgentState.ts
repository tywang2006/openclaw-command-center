import { useEffect, useState, useRef } from 'react'
import { authedFetch, getToken } from '../utils/api'

export interface Department {
  id: string
  name: string
  icon: string
  color: string
  hue: number
  order: number
  agent?: string
  telegramTopicId?: number
  status: 'active' | 'idle' | 'offline'
  lastSeen: number
  currentTask?: string
}

export interface Request {
  filename: string
  content: string
  date: string
}

export interface Attachment {
  name: string
  url: string
  size: number
}

export interface Activity {
  deptId: string
  role: 'user' | 'assistant'
  text: string
  timestamp: number
  images?: string[]
  attachments?: Attachment[]
  source?: string   // 'app' | 'telegram' | 'gateway' | 'cron'
  fromName?: string  // sender name (e.g. Telegram username)
}

export interface ToolState {
  toolName: string
  status: string
  done: boolean
}

export interface AgentState {
  departments: Department[]
  bulletin: string
  memories: Map<string, string>
  requests: Request[]
  activities: Activity[]
  selectedDeptId: string | null
  connected: boolean
  /** Active tool states per department */
  toolStates: Map<string, ToolState>
  /** Streaming text per department (F14) */
  streamingTexts: Map<string, string>
}

function parseDepartment(d: any): Department {
  return {
    id: d.id || d.name,
    name: d.name || d.id,
    icon: d.icon || 'bolt',
    color: d.color || '#94a3b8',
    hue: d.hue ?? 200,
    order: d.order ?? 0,
    agent: d.agent,
    telegramTopicId: d.telegramTopicId,
    status: d.status || 'idle',
    lastSeen: d.lastSeen ? new Date(d.lastSeen).getTime() : Date.now(),
    currentTask: d.currentTask || undefined,
  }
}

export function useAgentState() {
  const [state, setState] = useState<AgentState>({
    departments: [],
    bulletin: '',
    memories: new Map(),
    requests: [],
    activities: [],
    selectedDeptId: null,
    connected: false,
    toolStates: new Map(),
    streamingTexts: new Map(),
  })

  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<number | null>(null)
  const mountedRef = useRef<boolean>(true)
  const reconnectDelayRef = useRef<number>(1000)
  const reconnectCountRef = useRef<number>(0)
  const wsReceivedDepts = useRef(false)
  const MAX_RECONNECT = 20

  const connect = () => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }

    const token = getToken()
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/cmd/ws${token ? `?token=${token}` : ''}`
    const ws = new WebSocket(wsUrl)

    ws.onopen = () => {
      console.log('[WS] Connected')
      reconnectDelayRef.current = 1000
      reconnectCountRef.current = 0
      if (mountedRef.current) {
        setState(prev => ({ ...prev, connected: true }))
      }
    }

    ws.onclose = () => {
      console.log('[WS] Disconnected')
      if (mountedRef.current) {
        setState(prev => ({ ...prev, connected: false }))
      }
      wsRef.current = null

      if (mountedRef.current) {
        reconnectCountRef.current++
        if (reconnectCountRef.current > MAX_RECONNECT) {
          console.error('[WS] Max reconnect attempts reached')
          return  // Stop reconnecting
        }
        const delay = reconnectDelayRef.current
        reconnectTimeoutRef.current = window.setTimeout(() => {
          console.log(`[WS] Reconnecting... (attempt ${reconnectCountRef.current}/${MAX_RECONNECT})`)
          connect()
        }, delay)
        reconnectDelayRef.current = Math.min(delay * 2, 30000)
      }
    }

    ws.onerror = (error) => {
      console.error('[WS] Error:', error)
    }

    ws.onmessage = (evt) => {
      try {
        const message = JSON.parse(evt.data)
        handleMessage(message)
      } catch (err) {
        console.error('[WS] Failed to parse message:', err)
      }
    }

    wsRef.current = ws
  }

  const handleMessage = (message: any) => {
    if (!mountedRef.current) return

    // Server sends { event, data, timestamp }
    const { event, data } = message

    switch (event) {
      case 'connected':
        // Initial full state from server — takes priority over REST fallback
        console.log('[WS] Received initial state')
        wsReceivedDepts.current = true
        if (mountedRef.current) {
          setState(prev => {
            const departments = Array.isArray(data?.departments)
              ? data.departments.map(parseDepartment)
              : prev.departments
            const bulletin = data?.bulletin || prev.bulletin
            const requests = Array.isArray(data?.requests)
              ? data.requests.map((r: any) => ({
                  filename: r.filename,
                  content: r.content,
                  date: r.modified || r.created || new Date().toISOString(),
                }))
              : prev.requests
            return { ...prev, departments, bulletin, requests }
          })
        }
        break

      case 'status:update':
        if (mountedRef.current) {
          setState(prev => {
            const departments = [...prev.departments]
            const deptId = data?.deptId || data?.id
            const index = departments.findIndex(d => d.id === deptId)
            if (index >= 0) {
              departments[index] = {
                ...departments[index],
                status: data.status || departments[index].status,
                lastSeen: Date.now(),
                currentTask: data.currentTask,
              }
            }
            return { ...prev, departments }
          })
        }
        break

      case 'bulletin:update':
        if (mountedRef.current) {
          setState(prev => ({ ...prev, bulletin: data?.content || '' }))
        }
        break

      case 'memory:update':
        if (mountedRef.current) {
          setState(prev => {
            const memories = new Map(prev.memories)
            memories.set(data?.deptId, data?.content || '')
            return { ...prev, memories }
          })
        }
        break

      case 'request:new':
        if (mountedRef.current) {
          setState(prev => ({
            ...prev,
            requests: [
              {
                filename: data?.filename || 'unknown',
                content: data?.content || '',
                date: new Date().toISOString(),
              },
              ...prev.requests,
            ].slice(0, 100),
          }))
        }
        break

      case 'activity:new':
        if (mountedRef.current) {
          // Clear streaming text for this dept when final message arrives (F14)
          if (data?.deptId) {
            setState(prev => {
              if (prev.streamingTexts.has(data.deptId)) {
                const streamingTexts = new Map(prev.streamingTexts)
                streamingTexts.delete(data.deptId)
                return { ...prev, streamingTexts }
              }
              return prev
            })
          }
          // Handle both single-message format (from telegram.js/gateway events)
          // and multi-message format (from watcher.js session files)
          if (Array.isArray(data?.messages)) {
            // Multi-message format from session file watcher
            setState(prev => ({
              ...prev,
              activities: [
                ...prev.activities,
                ...data.messages.map((msg: any) => ({
                  deptId: data?.deptId,
                  role: msg.role === 'user' ? 'user' as const : 'assistant' as const,
                  text: msg.text || '',
                  timestamp: msg.timestamp ? new Date(msg.timestamp).getTime() : Date.now(),
                  source: data?.source || 'session',
                })),
              ].slice(-200),
            }))
          } else {
            // Single-message format
            setState(prev => ({
              ...prev,
              activities: [
                ...prev.activities,
                {
                  deptId: data?.deptId,
                  role: data?.role || 'assistant',
                  text: data?.text || '',
                  timestamp: Date.now(),
                  source: data?.source,
                  fromName: data?.fromName,
                },
              ].slice(-200),
            }))
          }
        }
        break

      case 'chat:stream':
        if (mountedRef.current && data?.deptId && data?.chunk) {
          setState(prev => {
            const streamingTexts = new Map(prev.streamingTexts)
            const existing = streamingTexts.get(data.deptId) || ''
            streamingTexts.set(data.deptId, existing + data.chunk)
            return { ...prev, streamingTexts }
          })
        }
        break

      case 'tool:update':
        if (mountedRef.current && data?.deptId) {
          setState(prev => {
            const toolStates = new Map(prev.toolStates)
            if (data.done) {
              toolStates.delete(data.deptId)
            } else {
              toolStates.set(data.deptId, {
                toolName: data.toolName || 'unknown',
                status: data.toolStatus || 'running',
                done: false,
              })
            }
            return { ...prev, toolStates }
          })
        }
        break

      case 'departments:updated':
        // Reload departments from REST API
        authedFetch('/api/departments')
          .then(res => res.json())
          .then(data => {
            if (Array.isArray(data?.departments) && mountedRef.current) {
              setState(prev => ({
                ...prev,
                departments: data.departments.map(parseDepartment),
              }))
            }
          })
          .catch(() => {})
        break

      default:
        console.log('[WS] Unknown event:', event, data)
    }
  }

  // REST fallback — only applies if WS hasn't delivered departments yet
  useEffect(() => {
    authedFetch('/api/departments')
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then(data => {
        if (wsReceivedDepts.current) return // WS already delivered, skip stale REST
        const depts = data?.departments
        if (Array.isArray(depts) && depts.length > 0 && mountedRef.current) {
          setState(prev => ({
            ...prev,
            departments: depts.map(parseDepartment),
          }))
        }
      })
      .catch(err => {
        console.error('[API] Failed to fetch departments:', err)
      })
  }, [])

  // Connect WebSocket
  useEffect(() => {
    mountedRef.current = true
    connect()

    return () => {
      mountedRef.current = false
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }
      if (wsRef.current) {
        wsRef.current.close()
      }
    }
  }, [])

  const setSelectedDeptId = (deptId: string | null) => {
    setState(prev => ({ ...prev, selectedDeptId: deptId }))
  }

  const addActivity = (activity: Activity) => {
    setState(prev => ({
      ...prev,
      activities: [...prev.activities, activity].slice(-200),
    }))
  }

  return {
    ...state,
    setSelectedDeptId,
    addActivity,
  }
}
