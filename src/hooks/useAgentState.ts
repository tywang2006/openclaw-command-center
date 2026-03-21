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
  /** WebSocket connection state for UI visibility */
  connectionState: 'connected' | 'reconnecting' | 'background-retry' | 'disconnected'
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
  // Debounce: batch streaming notifications every 16ms (60fps) for smooth streaming with minimal re-renders
  if (_streamNotifyTimer) return
  _streamNotifyTimer = setTimeout(() => {
    _streamNotifyTimer = null
    _streamingVersion++
    for (const fn of _streamingListeners) fn()
  }, 16)
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
// Cap arrays to prevent unbounded growth if events aren't consumed
const MAX_EVENT_QUEUE = 100

// Base meeting event
interface BaseMeetingEvent {
  meetingId: string
  timestamp: number
}

// Meeting lifecycle events
interface MeetingStartEvent extends BaseMeetingEvent {
  type: 'start'
  topic?: string
  deptIds: string[]
}

interface MeetingEndEvent extends BaseMeetingEvent {
  type: 'end'
  deptIds: string[]
}

// Negotiation events
interface NegotiationStartEvent extends BaseMeetingEvent {
  type: 'meeting:negotiation-start'
  proposal: string
  maxRounds: number
}

interface NegotiationVoteEvent extends BaseMeetingEvent {
  type: 'meeting:negotiation-vote'
  deptId: string
  stance: 'agree' | 'disagree' | 'modify' | 'abstain'
  reason: string
  suggestion?: string
  round: number
}

interface NegotiationRoundEvent extends BaseMeetingEvent {
  type: 'meeting:negotiation-round'
  round: number
  maxRounds: number
  agreeCount: number
  total: number
}

interface NegotiationEndEvent extends BaseMeetingEvent {
  type: 'meeting:negotiation-end'
  result: 'accepted' | 'rejected' | 'timeout'
  agreeCount: number
  total: number
}

// Action items event
interface ActionItemsEvent extends BaseMeetingEvent {
  type: 'meeting:action-items'
  actionItems: Array<{
    task: string
    assignedTo: string
    dueDate?: string
    priority?: string
  }>
}

// Union type for all meeting events
export type MeetingEvent =
  | MeetingStartEvent
  | MeetingEndEvent
  | NegotiationStartEvent
  | NegotiationVoteEvent
  | NegotiationRoundEvent
  | NegotiationEndEvent
  | ActionItemsEvent

let meetingEvents: MeetingEvent[] = []
const meetingListeners = new Set<() => void>()

function emitMeetingChange() {
  for (const fn of meetingListeners) fn()
}

export function consumeMeetingEvent(): MeetingEvent | undefined {
  if (meetingEvents.length === 0) return undefined
  const item = meetingEvents[0]
  meetingEvents = meetingEvents.slice(1)
  return item
}

