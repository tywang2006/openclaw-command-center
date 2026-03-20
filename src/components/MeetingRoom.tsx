import { useState, useEffect, useRef, useCallback } from 'react'
import type { Department } from '../hooks/useAgentState'
import { consumeMeetingDeptResponse, consumeMeetingRoundComplete, consumeMeetingEvent, useMeetingEvents } from '../hooks/useAgentState'
import { useLocale } from '../i18n/index'
import { DeptIcon } from './Icons'
import { authedFetch } from '../utils/api'
import './MeetingRoom.css'

const TemplateIcons: Record<string, React.ReactNode> = {
  standup: (
    <svg width="24" height="24" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M8 4v4h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  ),
  weekly: (
    <svg width="24" height="24" viewBox="0 0 16 16" fill="none">
      <rect x="1" y="8" width="3" height="6" stroke="currentColor" strokeWidth="1.3" fill="none" />
      <rect x="6" y="5" width="3" height="9" stroke="currentColor" strokeWidth="1.3" fill="none" />
      <rect x="11" y="2" width="3" height="12" stroke="currentColor" strokeWidth="1.3" fill="none" />
    </svg>
  ),
  'tech-review': (
    <svg width="24" height="24" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.3" fill="none" />
      <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.5 1.5M11.5 11.5L13 13M3 13l1.5-1.5M11.5 4.5L13 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  ),
  'product-sync': (
    <svg width="24" height="24" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.3" fill="none" />
      <path d="M5 8l2 2 4-4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
}

const MEETING_TEMPLATES = [
  { id: 'standup', nameKey: 'meeting.template.standup' as const, topicZh: '每日站会 - 今日工作同步', topicEn: 'Daily Standup - Today\'s Work Sync', depts: 'all' as const },
  { id: 'weekly', nameKey: 'meeting.template.weekly' as const, topicZh: '每周工作总结与下周计划', topicEn: 'Weekly Summary & Next Week Plan', depts: 'all' as const },
  { id: 'tech-review', nameKey: 'meeting.template.techReview' as const, topicZh: '技术方案评审', topicEn: 'Tech Architecture Review', depts: ['engineering', 'operations', 'blockchain'] },
  { id: 'product-sync', nameKey: 'meeting.template.productSync' as const, topicZh: '产品需求与进度同步', topicEn: 'Product Requirements & Progress Sync', depts: ['product', 'engineering', 'research'] },
]

// Pure helper functions - moved outside component to prevent recreations
const getStanceColor = (stance: string): string => {
  switch (stance) {
    case 'agree': return '#10b981'
    case 'disagree': return '#ef4444'
    case 'modify': return '#f59e0b'
    default: return 'var(--text-muted)'
  }
}

const getStanceLabel = (stance: string, t: (key: string) => string): string => {
  switch (stance) {
    case 'agree': return t('meeting.negotiate.agree')
    case 'disagree': return t('meeting.negotiate.disagree')
    case 'modify': return t('meeting.negotiate.modify')
    default: return t('meeting.negotiate.abstain')
  }
}

interface MeetingMessage {
  role: 'user' | 'dept' | 'system'
  deptId: string
  text: string
  timestamp: number
  negotiationId?: string
}

interface ActionItem {
  task: string
  owner: string
  priority: 'high' | 'medium' | 'low'
  deadline_hint?: string
}

interface Meeting {
  id: string
  topic: string
  deptIds: string[]
  messages: MeetingMessage[]
  status: string
  createdAt: number
  actionItems?: ActionItem[]
}

interface MeetingRoomProps {
  departments: Department[]
  onClose: () => void
}

export default function MeetingRoom({ departments, onClose }: MeetingRoomProps) {
  const { t, locale } = useLocale()
  const [meetings, setMeetings] = useState<{ id: string; topic: string; deptIds: string[]; messageCount: number }[]>([])
  const [activeMeeting, setActiveMeeting] = useState<Meeting | null>(null)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [newTopic, setNewTopic] = useState('')
  const [selectedDepts, setSelectedDepts] = useState<string[]>([])
  const [driveLink, setDriveLink] = useState<string | null>(null)
  const messagesRef = useRef<HTMLDivElement>(null)
  const currentRoundIdRef = useRef<string | null>(null)
  const sendingTimeoutRef = useRef<number | null>(null)
  const mountedRef = useRef(true)

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (sendingTimeoutRef.current) clearTimeout(sendingTimeoutRef.current)
      mountedRef.current = false
    }
  }, [])

  // Load meetings list — auto-enter first active meeting
  useEffect(() => {
    let cancelled = false
    authedFetch('/api/meetings')
      .then(r => r.json())
      .then(d => {
        if (cancelled) return
        const list = d.meetings || []
        setMeetings(list)
        if (list.length > 0) {
          loadMeeting(list[0].id)
        }
      })
      .catch((err) => {
        if (import.meta.env.DEV) console.warn('Fetch meetings failed:', err);
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Load meeting details
  const loadMeeting = async (id: string) => {
    try {
      const res = await authedFetch(`/api/meetings/${id}`)
      const data = await res.json()
      if (mountedRef.current && data.success) setActiveMeeting(data.meeting)
    } catch {}
  }

  // Create meeting
  const createMeeting = async () => {
    if (!newTopic.trim() || selectedDepts.length < 2) return
    try {
      const res = await authedFetch('/api/meetings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: newTopic.trim(), deptIds: selectedDepts }),
      })
      const data = await res.json()
      if (data.success) {
        setActiveMeeting(data.meeting)
        setShowCreate(false)
        const topicText = newTopic.trim()
        setNewTopic('')
        setSelectedDepts([])
        setMeetings(prev => [...prev, { id: data.meetingId, topic: topicText, deptIds: selectedDepts, messageCount: 0 }])
        // Auto-send topic as first message to kick off discussion
        await sendMeetingMessage(data.meetingId, topicText)
      }
    } catch (err) {
      console.error('[MeetingRoom] Create failed:', err)
    }
  }

  // Send a message to a meeting by ID (used for both manual sends and auto-topic)
  const sendMeetingMessage = async (meetingId: string, msg: string) => {
    setSending(true)

    // Optimistic: add user message
    setActiveMeeting(prev => prev ? {
      ...prev,
      messages: [...prev.messages, { role: 'user', deptId: 'user', text: msg, timestamp: Date.now() }]
    } : prev)

    try {
      const res = await authedFetch(`/api/meetings/${meetingId}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg }),
      })
      const data = await res.json()
      if (data.status === 'accepted') {
        // Store roundId to track this round
        currentRoundIdRef.current = data.roundId
        // Safety timeout: auto-clear sending after 120s if round-complete never arrives
        if (sendingTimeoutRef.current) clearTimeout(sendingTimeoutRef.current)
        sendingTimeoutRef.current = window.setTimeout(() => {
          setSending(false)
          currentRoundIdRef.current = null
        }, 120000)
        // Department responses will arrive via WebSocket
      } else {
        setSending(false)
      }
    } catch {
      setSending(false)
    }
    // Don't set sending=false here for accepted, wait for round-complete event
  }

  // Send message to meeting (triggers all depts to respond)
  const sendMessage = async () => {
    if (!text.trim() || !activeMeeting || sending) return
    const msg = text.trim()
    setText('')
    await sendMeetingMessage(activeMeeting.id, msg)
  }

  const [meetingEnded, setMeetingEnded] = useState(false)
  const [ending, setEnding] = useState(false)

  // Negotiation state
  const [negotiating, setNegotiating] = useState(false)
  const [showNegotiateForm, setShowNegotiateForm] = useState(false)
  const [negotiationProposal, setNegotiationProposal] = useState('')
  const [negotiationRounds, setNegotiationRounds] = useState(3)
  const [negotiationVotes, setNegotiationVotes] = useState<Array<{ deptId: string; stance: string; reason: string; suggestion: string; round: number }>>([])
  const [negotiationRound, setNegotiationRound] = useState(0)
  const [negotiationMaxRounds, setNegotiationMaxRounds] = useState(3)
  const [negotiationResult, setNegotiationResult] = useState<string | null>(null)
  const [negotiationAgreeCount, setNegotiationAgreeCount] = useState(0)
  const [negotiationTotal, setNegotiationTotal] = useState(0)

  // End meeting
  const endMeeting = async () => {
    if (!activeMeeting || ending) return
    setEnding(true)
    try {
      const res = await authedFetch(`/api/meetings/${activeMeeting.id}/end`, { method: 'POST' })
      const data = await res.json()
      if (data.driveResult?.webViewLink) {
        setDriveLink(data.driveResult.webViewLink)
      }
    } catch {}
    setMeetingEnded(true)
    // Clear negotiation state
    setNegotiating(false)
    setShowNegotiateForm(false)
    setNegotiationProposal('')
    setNegotiationRounds(3)
    setNegotiationVotes([])
    setNegotiationRound(0)
    setNegotiationMaxRounds(3)
    setNegotiationResult(null)
    setNegotiationAgreeCount(0)
    setNegotiationTotal(0)
    setEnding(false)
    setMeetings(prev => prev.filter(m => m.id !== activeMeeting.id))
  }

  // Start negotiation
  const startNegotiation = async () => {
    if (!activeMeeting || !negotiationProposal.trim()) return
    setNegotiating(true)
    setNegotiationVotes([])
    setNegotiationResult(null)
    try {
      const res = await authedFetch(`/api/meetings/${activeMeeting.id}/negotiate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proposal: negotiationProposal.trim(), maxRounds: negotiationRounds })
      })
      const data = await res.json()
      if (data.status === 'accepted') {
        setNegotiationProposal('')
        setShowNegotiateForm(false)
      }
    } catch {
      setNegotiating(false)
    }
  }

  // Process negotiation WebSocket events
  const meetingEvents = useMeetingEvents()
  useEffect(() => {
    let event = consumeMeetingEvent()
    while (event) {
      const e = event as any
      if (e.type === 'meeting:negotiation-vote' && e.meetingId === activeMeeting?.id) {
        setNegotiationVotes(prev => [...prev, { deptId: e.deptId, stance: e.stance, reason: e.reason, suggestion: e.suggestion, round: e.round }])
      } else if (e.type === 'meeting:negotiation-round' && e.meetingId === activeMeeting?.id) {
        setNegotiationRound(e.round)
        setNegotiationMaxRounds(e.maxRounds)
        setNegotiationAgreeCount(e.agreeCount)
        setNegotiationTotal(e.total)
      } else if (e.type === 'meeting:negotiation-end' && e.meetingId === activeMeeting?.id) {
        setNegotiating(false)
        setNegotiationResult(e.result)
        setNegotiationAgreeCount(e.agreeCount || 0)
        setNegotiationTotal(e.total || 0)
        if (activeMeeting) loadMeeting(activeMeeting.id)
      }
      event = consumeMeetingEvent()
    }
  }, [meetingEvents, activeMeeting?.id])

  // Poll for real-time department responses
  useEffect(() => {
    if (!activeMeeting) return

    const interval = setInterval(() => {
      let response = consumeMeetingDeptResponse()
      while (response) {
        const currentResponse = response
        if (currentResponse.meetingId === activeMeeting.id) {
          // Add department response to meeting
          setActiveMeeting(prev => {
            if (!prev || prev.id !== currentResponse.meetingId) return prev

            // Check if this message already exists (avoid duplicates)
            const exists = prev.messages.some(m =>
              m.deptId === currentResponse.deptId &&
              m.timestamp === currentResponse.timestamp
            )
            if (exists) return prev

            return {
              ...prev,
              messages: [...prev.messages, {
                role: 'dept',
                deptId: currentResponse.deptId,
                text: currentResponse.text,
                timestamp: currentResponse.timestamp
              }]
            }
          })
        }
        response = consumeMeetingDeptResponse()
      }
    }, 100)

    return () => clearInterval(interval)
  }, [activeMeeting?.id])

  // Poll for round complete events
  useEffect(() => {
    if (!activeMeeting) return

    const interval = setInterval(() => {
      let complete = consumeMeetingRoundComplete()
      while (complete) {
        if (complete.meetingId === activeMeeting.id &&
            (currentRoundIdRef.current === complete.roundId || currentRoundIdRef.current === null)) {
          setSending(false)
          currentRoundIdRef.current = null
          if (sendingTimeoutRef.current) {
            clearTimeout(sendingTimeoutRef.current)
            sendingTimeoutRef.current = null
          }
        }
        complete = consumeMeetingRoundComplete()
      }
    }, 100)

    return () => clearInterval(interval)
  }, [activeMeeting?.id])

  // Auto-scroll
  useEffect(() => {
    if (messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight
    }
  }, [activeMeeting?.messages.length])

  // Toggle dept selection
  const toggleDept = (id: string) => {
    setSelectedDepts(prev => prev.includes(id) ? prev.filter(d => d !== id) : [...prev, id])
  }

  // Apply template — directly creates the meeting
  const applyTemplate = async (tmpl: typeof MEETING_TEMPLATES[0]) => {
    const topic = locale === 'zh' ? tmpl.topicZh : tmpl.topicEn
    const deptIds = tmpl.depts === 'all'
      ? departments.map(d => d.id)
      : (tmpl.depts as string[]).filter(dId => departments.some(d => d.id === dId))

    if (deptIds.length < 2) return

    try {
      const res = await authedFetch('/api/meetings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, deptIds }),
      })
      const data = await res.json()
      if (data.success) {
        setActiveMeeting(data.meeting)
        setShowCreate(false)
        setMeetings(prev => [...prev, { id: data.meetingId, topic, deptIds, messageCount: 0 }])
        // Auto-send topic as first message to kick off discussion
        await sendMeetingMessage(data.meetingId, topic)
      }
    } catch (err) {
      console.error('[MeetingRoom] Template create failed:', err)
    }
  }

  // Dept color helper
  const getDeptColor = (deptId: string): string => {
    const dept = departments.find(d => d.id === deptId)
    return dept?.color || '#94a3b8'
  }

  const getDeptName = (deptId: string): string => {
    if (deptId === 'user') return t('meeting.user')
    if (deptId === 'negotiation') return t('meeting.negotiationSystem')
    if (deptId === 'action-items') return t('meeting.actionItems')
    return departments.find(d => d.id === deptId)?.name || deptId
  }

  return (
    <div className="meeting-room-inline">
      <div className="meeting-room">
        <div className="meeting-header">
          <h3>{t('meeting.title')}</h3>
          {activeMeeting && (
            <span className="meeting-topic">{activeMeeting.topic}</span>
          )}
          <div className="meeting-header-actions">
            {activeMeeting && !meetingEnded && (
              <button className="meeting-btn end" onClick={endMeeting} disabled={ending}>
                {ending ? '...' : t('meeting.endMeeting')}
              </button>
            )}
          </div>
        </div>

        {!activeMeeting && !showCreate && (
          <div className="meeting-list">
            <button className="meeting-btn create" onClick={() => setShowCreate(true)}>{t('meeting.create')}</button>
            {meetings.length === 0 && <p className="meeting-empty">{t('meeting.empty')}</p>}
            {meetings.map(m => (
              <div key={m.id} className="meeting-list-item" onClick={() => loadMeeting(m.id)}>
                <span className="meeting-list-topic">{m.topic}</span>
                <span className="meeting-list-depts">{m.deptIds.map(getDeptName).join(', ')}</span>
                <span className="meeting-list-count">{t('meeting.messages', { count: m.messageCount })}</span>
              </div>
            ))}
          </div>
        )}

        {showCreate && !activeMeeting && (
          <div className="meeting-create">
            {/* Template picker grid */}
            <div className="meeting-template-section">
              <p className="meeting-template-label">{t('meeting.templates')}:</p>
              <div className="meeting-template-grid">
                {MEETING_TEMPLATES.map(tmpl => (
                  <button
                    key={tmpl.id}
                    className="meeting-template-card"
                    onClick={() => applyTemplate(tmpl)}
                  >
                    <span className="meeting-template-icon">{TemplateIcons[tmpl.id]}</span>
                    <span className="meeting-template-name">{t(tmpl.nameKey)}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Divider */}
            <div className="meeting-divider">
              <span>{t('meeting.templates.or')}</span>
            </div>

            {/* Custom form */}
            <input
              className="meeting-input"
              value={newTopic}
              onChange={e => setNewTopic(e.target.value)}
              placeholder={t('meeting.topic.placeholder')}
            />
            <div className="meeting-dept-select">
              <p className="meeting-dept-label">{t('meeting.selectDepts')}</p>
              <div className="meeting-dept-chips">
                {departments.map(d => (
                  <button
                    key={d.id}
                    className={`meeting-dept-chip ${selectedDepts.includes(d.id) ? 'selected' : ''}`}
                    onClick={() => toggleDept(d.id)}
                    style={{ borderColor: selectedDepts.includes(d.id) ? d.color : undefined }}
                  >
                    <DeptIcon deptId={d.id} size={12} />
                    {d.name}
                  </button>
                ))}
              </div>
            </div>
            <div className="meeting-create-actions">
              <button className="meeting-btn" onClick={() => setShowCreate(false)}>{t('common.cancel')}</button>
              <button className="meeting-btn create" onClick={createMeeting} disabled={!newTopic.trim() || selectedDepts.length < 2}>
                {t('meeting.createMeeting')}
              </button>
            </div>
          </div>
        )}

        {meetingEnded && activeMeeting && (
          <div className="meeting-ended-summary">
            <h4>{t('meeting.endedTitle', { topic: activeMeeting.topic })}</h4>
            <p className="meeting-summary-meta">
              {t('meeting.summary.participants')}: {activeMeeting.deptIds.map(getDeptName).join(', ')} |
              {t('meeting.summary.messages', { count: activeMeeting.messages.length })} |
              {t('meeting.summary.duration', { minutes: Math.round((Date.now() - activeMeeting.createdAt) / 1000 / 60) })}
            </p>
            {driveLink && (
              <a href={driveLink} target="_blank" rel="noopener noreferrer" className="meeting-drive-link">
                {t('meeting.export.drive')}
              </a>
            )}

            {/* Action Items Section */}
            {activeMeeting.actionItems && activeMeeting.actionItems.length > 0 && (
              <div className="meeting-action-items">
                <h5>{t('meeting.actionItems')}</h5>
                {activeMeeting.actionItems.map((item, i) => (
                  <div key={i} className="meeting-action-item">
                    <span className={`action-priority ${item.priority}`}>
                      {item.priority === 'high' ? 'HIGH' : item.priority === 'medium' ? 'MED' : 'LOW'}
                    </span>
                    <span className="action-task">{item.task}</span>
                    <span className="action-owner" style={{ color: getDeptColor(item.owner) }}>
                      {getDeptName(item.owner)}
                    </span>
                    {item.deadline_hint && (
                      <span className="action-deadline">{item.deadline_hint}</span>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="meeting-minutes">
              <h5>{t('meeting.minutesTitle')}</h5>
              {activeMeeting.messages.map((msg, i) => (
                <div key={i} className="meeting-minute-item">
                  <span className="meeting-minute-sender" style={{ color: getDeptColor(msg.deptId) }}>
                    [{getDeptName(msg.deptId)}]
                  </span>
                  <span className="meeting-minute-text">{msg.text}</span>
                </div>
              ))}
              {activeMeeting.messages.length === 0 && <p className="meeting-empty">{t('meeting.noMessages')}</p>}
            </div>
            <button className="meeting-btn" onClick={() => { setDriveLink(null); setActiveMeeting(null); setMeetingEnded(false) }}>
              {t('common.close')}
            </button>
          </div>
        )}

        {activeMeeting && !meetingEnded && (
          <>
            {/* Participant badges */}
            <div className="meeting-participants">
              {activeMeeting.deptIds.map(id => (
                <span key={id} className="meeting-participant" style={{ borderColor: getDeptColor(id) }}>
                  <DeptIcon deptId={id} size={12} />
                  {getDeptName(id)}
                </span>
              ))}
            </div>

            {/* Messages */}
            <div className="meeting-messages" ref={messagesRef}>
              {activeMeeting.messages.map((msg, i) => {
                // Negotiation system messages
                if (msg.negotiationId && msg.role === 'system') {
                  return (
                    <div key={`${msg.deptId}-${msg.timestamp}-${i}`} className="negotiation-system-msg">
                      <div className="meeting-msg-text" style={{ background: 'var(--bg-panel)', borderLeft: '3px solid var(--accent-color)' }}>
                        {msg.text}
                      </div>
                    </div>
                  )
                }
                // Negotiation department votes
                if (msg.negotiationId && msg.role === 'dept') {
                  const roundMatch = msg.text.match(/\[Round (\d+)\] (\w+): (.*)/)
                  if (roundMatch) {
                    const stance = roundMatch[2].toLowerCase()
                    const reason = roundMatch[3]
                    const lines = msg.text.split('\n')
                    const suggestion = lines[1]?.startsWith('Suggestion:') ? lines[1].substring(12).trim() : ''
                    return (
                      <div key={`${msg.deptId}-${msg.timestamp}-${i}`} className="negotiation-vote" style={{ borderColor: getStanceColor(stance) }}>
                        <div className="negotiation-vote-header">
                          <DeptIcon deptId={msg.deptId} size={14} />
                          <span className="negotiation-vote-dept" style={{ color: getDeptColor(msg.deptId) }}>{getDeptName(msg.deptId)}</span>
                          <span className="negotiation-vote-stance" style={{ color: getStanceColor(stance) }}>{getStanceLabel(stance, t)}</span>
                        </div>
                        <div className="negotiation-vote-reason">{reason}</div>
                        {suggestion && <div className="negotiation-vote-suggestion">{t('meeting.negotiate.suggestion')}{suggestion}</div>}
                      </div>
                    )
                  }
                }
                // Regular messages
                return (
                  <div key={`${msg.deptId}-${msg.timestamp}-${i}`} className={`meeting-msg ${msg.deptId === 'user' ? 'user' : 'dept'}`}>
                    <div className="meeting-msg-meta">
                      {msg.deptId !== 'user' && <DeptIcon deptId={msg.deptId} size={12} />}
                      <span className="meeting-msg-sender" style={{ color: getDeptColor(msg.deptId) }}>
                        {getDeptName(msg.deptId)}
                      </span>
                      <span className="meeting-msg-time">
                        {new Date(msg.timestamp).toLocaleTimeString(locale === 'zh' ? 'zh-CN' : 'en-US', { hour: '2-digit', minute: '2-digit', hour12: false })}
                      </span>
                    </div>
                    <div className="meeting-msg-text">{msg.text}</div>
                  </div>
                )
              })}

              {/* Negotiation progress indicator */}
              {negotiating && negotiationRound > 0 && (
                <div className="negotiation-progress">
                  <div className="negotiation-progress-header">{t('meeting.roundProgress', { current: negotiationRound, max: negotiationMaxRounds })}</div>
                  <div className="negotiation-progress-bar">
                    <div className="negotiation-progress-fill" style={{
                      width: `${negotiationTotal > 0 ? (negotiationAgreeCount / negotiationTotal) * 100 : 0}%`,
                      background: negotiationAgreeCount === negotiationTotal ? '#10b981' : 'var(--accent-color)'
                    }} />
                  </div>
                  <div className="negotiation-progress-text">{t('meeting.negotiate.approved', { count: negotiationAgreeCount, total: negotiationTotal })}</div>
                </div>
              )}

              {/* Negotiation result banner */}
              {negotiationResult && (
                <div className={`negotiation-result negotiation-result-${negotiationResult}`}>
                  <strong>{negotiationResult === 'consensus' ? t('meeting.negotiate.consensus') : negotiationResult === 'majority' ? t('meeting.negotiate.majority') : t('meeting.negotiate.noconsensus')}</strong>
                  <span> - {t('meeting.negotiate.approved', { count: negotiationAgreeCount, total: negotiationTotal })}</span>
                </div>
              )}

              {sending && (
                <div className="meeting-msg dept">
                  <div className="meeting-msg-meta">
                    <span className="meeting-msg-sender">{t('meeting.deptThinking')}</span>
                  </div>
                  <div className="meeting-typing"><span></span><span></span><span></span></div>
                </div>
              )}
            </div>

            {/* Negotiate form */}
            {showNegotiateForm && !negotiating && (
              <div className="meeting-negotiate-form">
                <textarea
                  className="meeting-input"
                  value={negotiationProposal}
                  onChange={e => setNegotiationProposal(e.target.value)}
                  placeholder={t('meeting.negotiate.placeholder')}
                  rows={3}
                />
                <div className="meeting-negotiate-form-row">
                  <label>
                    {t('meeting.negotiate.rounds')}:
                    <input type="number" min="1" max="5" value={negotiationRounds}
                      onChange={e => setNegotiationRounds(parseInt(e.target.value) || 3)}
                      style={{ width: '60px', marginLeft: '8px' }} />
                  </label>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button className="meeting-btn" onClick={() => { setShowNegotiateForm(false); setNegotiationProposal('') }}>{t('common.cancel')}</button>
                    <button className="meeting-btn create" onClick={startNegotiation} disabled={!negotiationProposal.trim()}>{t('meeting.negotiate.start')}</button>
                  </div>
                </div>
              </div>
            )}

            {/* Input */}
            <div className="meeting-input-row">
              <input
                className="meeting-input"
                value={text}
                onChange={e => setText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
                placeholder={t('meeting.inputPlaceholder')}
                disabled={sending || negotiating}
              />
              {!showNegotiateForm && !negotiating && (
                <button className="meeting-btn" onClick={() => setShowNegotiateForm(true)} title={t('meeting.negotiate')}>{t('meeting.negotiate')}</button>
              )}
              <button className="meeting-btn send" onClick={sendMessage} disabled={sending || !text.trim() || negotiating}>
                {sending ? '...' : t('common.send')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
