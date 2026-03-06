import { useEffect, useState, useRef } from 'react'

export interface Department {
  id: string
  name: string
  emoji: string
  status: 'active' | 'idle' | 'offline'
  lastSeen: number
  currentTask?: string
}

export interface Request {
  filename: string
  content: string
  date: string
}

export interface Activity {
  deptId: string
  role: 'user' | 'assistant'
  text: string
  timestamp: number
}

export interface AgentState {
  departments: Department[]
  bulletin: string
  memories: Map<string, string>
  requests: Request[]
  activities: Activity[]
  selectedDeptId: string | null
  connected: boolean
}

function parseDepartment(d: any): Department {
  return {
    id: d.id || d.name,
    name: d.name || d.id,
    emoji: d.emoji || '',
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
  })

  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<number | null>(null)
  const mountedRef = useRef<boolean>(true)
  const reconnectDelayRef = useRef<number>(1000)

  const connect = () => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${protocol}//${window.location.host}/cmd/ws`)

    ws.onopen = () => {
      console.log('[WS] Connected')
      reconnectDelayRef.current = 1000
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
        const delay = reconnectDelayRef.current
        reconnectTimeoutRef.current = window.setTimeout(() => {
          console.log('[WS] Reconnecting...')
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
        // Initial full state from server
        console.log('[WS] Received initial state')
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
          setState(prev => ({
            ...prev,
            activities: [
              ...prev.activities,
              {
                deptId: data?.deptId,
                role: data?.role || 'assistant',
                text: data?.text || '',
                timestamp: Date.now(),
              },
            ].slice(-200),
          }))
        }
        break

      default:
        console.log('[WS] Unknown event:', event, data)
    }
  }

  // Also fetch departments via REST as backup
  useEffect(() => {
    fetch('/cmd/api/departments')
      .then(res => res.json())
      .then(data => {
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
