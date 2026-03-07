import { useState, useRef, useEffect, useCallback } from 'react'
import type { Department, Activity } from '../hooks/useAgentState'
import { DeptIcon, SendIcon } from './Icons'
import { useToast } from './Toast'
import { useLocale } from '../i18n/index'
import { authedFetch } from '../utils/api'
import './ChatPanel.css'

export interface SubAgent {
  id: string
  name: string
  task: string
  status: string
}

interface ChatPanelProps {
  selectedDeptId: string | null
  departments: Department[]
  activities: Activity[]
  addActivity: (a: Activity) => void
  onSubAgentsChange?: (deptId: string, subs: SubAgent[]) => void
  streamingTexts?: Map<string, string>
}

export default function ChatPanel({ selectedDeptId, departments, activities, addActivity, onSubAgentsChange, streamingTexts }: ChatPanelProps) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [subAgents, setSubAgents] = useState<SubAgent[]>([])
  const [activeChat, setActiveChat] = useState<string>('main') // 'main' or subAgent id
  const [showNewSub, setShowNewSub] = useState(false)
  const [newSubName, setNewSubName] = useState('')
  const [newSubTask, setNewSubTask] = useState('')
  const { showToast } = useToast()
  const messagesRef = useRef<HTMLDivElement>(null)
  const { t, locale } = useLocale()

  // Persona preview states
  const [showPersona, setShowPersona] = useState(false)
  const [personaContent, setPersonaContent] = useState<string | null>(null)
  const [personaLoading, setPersonaLoading] = useState(false)

  // Daily log states
  const [showDailyLog, setShowDailyLog] = useState(false)
  const [dailyDates, setDailyDates] = useState<string[]>([])
  const [selectedDate, setSelectedDate] = useState('')
  const [dailyContent, setDailyContent] = useState<string | null>(null)
  const [dailyLoading, setDailyLoading] = useState(false)

  // Inline timer creation
  const [showTimerForm, setShowTimerForm] = useState(false)
  const [timerForm, setTimerForm] = useState({
    name: '',
    scheduleKind: 'every' as 'every' | 'cron',
    intervalMinutes: 10,
    cronExpr: '*/15 * * * *',
    message: '',
  })
  const [creatingTimer, setCreatingTimer] = useState(false)

  // Chat history from OpenClaw Gateway (loaded per department)
  const [historyByDept, setHistoryByDept] = useState<Record<string, Activity[]>>({})

  // Image attachments
  const [pendingImages, setPendingImages] = useState<{ data: string; name: string }[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  const addImageFromFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return
    if (file.size > 4 * 1024 * 1024) {
      showToast(t('chat.image.size.limit'))
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      setPendingImages(prev => [...prev, { data: reader.result as string, name: file.name }])
    }
    reader.readAsDataURL(file)
  }, [showToast, t])

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault()
        const file = item.getAsFile()
        if (file) addImageFromFile(file)
        return
      }
    }
  }, [addImageFromFile])

  const dept = departments.find(d => d.id === selectedDeptId)

  // Fetch department persona
  const fetchPersona = async () => {
    if (!selectedDeptId) return
    setPersonaLoading(true)
    try {
      const res = await authedFetch(`/cmd/api/departments/${selectedDeptId}/persona`)
      const data = await res.json()
      setPersonaContent(data.content || '')
    } catch { setPersonaContent('') }
    setPersonaLoading(false)
  }

  // Load chat history from OpenClaw Gateway when department changes
  useEffect(() => {
    if (!selectedDeptId || selectedDeptId in historyByDept) return
    // Mark immediately to prevent duplicate fetches
    setHistoryByDept(prev => ({ ...prev, [selectedDeptId]: [] }))
    authedFetch(`/cmd/api/departments/${selectedDeptId}/history?limit=50`)
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data.messages)) {
          const msgs: Activity[] = data.messages.map((msg: { role: string; text: string; timestamp: string | null }) => ({
            deptId: selectedDeptId,
            role: (msg.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
            text: msg.text,
            timestamp: msg.timestamp ? new Date(msg.timestamp).getTime() : 0,
            source: 'history',
          }))
          setHistoryByDept(prev => ({ ...prev, [selectedDeptId!]: msgs }))
        }
      })
      .catch(() => {})
  }, [selectedDeptId])

  // Filter real-time activities for selected department
  const realtimeActivities = selectedDeptId
    ? activities.filter(a => a.deptId === selectedDeptId)
    : activities

  // Merge history + real-time, dedup by text+role (avoid filtering "好的" etc.)
  const historyMsgs = selectedDeptId ? (historyByDept[selectedDeptId] || []) : []
  const realtimeKeys = new Set(realtimeActivities.map(a => `${a.role}:${a.text.substring(0, 100)}`))
  const uniqueHistory = historyMsgs.filter(m => !realtimeKeys.has(`${m.role}:${m.text.substring(0, 100)}`))
  const deptActivities = [...uniqueHistory, ...realtimeActivities]

  // Smart auto-scroll: only scroll if user is near bottom
  useEffect(() => {
    if (messagesRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = messagesRef.current
      const isNearBottom = scrollHeight - scrollTop - clientHeight < 100
      if (isNearBottom) {
        messagesRef.current.scrollTop = scrollHeight
      }
    }
  }, [deptActivities.length])

  // Load sub-agents when department changes
  useEffect(() => {
    if (!selectedDeptId) {
      setSubAgents([])
      setActiveChat('main')
      return
    }
    // Reset persona and daily log states
    setShowPersona(false)
    setPersonaContent(null)
    setShowDailyLog(false)
    setDailyDates([])
    setDailyContent(null)
    setSelectedDate('')

    authedFetch(`/cmd/api/departments/${selectedDeptId}/subagents`)
      .then(res => res.json())
      .then(data => {
        const agents = data.agents || []
        setSubAgents(agents)
        onSubAgentsChange?.(selectedDeptId, agents)
      })
      .catch(() => {
        setSubAgents([])
        onSubAgentsChange?.(selectedDeptId, [])
      })
  }, [selectedDeptId])

  const sendMessage = async () => {
    if ((!text.trim() && pendingImages.length === 0) || sending || !selectedDeptId) return
    const msg = text.trim()
    const images = [...pendingImages]
    setText('')
    setPendingImages([])
    setSending(true)

    // Add user message immediately (with image indicators)
    const subName = subAgents.find(s => s.id === activeChat)?.name || ''
    const displayText = (activeChat === 'main' ? msg : `[${subName}] ${msg}`)
      + (images.length ? t('chat.message.images', { count: images.length }) : '')
    addActivity({
      deptId: selectedDeptId,
      role: 'user',
      text: displayText,
      timestamp: Date.now(),
      images: images.map(img => img.data),
    })

    try {
      const url = activeChat === 'main'
        ? `/cmd/api/departments/${selectedDeptId}/chat`
        : `/cmd/api/departments/${selectedDeptId}/subagents/${activeChat}/chat`

      const body: Record<string, unknown> = { message: msg }
      if (images.length > 0) {
        body.images = images.map(img => img.data)
      }

      const res = await authedFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      const data = await res.json()
      if (data.success && data.reply) {
        const prefix = activeChat === 'main' ? '' : `[${subAgents.find(s => s.id === activeChat)?.name || ''}] `
        addActivity({
          deptId: selectedDeptId,
          role: 'assistant',
          text: prefix + data.reply,
          timestamp: Date.now(),
        })
      } else {
        addActivity({
          deptId: selectedDeptId,
          role: 'assistant',
          text: t('chat.message.error', { error: data.error || t('chat.message.error.agent') }),
          timestamp: Date.now(),
        })
      }
    } catch {
      addActivity({
        deptId: selectedDeptId,
        role: 'assistant',
        text: t('chat.message.error.network'),
        timestamp: Date.now(),
      })
    }
    setSending(false)
  }

  const createSubAgent = async () => {
    if (!newSubTask.trim() || !selectedDeptId) return
    const agentName = newSubName.trim() || undefined
    try {
      const res = await authedFetch(`/cmd/api/departments/${selectedDeptId}/subagents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: newSubTask.trim(), name: agentName })
      })
      const data = await res.json()
      if (data.success) {
        const newSub = { id: data.subId, name: data.name, task: newSubTask.trim(), status: 'active' }
        setSubAgents(prev => {
          const next = [...prev, newSub]
          onSubAgentsChange?.(selectedDeptId!, next)
          return next
        })
        setActiveChat(data.subId)
        addActivity({
          deptId: selectedDeptId,
          role: 'assistant',
          text: t('chat.subagent.created', { name: data.name, task: newSubTask.trim() }),
          timestamp: Date.now(),
        })
      } else {
        console.error('[SubAgent] Failed to create sub-agent:', data.error)
        showToast(t('chat.subagent.create.failed') + ': ' + (data.error || ''))
      }
    } catch (err) {
      console.error('[SubAgent] Network error creating sub-agent:', err)
      showToast(t('chat.subagent.create.error'))
    }
    setNewSubName('')
    setNewSubTask('')
    setShowNewSub(false)
  }

  const removeSubAgentHandler = async (subId: string) => {
    if (!selectedDeptId) return
    try {
      const res = await authedFetch(`/cmd/api/departments/${selectedDeptId}/subagents/${subId}`, { method: 'DELETE' })
      if (!res.ok) {
        console.error('[SubAgent] Failed to delete sub-agent:', res.status)
        showToast(t('chat.subagent.delete.failed'))
        return
      }
      setSubAgents(prev => {
        const next = prev.filter(s => s.id !== subId)
        onSubAgentsChange?.(selectedDeptId!, next)
        return next
      })
      if (activeChat === subId) setActiveChat('main')
    } catch (err) {
      console.error('[SubAgent] Network error deleting sub-agent:', err)
      showToast(t('chat.subagent.delete.error'))
    }
  }

  const handleCreateTimer = async () => {
    if (!timerForm.name.trim() || !timerForm.message.trim() || !selectedDeptId) return
    setCreatingTimer(true)
    try {
      const payload: Record<string, unknown> = {
        name: timerForm.name.trim(),
        schedule: timerForm.scheduleKind === 'every'
          ? { kind: 'every', everyMs: timerForm.intervalMinutes * 60 * 1000 }
          : { kind: 'cron', expr: timerForm.cronExpr },
        message: timerForm.message.trim(),
        deptId: selectedDeptId,
      }
      if (activeChat !== 'main') {
        payload.subAgentId = activeChat
      }
      const res = await authedFetch('/cmd/api/cron/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (res.ok && data.success) {
        const agentLabel = activeChat === 'main'
          ? dept?.name || selectedDeptId
          : subAgents.find(s => s.id === activeChat)?.name || activeChat
        const scheduleLabel = timerForm.scheduleKind === 'every'
          ? t('chat.timer.schedule.every', { minutes: timerForm.intervalMinutes })
          : timerForm.cronExpr
        addActivity({
          deptId: selectedDeptId,
          role: 'assistant',
          text: t('chat.timer.created', {
            name: timerForm.name,
            agent: agentLabel,
            schedule: scheduleLabel,
            message: timerForm.message.substring(0, 80) + (timerForm.message.length > 80 ? '...' : '')
          }),
          timestamp: Date.now(),
        })
        setShowTimerForm(false)
        setTimerForm({ name: '', scheduleKind: 'every', intervalMinutes: 10, cronExpr: '*/15 * * * *', message: '' })
      } else {
        showToast(data.error || t('chat.timer.create.failed'))
      }
    } catch {
      showToast(t('chat.timer.create.error'))
    }
    setCreatingTimer(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const formatTime = (ts: number) => {
    return new Date(ts).toLocaleTimeString(locale === 'zh' ? 'zh-CN' : 'en-US', {
      hour: '2-digit', minute: '2-digit', hour12: false
    })
  }

  return (
    <div className="chat-panel">
      {/* Header */}
      <div className="chat-header">
        {dept ? (
          <>
            <DeptIcon deptId={dept.id} size={18} />
            <span className="chat-dept-name">{dept.name}</span>
            <span className={`chat-status ${dept.status}`}>{dept.status}</span>
            <button
              className="chat-btn persona-btn"
              onClick={() => { setShowPersona(!showPersona); if (!showPersona && personaContent === null) fetchPersona() }}
              title={t('chat.persona.show')}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="6.5" stroke={showPersona ? '#00d4aa' : '#a0a0b0'} strokeWidth="1.5" />
                <path d="M8 7v5M8 4.5v1" stroke={showPersona ? '#00d4aa' : '#a0a0b0'} strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </>
        ) : (
          <span className="chat-no-dept">
            {departments.length > 0
              ? t('chat.header.select')
              : t('chat.header.loading')}
          </span>
        )}
      </div>

      {/* Persona popover */}
      {showPersona && selectedDeptId && (
        <div className="persona-popover">
          <div className="persona-popover-header">
            <span>{t('chat.persona.show')}</span>
            <button onClick={() => setShowPersona(false)}>×</button>
          </div>
          <div className="persona-popover-content">
            {personaLoading ? <p>{t('chat.persona.loading')}</p>
             : personaContent ? <pre>{personaContent}</pre>
             : <p>{t('chat.persona.empty')}</p>}
          </div>
        </div>
      )}

      {/* Sub-agent selector */}
      {selectedDeptId && (
        <div className="chat-agent-bar">
          <button
            className={`agent-chip ${activeChat === 'main' ? 'active' : ''}`}
            onClick={() => setActiveChat('main')}
          >
            {t('chat.agent.main')}
          </button>
          {subAgents.map(sub => (
            <button
              key={sub.id}
              className={`agent-chip ${activeChat === sub.id ? 'active' : ''}`}
              onClick={() => setActiveChat(sub.id)}
              title={sub.task}
            >
              {sub.name}
              <span
                className="agent-chip-close"
                onClick={(e) => { e.stopPropagation(); removeSubAgentHandler(sub.id) }}
              >x</span>
            </button>
          ))}
          <button className="agent-chip add-sub" onClick={() => setShowNewSub(!showNewSub)}>+</button>
        </div>
      )}

      {/* New sub-agent form */}
      {showNewSub && selectedDeptId && (
        <div className="new-sub-form">
          <input
            className="sub-name-input"
            value={newSubName}
            onChange={e => setNewSubName(e.target.value)}
            placeholder={t('chat.subagent.name.placeholder')}
          />
          <input
            value={newSubTask}
            onChange={e => setNewSubTask(e.target.value)}
            placeholder={t('chat.subagent.task.placeholder')}
            onKeyDown={e => { if (e.key === 'Enter') createSubAgent() }}
          />
          <button onClick={createSubAgent} disabled={!newSubTask.trim()}>{t('chat.subagent.create')}</button>
        </div>
      )}

      {/* Sub-agent detail */}
      {activeChat !== 'main' && (() => {
        const sub = subAgents.find(s => s.id === activeChat)
        if (!sub) return null
        return (
          <div className="sub-detail-bar">
            <div className="sub-detail-header">
              <span className="sub-detail-name">{sub.name}</span>
              <span className={`sub-detail-status ${sub.status}`}>{sub.status}</span>
            </div>
            <div className="sub-detail-task">{t('chat.subagent.task.label')}: {sub.task}</div>
          </div>
        )
      })()}

      {/* Messages */}
      <div className="chat-messages" ref={messagesRef}>
        {deptActivities.length === 0 ? (
          <div className="chat-empty">
            {selectedDeptId
              ? t('chat.message.send', { name: dept?.name || selectedDeptId })
              : t('chat.message.click')}
          </div>
        ) : (
          deptActivities.map((msg, i) => (
            <div key={i} className={`chat-msg ${msg.role}`}>
              <div className="chat-msg-meta">
                {msg.role === 'user' ? (
                  <>
                    <span className="chat-msg-sender you">
                      {msg.fromName || 'YOU'}
                    </span>
                    {msg.source && msg.source !== 'app' && (
                      <span className={`chat-msg-source ${msg.source}`}>
                        {msg.source === 'telegram' ? 'TG' : msg.source === 'gateway' ? 'TG' : msg.source}
                      </span>
                    )}
                  </>
                ) : (
                  <>
                    <DeptIcon deptId={msg.deptId} size={12} />
                    <span className="chat-msg-sender bot">
                      {departments.find(d => d.id === msg.deptId)?.name || msg.deptId}
                    </span>
                    {msg.source && msg.source !== 'app' && (
                      <span className={`chat-msg-source ${msg.source}`}>
                        {msg.source === 'telegram' ? 'TG' : msg.source === 'gateway' ? 'TG' : msg.source}
                      </span>
                    )}
                  </>
                )}
                <span className="chat-msg-time">{formatTime(msg.timestamp)}</span>
              </div>
              <div className="chat-msg-text">{msg.text}</div>
              {msg.images && msg.images.length > 0 && (
                <div className="chat-msg-images">
                  {msg.images.map((src, j) => (
                    <img key={j} src={src} className="chat-msg-img" alt="" />
                  ))}
                </div>
              )}
            </div>
          ))
        )}
        {sending && activeChat === 'main' && (() => {
          const streamText = streamingTexts?.get(selectedDeptId || '')
          return (
            <div className="chat-msg assistant">
              <div className="chat-msg-meta">
                <DeptIcon deptId={selectedDeptId || ''} size={12} />
                <span className="chat-msg-sender bot">{t('chat.message.thinking')}</span>
              </div>
              {streamText ? (
                <div className="chat-stream-text">
                  {streamText}
                  <span className="chat-stream-cursor">▊</span>
                </div>
              ) : (
                <div className="chat-typing">
                  <span></span><span></span><span></span>
                </div>
              )}
            </div>
          )
        })()}
      </div>

      {/* Inline timer form */}
      {showTimerForm && selectedDeptId && (
        <div className="chat-timer-form">
          <div className="timer-form-header">
            <span className="timer-form-title">
              {t('chat.timer.title', {
                target: activeChat === 'main' ? (dept?.name || selectedDeptId) : (subAgents.find(s => s.id === activeChat)?.name || activeChat)
              })}
            </span>
            <button className="timer-form-close" onClick={() => setShowTimerForm(false)}>×</button>
          </div>
          <div className="timer-form-row">
            <input
              value={timerForm.name}
              onChange={e => setTimerForm({ ...timerForm, name: e.target.value })}
              placeholder={t('chat.timer.name')}
              className="timer-input"
            />
            <div className="timer-schedule-toggle">
              <button
                className={timerForm.scheduleKind === 'every' ? 'active' : ''}
                onClick={() => setTimerForm({ ...timerForm, scheduleKind: 'every' })}
              >{t('chat.timer.schedule.interval')}</button>
              <button
                className={timerForm.scheduleKind === 'cron' ? 'active' : ''}
                onClick={() => setTimerForm({ ...timerForm, scheduleKind: 'cron' })}
              >Cron</button>
            </div>
            {timerForm.scheduleKind === 'every' ? (
              <div className="timer-interval">
                <input
                  type="number"
                  value={timerForm.intervalMinutes}
                  onChange={e => setTimerForm({ ...timerForm, intervalMinutes: parseInt(e.target.value) || 1 })}
                  min="1"
                  className="timer-input-num"
                />
                <span className="timer-unit">{t('chat.timer.interval.unit')}</span>
              </div>
            ) : (
              <input
                value={timerForm.cronExpr}
                onChange={e => setTimerForm({ ...timerForm, cronExpr: e.target.value })}
                placeholder="*/15 * * * *"
                className="timer-input timer-cron"
              />
            )}
          </div>
          <div className="timer-form-row">
            <input
              value={timerForm.message}
              onChange={e => setTimerForm({ ...timerForm, message: e.target.value })}
              placeholder={t('chat.timer.message.placeholder')}
              className="timer-input timer-msg"
              onKeyDown={e => { if (e.key === 'Enter') handleCreateTimer() }}
            />
            <button
              className="timer-create-btn"
              onClick={handleCreateTimer}
              disabled={creatingTimer || !timerForm.name.trim() || !timerForm.message.trim()}
            >
              {creatingTimer ? t('chat.timer.creating') : t('chat.timer.create.button')}
            </button>
          </div>
        </div>
      )}

      {/* Daily log panel */}
      {showDailyLog && selectedDeptId && (
        <div className="chat-daily-panel">
          <div className="daily-panel-header">
            <span className="daily-panel-title">{t('chat.daily.show')}</span>
            <button className="daily-panel-close" onClick={() => setShowDailyLog(false)}>×</button>
          </div>
          <div className="daily-panel-row">
            <input
              type="date"
              value={selectedDate}
              onChange={e => {
                setSelectedDate(e.target.value)
                // Fetch the daily log
                setDailyLoading(true)
                authedFetch(`/cmd/api/departments/${selectedDeptId}/daily/${e.target.value}`)
                  .then(r => r.json())
                  .then(d => setDailyContent(d.content || ''))
                  .catch(() => setDailyContent(''))
                  .finally(() => setDailyLoading(false))
              }}
              className="daily-date-input"
            />
          </div>
          <div className="daily-panel-content">
            {dailyLoading ? <p>{t('chat.daily.loading')}</p>
             : dailyContent ? <pre>{dailyContent}</pre>
             : selectedDate ? <p>{t('chat.daily.empty')}</p>
             : <p>{t('chat.daily.no.dates')}</p>}
          </div>
        </div>
      )}

      {/* Image preview */}
      {pendingImages.length > 0 && (
        <div className="chat-image-preview">
          {pendingImages.map((img, i) => (
            <div key={i} className="preview-thumb">
              <img src={img.data} alt="" />
              <button className="preview-remove" onClick={() => setPendingImages(prev => prev.filter((_, j) => j !== i))}>x</button>
            </div>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="chat-input-row">
        <textarea
          className="chat-input"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={
            !selectedDeptId
              ? t('chat.message.select')
              : activeChat === 'main'
                ? t('chat.message.to', { name: dept?.name || '' })
                : t('chat.message.subagent.to', { name: subAgents.find(s => s.id === activeChat)?.name || '' })
          }
          rows={1}
          disabled={sending || !selectedDeptId}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: 'none' }}
          onChange={e => {
            if (e.target.files) {
              Array.from(e.target.files).forEach(addImageFromFile)
            }
            e.target.value = ''
          }}
        />
        <button
          className="chat-btn img-btn"
          onClick={() => fileInputRef.current?.click()}
          disabled={!selectedDeptId}
          title={t('chat.image.upload')}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <rect x="1.5" y="2.5" width="13" height="11" rx="2" stroke="#a0a0b0" strokeWidth="1.3" />
            <circle cx="5.5" cy="6.5" r="1.5" stroke="#a0a0b0" strokeWidth="1.2" />
            <path d="M1.5 11l3.5-4 3 3 2-1.5 4.5 3" stroke="#a0a0b0" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          className="chat-btn daily-btn"
          onClick={() => {
            setShowDailyLog(!showDailyLog)
            if (!showDailyLog && dailyDates.length === 0 && selectedDeptId) {
              authedFetch(`/cmd/api/departments/${selectedDeptId}/daily-dates`)
                .then(r => r.json())
                .then(d => {
                  setDailyDates(d.dates || [])
                  if (d.dates?.[0]) setSelectedDate(d.dates[0])
                })
                .catch(() => {})
            }
          }}
          disabled={!selectedDeptId}
          title={t('chat.daily.show')}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <rect x="1.5" y="2.5" width="13" height="12" stroke={showDailyLog ? '#00d4aa' : '#a0a0b0'} strokeWidth="1.3" />
            <path d="M1.5 6.5h13" stroke={showDailyLog ? '#00d4aa' : '#a0a0b0'} strokeWidth="1.3" />
            <path d="M5 1v3M11 1v3" stroke={showDailyLog ? '#00d4aa' : '#a0a0b0'} strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        </button>
        <button
          className="chat-btn timer-btn"
          onClick={() => setShowTimerForm(!showTimerForm)}
          disabled={!selectedDeptId}
          title={t('chat.timer.create')}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="6.5" stroke={showTimerForm ? '#00d4aa' : '#a0a0b0'} strokeWidth="1.5" />
            <path d="M8 4v4l3 2" stroke={showTimerForm ? '#00d4aa' : '#a0a0b0'} strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
        <button
          className="chat-btn send-btn"
          onClick={sendMessage}
          disabled={sending || !selectedDeptId || (!text.trim() && pendingImages.length === 0)}
          title="Send"
        >
          {sending ? '...' : <SendIcon size={16} color="#00d4aa" />}
        </button>
      </div>
    </div>
  )
}
