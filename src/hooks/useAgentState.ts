import { useEffect, useState, useRef, useCallback, useSyncExternalStore } from 'react'
import { authedFetch, getToken, clearToken } from '../utils/api'

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
  /** Gateway connection status: connected/disconnected/fatal */
  gatewayStatus: 'unknown' | 'connected' | 'disconnected' | 'fatal'
  gatewayDetail?: string
}

// Streaming texts store — decoupled from main state to avoid per-chunk re-renders
let _streamingTexts = new Map<string, string>()
let _streamingVersion = 0
const _streamingListeners = new Set<() => void>()

let _streamNotifyTimer: ReturnType<typeof setTimeout> | null = null
function _flushStreamNotify() {
  if (_streamNotifyTimer) { clearTimeout(_streamNotifyTimer); _streamNotifyTimer = null }
  _streamingVersion++
  for (const fn of _streamingListeners) fn()
}
function _notifyStreamListeners() {
  // Debounce: batch streaming notifications every 50ms to reduce re-renders during fast streaming
  if (_streamNotifyTimer) return
  _streamNotifyTimer = setTimeout(() => {
    _streamNotifyTimer = null
    _streamingVersion++
    for (const fn of _streamingListeners) fn()
  }, 50)
}

export function getStreamingSnapshot() { return _streamingTexts }
function subscribeStreaming(cb: () => void) {
  _streamingListeners.add(cb)
  return () => { _streamingListeners.delete(cb) }
}

/** Hook for components that need streaming text — only re-renders when streaming changes */
export function useStreamingTexts(): Map<string, string> {
  return useSyncExternalStore(subscribeStreaming, getStreamingSnapshot)
}

// Department visit events store — decoupled like streaming to avoid unnecessary re-renders
export interface DeptVisit {
  from: string
  to: string
  id: number
  message?: string
}
let _deptVisits: DeptVisit[] = []
let _visitVersion = 0
const _visitListeners = new Set<() => void>()

function _notifyVisitListeners() {
  _visitVersion++
  for (const fn of _visitListeners) fn()
}

function getVisitSnapshot() { return _deptVisits }
function subscribeVisits(cb: () => void) {
  _visitListeners.add(cb)
  return () => { _visitListeners.delete(cb) }
}

/** Hook for components that need dept visit events */
export function useDeptVisits(): DeptVisit[] {
  return useSyncExternalStore(subscribeVisits, getVisitSnapshot)
}

/** Pop the next visit from the queue (does NOT trigger re-renders) */
export function consumeVisit(): DeptVisit | undefined {
  if (_deptVisits.length === 0) return undefined
  const visit = _deptVisits[0]
  _deptVisits = _deptVisits.slice(1)
  return visit
}

// Meeting events store — decoupled for performance
interface MeetingEvent {
  type: 'start' | 'end'
  meetingId: string
  topic?: string
  deptIds: string[]
  timestamp: number
}

let meetingEvents: MeetingEvent[] = []
const meetingListeners = new Set<() => void>()

function emitMeetingChange() {
  for (const fn of meetingListeners) fn()
}

export function consumeMeetingEvent(): MeetingEvent | undefined {
  return meetingEvents.shift()
}

export function useMeetingEvents(): MeetingEvent[] {
  return useSyncExternalStore(
    (cb) => {
      meetingListeners.add(cb)
      return () => { meetingListeners.delete(cb) }
    },
    () => meetingEvents
  )
}

// Meeting department responses store — decoupled for real-time updates
interface MeetingDeptResponse {
  meetingId: string
  deptId: string
  text: string
  roundId: string
  deptIndex: number
  totalDepts: number
  timestamp: number
}

let meetingDeptResponses: MeetingDeptResponse[] = []
const meetingDeptListeners = new Set<() => void>()

function emitMeetingDeptChange() {
  for (const fn of meetingDeptListeners) fn()
}

export function consumeMeetingDeptResponse(): MeetingDeptResponse | undefined {
  if (meetingDeptResponses.length === 0) return undefined
  const item = meetingDeptResponses[0]
  meetingDeptResponses = meetingDeptResponses.slice(1)
  return item
}

export function useMeetingDeptResponses(): MeetingDeptResponse[] {
  return useSyncExternalStore(
    (cb) => {
      meetingDeptListeners.add(cb)
      return () => { meetingDeptListeners.delete(cb) }
    },
    () => meetingDeptResponses
  )
}

// Meeting round complete store
interface MeetingRoundComplete {
  meetingId: string
  roundId: string
  messageCount: number
  timestamp: number
}

let meetingRoundCompletes: MeetingRoundComplete[] = []
const meetingRoundListeners = new Set<() => void>()

function emitMeetingRoundChange() {
  for (const fn of meetingRoundListeners) fn()
}

export function consumeMeetingRoundComplete(): MeetingRoundComplete | undefined {
  if (meetingRoundCompletes.length === 0) return undefined
  const item = meetingRoundCompletes[0]
  meetingRoundCompletes = meetingRoundCompletes.slice(1)
  return item
}

