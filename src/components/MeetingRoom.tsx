import { useState, useEffect, useRef, useCallback } from 'react'
import type { Department } from '../hooks/useAgentState'
import { consumeMeetingDeptResponse, consumeMeetingRoundComplete, consumeMeetingEvent, useMeetingEvents } from '../hooks/useAgentState'
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
  { id: 'standup', name: '每日站会', topic: '每日站会 - 今日工作同步', depts: 'all' as const },
  { id: 'weekly', name: '每周总结', topic: '每周工作总结与下周计划', depts: 'all' as const },
  { id: 'tech-review', name: '技术评审', topic: '技术方案评审', depts: ['engineering', 'operations', 'blockchain'] },
  { id: 'product-sync', name: '产品同步', topic: '产品需求与进度同步', depts: ['product', 'engineering', 'research'] },
]

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


  // Load meetings list — auto-enter first active meeting
  useEffect(() => {
    authedFetch('/api/meetings')
      .then(r => r.json())
      .then(d => {
        const list = d.meetings || []
        setMeetings(list)
        if (list.length > 0) {
          loadMeeting(list[0].id)
        }
      })
      .catch(() => {})
  }, [])

  // Load meeting details
  const loadMeeting = async (id: string) => {
    try {
      const res = await authedFetch(`/api/meetings/${id}`)
      const data = await res.json()
      if (data.success) setActiveMeeting(data.meeting)
    } catch {}
  }

  // Create meeting
  const createMeeting = async () => {
    console.log('[MeetingRoom] createMeeting called, topic:', newTopic, 'depts:', selectedDepts)
    if (!newTopic.trim() || selectedDepts.length < 2) return
    try {
      const res = await authedFetch('/api/meetings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: newTopic.trim(), deptIds: selectedDepts }),
      })
      const data = await res.json()
      console.log('[MeetingRoom] Create response:', data)
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
        // Department responses will arrive via WebSocket
      }
    } catch {}
    // Don't set sending=false here, wait for round-complete event
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

  // Stance color helper
  const getStanceColor = (stance: string): string => {
    switch (stance) {
      case 'agree': return '#10b981'
      case 'disagree': return '#ef4444'
      case 'modify': return '#f59e0b'
      default: return 'var(--text-muted)'
    }
  }

  const getStanceLabel = (stance: string): string => {
    switch (stance) {
      case 'agree': return '同意'
      case 'disagree': return '反对'
      case 'modify': return '修改'
      default: return '弃权'
    }
  }

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
        if (complete.meetingId === activeMeeting.id && currentRoundIdRef.current === complete.roundId) {
          setSending(false)
          currentRoundIdRef.current = null
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
    const topic = tmpl.topic
    const deptIds = tmpl.depts === 'all'
      ? departments.map(d => d.id)
      : (tmpl.depts as string[]).filter(dId => departments.some(d => d.id === dId))

    if (deptIds.length < 2) return

    console.log('[MeetingRoom] Template quick-create:', topic, deptIds)
    try {
      const res = await authedFetch('/api/meetings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, deptIds }),
      })
      const data = await res.json()
      console.log('[MeetingRoom] Template create response:', data)
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
    if (deptId === 'user') return '你'
    if (deptId === 'negotiation') return '谈判系统'
    if (deptId === 'action-items') return '行动事项'
    return departments.find(d => d.id === deptId)?.name || deptId
  }

  return (
    <div className="meeting-room-inline">
      <div className="meeting-room">
        <div className="meeting-header">
          <h3>会议室</h3>
          {activeMeeting && (
            <span className="meeting-topic">{activeMeeting.topic}</span>
          )}
          <div className="meeting-header-actions">
            {activeMeeting && !meetingEnded && (
              <button className="meeting-btn end" onClick={endMeeting} disabled={ending}>
                {ending ? '...' : '结束会议'}
              </button>
            )}
          </div>
        </div>

        {!activeMeeting && !showCreate && (
          <div className="meeting-list">
            <button className="meeting-btn create" onClick={() => setShowCreate(true)}>+ 发起会议</button>
            {meetings.length === 0 && <p className="meeting-empty">暂无进行中的会议</p>}
            {meetings.map(m => (
              <div key={m.id} className="meeting-list-item" onClick={() => loadMeeting(m.id)}>
                <span className="meeting-list-topic">{m.topic}</span>
                <span className="meeting-list-depts">{m.deptIds.map(getDeptName).join(', ')}</span>
                <span className="meeting-list-count">{m.messageCount} 条消息</span>
              </div>
            ))}
          </div>
        )}

        {showCreate && !activeMeeting && (
          <div className="meeting-create">
            {/* Template picker grid */}
            <div className="meeting-template-section">
              <p className="meeting-template-label">快速创建:</p>
              <div className="meeting-template-grid">
                {MEETING_TEMPLATES.map(tmpl => (
                  <button
                    key={tmpl.id}
                    className="meeting-template-card"
                    onClick={() => applyTemplate(tmpl)}
                  >
                    <span className="meeting-template-icon">{TemplateIcons[tmpl.id]}</span>
                    <span className="meeting-template-name">{tmpl.name}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Divider */}
            <div className="meeting-divider">
              <span>或自定义</span>
            </div>

            {/* Custom form */}
            <input
              className="meeting-input"
              value={newTopic}
              onChange={e => setNewTopic(e.target.value)}
              placeholder="会议主题"
            />
            <div className="meeting-dept-select">
              <p className="meeting-dept-label">选择参会部门 (至少2个):</p>
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
              <button className="meeting-btn" onClick={() => setShowCreate(false)}>取消</button>
              <button className="meeting-btn create" onClick={createMeeting} disabled={!newTopic.trim() || selectedDepts.length < 2}>
                创建会议
              </button>
            </div>
          </div>
        )}

        {meetingEnded && activeMeeting && (
          <div className="meeting-ended-summary">
            <h4>会议已结束: {activeMeeting.topic}</h4>
            <p className="meeting-summary-meta">
              参会: {activeMeeting.deptIds.map(getDeptName).join(', ')} |
              消息: {activeMeeting.messages.length} 条 |
              时长: {Math.round((Date.now() - activeMeeting.createdAt) / 1000 / 60)} 分钟
            </p>
            {driveLink && (
              <a href={driveLink} target="_blank" rel="noopener noreferrer" className="meeting-drive-link">
                查看 Google Drive 纪要
              </a>
            )}

            {/* Action Items Section */}
            {activeMeeting.actionItems && activeMeeting.actionItems.length > 0 && (
              <div className="meeting-action-items">
                <h5>行动事项</h5>
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
              <h5>会议记录</h5>
              {activeMeeting.messages.map((msg, i) => (
                <div key={i} className="meeting-minute-item">
                  <span className="meeting-minute-sender" style={{ color: getDeptColor(msg.deptId) }}>
                    [{getDeptName(msg.deptId)}]
                  </span>
                  <span className="meeting-minute-text">{msg.text}</span>
                </div>
              ))}
              {activeMeeting.messages.length === 0 && <p className="meeting-empty">无会议消息记录</p>}
            </div>
            <button className="meeting-btn" onClick={() => { setDriveLink(null); setActiveMeeting(null); setMeetingEnded(false) }}>
              关闭
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
                          <span className="negotiation-vote-stance" style={{ color: getStanceColor(stance) }}>{getStanceLabel(stance)}</span>
                        </div>
                        <div className="negotiation-vote-reason">{reason}</div>
                        {suggestion && <div className="negotiation-vote-suggestion">建议: {suggestion}</div>}
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
                        {new Date(msg.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}
                      </span>
                    </div>
                    <div className="meeting-msg-text">{msg.text}</div>
                  </div>
                )
              })}

              {/* Negotiation progress indicator */}
              {negotiating && negotiationRound > 0 && (
                <div className="negotiation-progress">
                  <div className="negotiation-progress-header">轮次 {negotiationRound}/{negotiationMaxRounds}</div>
                  <div className="negotiation-progress-bar">
                    <div className="negotiation-progress-fill" style={{
                      width: `${negotiationTotal > 0 ? (negotiationAgreeCount / negotiationTotal) * 100 : 0}%`,
                      background: negotiationAgreeCount === negotiationTotal ? '#10b981' : 'var(--accent-color)'
                    }} />
                  </div>
                  <div className="negotiation-progress-text">{negotiationAgreeCount}/{negotiationTotal} 同意</div>
                </div>
              )}

              {/* Negotiation result banner */}
              {negotiationResult && (
                <div className={`negotiation-result negotiation-result-${negotiationResult}`}>
                  <strong>{negotiationResult === 'consensus' ? '达成共识' : negotiationResult === 'majority' ? '多数同意' : '未达共识'}</strong>
                  <span> - {negotiationAgreeCount}/{negotiationTotal} 同意</span>
                </div>
              )}

              {sending && (
                <div className="meeting-msg dept">
                  <div className="meeting-msg-meta">
                    <span className="meeting-msg-sender">各部门思考中...</span>
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
                  placeholder="输入需要各部门讨论的提案..."
                  rows={3}
                />
                <div className="meeting-negotiate-form-row">
                  <label>
                    轮次:
                    <input type="number" min="1" max="5" value={negotiationRounds}
                      onChange={e => setNegotiationRounds(parseInt(e.target.value) || 3)}
                      style={{ width: '60px', marginLeft: '8px' }} />
                  </label>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button className="meeting-btn" onClick={() => { setShowNegotiateForm(false); setNegotiationProposal('') }}>取消</button>
                    <button className="meeting-btn create" onClick={startNegotiation} disabled={!negotiationProposal.trim()}>开始谈判</button>
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
                placeholder="输入会议议题或指令..."
                disabled={sending || negotiating}
              />
              {!showNegotiateForm && !negotiating && (
                <button className="meeting-btn" onClick={() => setShowNegotiateForm(true)} title="发起谈判">谈判</button>
              )}
              <button className="meeting-btn send" onClick={sendMessage} disabled={sending || !text.trim() || negotiating}>
                {sending ? '...' : '发送'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