export function useMeetingEvents(): readonly MeetingEvent[] {
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

// Sub-agent events store — decoupled for real-time updates
export interface SubAgentEvent {
  type: 'created' | 'removed' | 'status-changed'
  deptId: string
  subId: string
  name?: string
  task?: string
  status?: string
  timestamp: number
}

let subAgentEvents: SubAgentEvent[] = []
const subAgentListeners = new Set<() => void>()

function emitSubAgentChange() {
  for (const fn of subAgentListeners) fn()
}

export function consumeSubAgentEvent(): SubAgentEvent | undefined {
  if (subAgentEvents.length === 0) return undefined
  const item = subAgentEvents[0]
  subAgentEvents = subAgentEvents.slice(1)
  return item
}

export function useSubAgentEvents(): SubAgentEvent[] {
  return useSyncExternalStore(
    (cb) => {
      subAgentListeners.add(cb)
      return () => { subAgentListeners.delete(cb) }
    },
    () => subAgentEvents
  )
}

// Audit events store — decoupled for real-time updates
export interface AuditEvent {
  id: string
  timestamp: string
  action: string
  target: string
  deptId: string | null
  details: unknown
  ip: string | null
}

let auditEvents: AuditEvent[] = []
const auditListeners = new Set<() => void>()

function emitAuditChange() {
  for (const fn of auditListeners) fn()
}

export function consumeAuditEvent(): AuditEvent | undefined {
  if (auditEvents.length === 0) return undefined
  const item = auditEvents[0]
  auditEvents = auditEvents.slice(1)
  return item
}

export function useAuditEvents(): AuditEvent[] {
  return useSyncExternalStore(
    (cb) => {
      auditListeners.add(cb)
      return () => { auditListeners.delete(cb) }
    },
    () => auditEvents
  )
}

interface RawDepartment {
  id?: string
  name?: string
  icon?: string
  color?: string
  hue?: number
  order?: number
  agent?: string
  telegramTopicId?: number
  status?: 'active' | 'idle' | 'offline'
  lastSeen?: string | number
  currentTask?: string
}

function parseDepartment(d: RawDepartment): Department {
  return {
    id: d.id || d.name || '',
    name: d.name || d.id || '',
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

const MAX_RETRIES = 20
const BACKGROUND_RETRY_INTERVAL_MS = 60000

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
    connectionState: 'disconnected',
  })

  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<number | null>(null)
  const mountedRef = useRef<boolean>(true)
  const reconnectDelayRef = useRef<number>(1000)
  const reconnectCountRef = useRef<number>(0)
  const wsReceivedDepts = useRef(false)
  const backgroundRetryTimerRef = useRef<number | null>(null)

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
      // Authenticate via first message instead of URL query param
      ws.send(JSON.stringify({ type: 'auth', token }))
      reconnectDelayRef.current = 1000
      reconnectCountRef.current = 0

      // Clear background retry if active
      if (backgroundRetryTimerRef.current) {
        clearTimeout(backgroundRetryTimerRef.current)
        backgroundRetryTimerRef.current = null
      }

      if (mountedRef.current) {
        setState(prev => ({ ...prev, connected: true, connectionState: 'connected' }))
      }
    }

    ws.onclose = (event) => {
      // If auth was revoked (4001 or 1008), redirect to login
      if (event.code === 4001 || event.code === 1008) {
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

        // After MAX_RETRIES, switch to background retry mode
        if (reconnectCountRef.current > MAX_RETRIES) {
          if (mountedRef.current) {
            setState(prev => ({ ...prev, connectionState: 'background-retry' }))
          }
          scheduleBackgroundRetry()
        } else {
          const delay = reconnectDelayRef.current
          if (mountedRef.current) {
            setState(prev => ({ ...prev, connectionState: 'reconnecting' }))
          }
          reconnectTimeoutRef.current = window.setTimeout(() => {
            connect()
          }, delay)
          reconnectDelayRef.current = Math.min(delay * 2, 60000)
        }
      }
    }

    const scheduleBackgroundRetry = () => {
      if (backgroundRetryTimerRef.current) {
        clearTimeout(backgroundRetryTimerRef.current)
      }

      backgroundRetryTimerRef.current = window.setTimeout(() => {
        if (!mountedRef.current) return
        connect()
      }, BACKGROUND_RETRY_INTERVAL_MS)
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

  interface WebSocketMessage {
    event: string
    data?: unknown
    timestamp?: number
  }

  const handleMessage = (message: WebSocketMessage) => {
    if (!mountedRef.current) return

    // Server sends { event, data, timestamp }
    const { event, data } = message
    // Helper to safely cast data
    const d = (data || {}) as Record<string, unknown>

    switch (event) {
      case 'connected':
        // Initial full state from server — takes priority over REST fallback
        wsReceivedDepts.current = true
        if (mountedRef.current) {
          setState(prev => {
            const departments = Array.isArray(d.departments)
              ? (d.departments as RawDepartment[]).map(parseDepartment)
              : prev.departments
            const bulletin = typeof d.bulletin === 'string' ? d.bulletin : prev.bulletin
            interface RawRequest {
              filename?: string
              content?: string
              modified?: string
              created?: string
            }
            const requests = Array.isArray(d.requests)
              ? (d.requests as RawRequest[]).map((r) => ({
                  filename: r.filename || '',
                  content: r.content || '',
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
            const deptId = (d.deptId || d.id) as string | undefined
            const index = deptId ? departments.findIndex(dept => dept.id === deptId) : -1
            if (index >= 0) {
              const status = d.status as 'active' | 'idle' | 'offline' | undefined
              departments[index] = {
                ...departments[index],
                status: status || departments[index].status,
                lastSeen: Date.now(),
                currentTask: d.currentTask as string | undefined,
              }
            }
            return { ...prev, departments }
          })
        }
        break

      case 'bulletin:update':
        if (mountedRef.current) {
          setState(prev => ({ ...prev, bulletin: (d.content as string) || '' }))
        }
        break

      case 'memory:update':
        if (mountedRef.current) {
          setState(prev => {
            const memories = new Map(prev.memories)
            const deptId = d.deptId as string | undefined
            if (deptId) {
              memories.set(deptId, (d.content as string) || '')
            }
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
                filename: (d.filename as string) || 'unknown',
                content: (d.content as string) || '',
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
          const deptId = d.deptId as string | undefined
          if (deptId && _streamingTexts.has(deptId)) {
            _streamingTexts = new Map(_streamingTexts)
            _streamingTexts.delete(deptId)
            _flushStreamNotify()
          }
          // Handle both single-message format (from telegram.js/gateway events)
          // and multi-message format (from watcher.js session files)
          if (Array.isArray(d.messages)) {
            // Multi-message format from session file watcher
            interface RawMessage {
              role?: string
              text?: string
              timestamp?: string | number
            }
            setState(prev => ({
              ...prev,
              activities: [
                ...prev.activities,
                ...(d.messages as RawMessage[]).map((msg) => ({
                  deptId: deptId || '',
                  role: msg.role === 'user' ? 'user' as const : 'assistant' as const,
                  text: msg.text || '',
                  timestamp: msg.timestamp ? new Date(msg.timestamp).getTime() : Date.now(),
                  source: (d.source as string) || 'session',
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
                  deptId: deptId || '',
                  role: (d.role as 'user' | 'assistant') || 'assistant',
                  text: (d.text as string) || '',
                  timestamp: Date.now(),
                  source: d.source as string | undefined,
                  fromName: d.fromName as string | undefined,
                },
              ].slice(-200),
            }))
          }
        }
        break

      case 'chat:stream': {
        const streamDeptId = d.deptId as string | undefined
        const streamChunk = d.chunk as string | undefined
        if (mountedRef.current && streamDeptId && streamChunk) {
          let chunk = streamChunk
          // Strip context tags from streaming chunks
          if (chunk.includes('<department_context>') || chunk.includes('<subagent_context>')) {
            chunk = chunk
              .replace(/<department_context>[\s\S]*?<\/department_context>\s*/g, '')
              .replace(/<subagent_context>[\s\S]*?<\/subagent_context>\s*/g, '')
          }
          if (!chunk) break
          _streamingTexts = new Map(_streamingTexts)
          const existing = _streamingTexts.get(streamDeptId) || ''
          _streamingTexts.set(streamDeptId, existing + chunk)
          _notifyStreamListeners()
        }
        break
      }

      case 'tool:update': {
        const toolDeptId = d.deptId as string | undefined
        if (mountedRef.current && toolDeptId) {
          setState(prev => {
            const toolStates = new Map(prev.toolStates)
            if (d.done) {
              toolStates.delete(toolDeptId)
            } else {
              toolStates.set(toolDeptId, {
                toolName: (d.toolName as string) || 'unknown',
                status: (d.toolStatus as string) || 'running',
                done: false,
              })
            }
            return { ...prev, toolStates }
          })
        }
        break
      }

      case 'dept:visit': {
        const from = d.from as string | undefined
        const to = d.to as string | undefined
        if (from && to) {
          _deptVisits = [..._deptVisits, {
            from,
            to,
            id: Date.now() + Math.random(),
            message: d.message as string | undefined
          }]
          _notifyVisitListeners()
        }
        break
      }

      case 'meeting:start':
        if (meetingEvents.length >= MAX_EVENT_QUEUE) meetingEvents = meetingEvents.slice(-50)
        meetingEvents.push({
          type: 'start',
          meetingId: (d.meetingId as string) || '',
          topic: (d.topic as string) || '',
          deptIds: (d.deptIds as string[]) || [],
          timestamp: Date.now()
        })
        emitMeetingChange()
        break

      case 'meeting:end':
        if (meetingEvents.length >= MAX_EVENT_QUEUE) meetingEvents = meetingEvents.slice(-50)
        meetingEvents.push({
          type: 'end',
          meetingId: (d.meetingId as string) || '',
          deptIds: (d.deptIds as string[]) || [],
          timestamp: Date.now()
        })
        emitMeetingChange()
        break

      case 'meeting:negotiation-start':
      case 'meeting:negotiation-vote':
      case 'meeting:negotiation-round':
      case 'meeting:negotiation-end':
        // Negotiation events - forward to meeting components via meeting events
        if (meetingEvents.length >= MAX_EVENT_QUEUE) meetingEvents = meetingEvents.slice(-50)
        meetingEvents.push({
          type: event as MeetingEvent['type'],
          meetingId: (d.meetingId as string) || '',
          timestamp: Date.now(),
          ...(d as Record<string, unknown>)
        } as MeetingEvent)
        emitMeetingChange()
        break

      case 'meeting:dept-response':
        if (meetingDeptResponses.length >= MAX_EVENT_QUEUE) meetingDeptResponses = meetingDeptResponses.slice(-50)
        meetingDeptResponses.push({
          meetingId: (d.meetingId as string) || '',
          deptId: (d.deptId as string) || '',
          text: (d.text as string) || '',
          roundId: (d.roundId as string) || '',
          deptIndex: (d.deptIndex as number) || 0,
          totalDepts: (d.totalDepts as number) || 0,
          timestamp: (d.timestamp as number) || Date.now()
        })
        emitMeetingDeptChange()
        break

      case 'meeting:round-complete':
        if (meetingRoundCompletes.length >= MAX_EVENT_QUEUE) meetingRoundCompletes = meetingRoundCompletes.slice(-50)
        meetingRoundCompletes.push({
          meetingId: (d.meetingId as string) || '',
          roundId: (d.roundId as string) || '',
          messageCount: (d.messageCount as number) || 0,
          timestamp: Date.now()
        })
        emitMeetingRoundChange()
        break

      case 'meeting:action-items':
        if (meetingEvents.length >= MAX_EVENT_QUEUE) meetingEvents = meetingEvents.slice(-50)
        meetingEvents.push({
          type: event as MeetingEvent['type'],
          meetingId: (d.meetingId as string) || '',
          timestamp: Date.now(),
          ...(d as Record<string, unknown>)
        } as MeetingEvent)
        emitMeetingChange()
        break

      case 'gateway:status': {
        const status = d.status as 'unknown' | 'connected' | 'disconnected' | 'fatal' | undefined
        if (mountedRef.current && status) {
          setState(prev => ({
            ...prev,
            gatewayStatus: status,
            gatewayDetail: (d.detail as string) || undefined,
          }))
        }
        break
      }

      case 'subagent:created':
        if (subAgentEvents.length >= MAX_EVENT_QUEUE) subAgentEvents = subAgentEvents.slice(-50)
        subAgentEvents.push({
          type: 'created',
          deptId: (d.deptId as string) || '',
          subId: (d.subId as string) || '',
          name: d.name as string | undefined,
          task: d.task as string | undefined,
          status: (d.status as string) || 'active',
          timestamp: Date.now()
        })
        emitSubAgentChange()
        break

      case 'subagent:removed':
        if (subAgentEvents.length >= MAX_EVENT_QUEUE) subAgentEvents = subAgentEvents.slice(-50)
        subAgentEvents.push({
          type: 'removed',
          deptId: (d.deptId as string) || '',
          subId: (d.subId as string) || '',
          timestamp: Date.now()
        })
        emitSubAgentChange()
        break

      case 'audit:new':
        if (auditEvents.length >= MAX_EVENT_QUEUE) auditEvents = auditEvents.slice(-50)
        auditEvents.push({
          id: (d.id as string) || '',
          timestamp: (d.timestamp as string) || new Date().toISOString(),
          action: (d.action as string) || '',
          target: (d.target as string) || '',
          deptId: (d.deptId as string | null) || null,
          details: d.details || null,
          ip: (d.ip as string | null) || null,
        })
        emitAuditChange()
        break

      case 'departments:updated':
        // Reload departments from REST API
        authedFetch('/api/departments')
          .then(res => res.json())
          .then(departmentsData => {
            if (Array.isArray(departmentsData?.departments) && mountedRef.current) {
              setState(prev => ({
                ...prev,
                departments: (departmentsData.departments as RawDepartment[]).map(parseDepartment),
              }))
            }
          })
          .catch((err) => {
            if (import.meta.env.DEV) console.warn('Reload departments failed:', err)
          })
        break

      default:
        break
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
      if (backgroundRetryTimerRef.current) {
        clearTimeout(backgroundRetryTimerRef.current)
      }
      if (wsRef.current) {
        wsRef.current.close()
      }
    }
  }, [])

  // Wrap setter functions in useCallback to maintain stable references
  const setSelectedDeptId = useCallback((deptId: string | null) => {
    setState(prev => ({ ...prev, selectedDeptId: deptId }))
  }, [])

  const addActivity = useCallback((activity: Activity) => {
    setState(prev => ({
      ...prev,
      activities: [...prev.activities, activity].slice(-200),
    }))
  }, [])

  const refreshRequests = useCallback(async () => {
    try {
      const response = await authedFetch('/api/requests')
      if (response.ok) {
        const data = await response.json()
        if (mountedRef.current && Array.isArray(data.requests)) {
          setState(prev => ({
            ...prev,
            requests: data.requests.map((r: { filename: string; content: string; modified?: string; created?: string }) => ({
              filename: r.filename || '',
              content: r.content || '',
              date: r.modified || r.created || new Date().toISOString(),
            }))
          }))
        }
      }
    } catch (err) {
      console.error('[API] Failed to fetch requests:', err)
    }
  }, [])

  return {
    ...state,
    setSelectedDeptId,
    addActivity,
    refreshRequests,
  }
}