export function useMeetingRoundCompletes(): MeetingRoundComplete[] {
  return useSyncExternalStore(
    (cb) => {
      meetingRoundListeners.add(cb)
      return () => { meetingRoundListeners.delete(cb) }
    },
    () => meetingRoundCompletes
  )
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
    gatewayStatus: 'unknown',
  })

  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<number | null>(null)
  const mountedRef = useRef<boolean>(true)
  const reconnectDelayRef = useRef<number>(1000)
  const reconnectCountRef = useRef<number>(0)
  const wsReceivedDepts = useRef(false)

  const connect = () => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }

    const token = getToken()
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/cmd/ws`
    const ws = new WebSocket(wsUrl)

    ws.onopen = () => {
      console.log('[WS] Connected, sending auth')
      // Authenticate via first message instead of URL query param
      ws.send(JSON.stringify({ type: 'auth', token }))
      reconnectDelayRef.current = 1000
      reconnectCountRef.current = 0
      if (mountedRef.current) {
        setState(prev => ({ ...prev, connected: true }))
      }
    }

    ws.onclose = (event) => {
      console.log('[WS] Disconnected')

      // If auth was revoked (1008 policy violation), redirect to login
      if (event.code === 1008) {
        console.log('[WS] Auth revoked (1008), clearing token and reloading')
        clearToken()
        window.location.reload()
        return
      }

      if (mountedRef.current) {
        setState(prev => ({ ...prev, connected: false }))
      }
      wsRef.current = null

      if (mountedRef.current) {
        reconnectCountRef.current++
        const delay = reconnectDelayRef.current
        reconnectTimeoutRef.current = window.setTimeout(() => {
          console.log(`[WS] Reconnecting... (attempt ${reconnectCountRef.current})`)
          connect()
        }, delay)
        reconnectDelayRef.current = Math.min(delay * 2, 60000)
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
          if (data?.deptId && _streamingTexts.has(data.deptId)) {
            _streamingTexts = new Map(_streamingTexts)
            _streamingTexts.delete(data.deptId)
            _flushStreamNotify()
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
          let chunk = data.chunk
          // Strip context tags from streaming chunks
          if (chunk.includes('<department_context>') || chunk.includes('<subagent_context>')) {
            chunk = chunk
              .replace(/<department_context>[\s\S]*?<\/department_context>\s*/g, '')
              .replace(/<subagent_context>[\s\S]*?<\/subagent_context>\s*/g, '')
          }
          if (!chunk) break
          _streamingTexts = new Map(_streamingTexts)
          const existing = _streamingTexts.get(data.deptId) || ''
          _streamingTexts.set(data.deptId, existing + chunk)
          _notifyStreamListeners()
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

      case 'dept:visit':
        if (data?.from && data?.to) {
          _deptVisits = [..._deptVisits, {
            from: data.from,
            to: data.to,
            id: Date.now() + Math.random(),
            message: data.message
          }]
          _notifyVisitListeners()
        }
        break

      case 'meeting:start':
        console.log('[WS] meeting:start received:', data)
        meetingEvents.push({
          type: 'start',
          meetingId: data.meetingId,
          topic: data.topic,
          deptIds: data.deptIds,
          timestamp: Date.now()
        })
        emitMeetingChange()
        break

      case 'meeting:end':
        meetingEvents.push({
          type: 'end',
          meetingId: data.meetingId,
          deptIds: data.deptIds,
          timestamp: Date.now()
        })
        emitMeetingChange()
        break

      case 'meeting:negotiation-start':
      case 'meeting:negotiation-vote':
      case 'meeting:negotiation-round':
      case 'meeting:negotiation-end':
        // Negotiation events - forward to meeting components via meeting events
        meetingEvents.push({
          type: event,
          ...data,
          timestamp: Date.now()
        } as any)
        emitMeetingChange()
        break

      case 'meeting:dept-response':
        console.log('[WS] meeting:dept-response received:', data)
        meetingDeptResponses.push({
          meetingId: data.meetingId,
          deptId: data.deptId,
          text: data.text,
          roundId: data.roundId,
          deptIndex: data.deptIndex,
          totalDepts: data.totalDepts,
          timestamp: data.timestamp || Date.now()
        })
        emitMeetingDeptChange()
        break

      case 'meeting:round-complete':
        console.log('[WS] meeting:round-complete received:', data)
        meetingRoundCompletes.push({
          meetingId: data.meetingId,
          roundId: data.roundId,
          messageCount: data.messageCount,
          timestamp: Date.now()
        })
        emitMeetingRoundChange()
        break

      case 'gateway:status':
        if (mountedRef.current && data?.status) {
          setState(prev => ({
            ...prev,
            gatewayStatus: data.status,
            gatewayDetail: data.detail || undefined,
          }))
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
