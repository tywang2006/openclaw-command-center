import { useState, useRef, useEffect, useCallback } from 'react'
import type { Department, Activity } from '../hooks/useAgentState'
import { useStreamingTexts } from '../hooks/useAgentState'
import { useToast } from './Toast'
import { useLocale } from '../i18n/index'
import { authedFetch } from '../utils/api'
import { detectMentions } from '../utils/mentions'
import ImageModal from './ImageModal'
import SkillPicker from './SkillPicker'
import WorkflowEditor from './WorkflowEditor'
import ChatMessages from './ChatMessages'
import ChatInput from './ChatInput'
import SubAgentPanel from './SubAgentPanel'
import ChatToolbar from './ChatToolbar'
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
  prefillMessage?: string | null
  onPrefillConsumed?: () => void
  onOpenDeptForm?: (prefill?: { name: string }) => void
}

export default function ChatPanel({
  selectedDeptId,
  departments,
  activities,
  addActivity,
  onSubAgentsChange,
  prefillMessage,
  onPrefillConsumed,
  onOpenDeptForm
}: ChatPanelProps) {
  const streamingTexts = useStreamingTexts()
  const [sending, setSending] = useState(false)
  const [activeChat, setActiveChat] = useState<string>('main')
  const [subAgents, setSubAgents] = useState<SubAgent[]>([])
  const { showToast } = useToast()
  const { t } = useLocale()
  const messagesRef = useRef<HTMLDivElement>(null)

  // Chat history from OpenClaw Gateway (loaded per department, max 10 cached depts)
  const MAX_CACHED_DEPTS = 10
  const MAX_HISTORY_PER_DEPT = 100
  const [historyByDept, setHistoryByDept] = useState<Record<string, Activity[]>>({})
  const loadedDeptsRef = useRef<Set<string>>(new Set())

  // Modals and overlays
  const [modalImage, setModalImage] = useState<string | null>(null)
  const [showSkillPicker, setShowSkillPicker] = useState(false)
  const [showWorkflow, setShowWorkflow] = useState(false)
  const [showToolbar, setShowToolbar] = useState(false)

  // Timer form states
  const [showTimerForm, setShowTimerForm] = useState(false)
  const [timerForm, setTimerForm] = useState({
    name: '',
    scheduleKind: 'every' as 'every' | 'cron',
    intervalMinutes: 10,
    cronExpr: '*/15 * * * *',
    message: '',
  })
  const [creatingTimer, setCreatingTimer] = useState(false)

  // Email form state (managed by ChatInput)
  const [showEmailForm, setShowEmailForm] = useState(false)

  // File input refs (managed by ChatInput, used by ChatToolbar)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const docInputRef = useRef<HTMLInputElement>(null)

  const dept = departments.find(d => d.id === selectedDeptId)

  // Load chat history from OpenClaw Gateway when department changes
  useEffect(() => {
    if (!selectedDeptId || loadedDeptsRef.current.has(selectedDeptId)) return
    loadedDeptsRef.current.add(selectedDeptId)
    setHistoryByDept(prev => ({ ...prev, [selectedDeptId]: [] }))
    authedFetch(`/api/departments/${selectedDeptId}/history?limit=50`)
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data.messages)) {
          const msgs: Activity[] = data.messages.slice(-MAX_HISTORY_PER_DEPT).map((msg: { role: string; text: string; timestamp: string | null }) => ({
            deptId: selectedDeptId,
            role: (msg.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
            text: msg.text,
            timestamp: msg.timestamp ? new Date(msg.timestamp).getTime() : 0,
            source: 'history',
          }))
          setHistoryByDept(prev => {
            const next = { ...prev, [selectedDeptId!]: msgs }
            // Evict oldest cached depts if over limit
            const keys = Object.keys(next)
            if (keys.length > MAX_CACHED_DEPTS) {
              const toEvict = keys.filter(k => k !== selectedDeptId).slice(0, keys.length - MAX_CACHED_DEPTS)
              for (const k of toEvict) {
                delete next[k]
                loadedDeptsRef.current.delete(k)
              }
            }
            return next
          })
        }
      })
      .catch(() => {
        loadedDeptsRef.current.delete(selectedDeptId!)
      })
  }, [selectedDeptId])

  // Clean message text by stripping context tags
  const cleanMessageText = (text: string): string => {
    if (!text) return text
    return text
      .replace(/<department_context>[\s\S]*?<\/department_context>\s*/g, '')
      .replace(/<subagent_context>[\s\S]*?<\/subagent_context>\s*/g, '')
      .trim()
  }

  // Filter real-time activities for selected department
  const realtimeActivities = selectedDeptId
    ? activities.filter(a => a.deptId === selectedDeptId)
    : activities

  // Merge history + real-time, dedup by text+role
  const historyMsgs = selectedDeptId ? (historyByDept[selectedDeptId] || []) : []
  const realtimeKeys = new Set(realtimeActivities.map(a => {
    const cleaned = cleanMessageText(a.text)
    return `${a.role}:${cleaned.substring(0, 80)}`
  }))
  const uniqueHistory = historyMsgs.filter(m => {
    const cleaned = cleanMessageText(m.text)
    return !realtimeKeys.has(`${m.role}:${cleaned.substring(0, 80)}`)
  })
  const allDeptActivities = [...uniqueHistory, ...realtimeActivities].filter(msg => cleanMessageText(msg.text))

  // Filter by active chat target: main shows non-sub-agent messages, sub-agent shows only its own
  const deptActivities = activeChat === 'main'
    ? allDeptActivities
    : (() => {
        const subName = subAgents.find(s => s.id === activeChat)?.name || ''
        if (!subName) return allDeptActivities
        const prefix = `[${subName}]`
        return allDeptActivities.filter(a => a.text.startsWith(prefix))
      })()

  // Chat command handler
  const handleChatCommand = useCallback((msg: string): boolean => {
    const trimmed = msg.trim()
    if (!trimmed.startsWith('/')) return false

    // /dept or /部门
    const deptMatch = trimmed.match(/^\/(dept|部门)\s*(.*)$/i)
    if (deptMatch) {
      const arg = deptMatch[2].trim()
      if (!arg) {
        onOpenDeptForm?.()
        addActivity({ deptId: selectedDeptId || 'system', role: 'assistant', text: t('dept.cmd.openForm'), timestamp: Date.now(), source: 'app' })
        return true
      }
      const name = arg
      const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 30) || 'dept'
      addActivity({ deptId: selectedDeptId || 'system', role: 'user', text: `/dept ${name}`, timestamp: Date.now(), source: 'app' })
      authedFetch('/api/departments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, name, icon: 'bolt', color: '#94a3b8', hue: 200 }),
      })
        .then(r => r.json())
        .then(data => {
          addActivity({
            deptId: selectedDeptId || 'system', role: 'assistant',
            text: data.success ? t('dept.cmd.created', { name, id }) : t('dept.cmd.failed', { error: data.error || 'Unknown error' }),
            timestamp: Date.now(), source: 'app',
          })
        })
        .catch(() => {
          addActivity({ deptId: selectedDeptId || 'system', role: 'assistant', text: t('dept.cmd.failed', { error: t('common.networkError') }), timestamp: Date.now(), source: 'app' })
        })
      return true
    }

    // /broadcast or /广播
    const broadcastMatch = trimmed.match(/^\/(broadcast|广播)\s+(.+)$/is)
    if (broadcastMatch) {
      const message = broadcastMatch[2].trim()
      if (!message) return false
      addActivity({ deptId: selectedDeptId || 'system', role: 'user', text: `/broadcast ${message}`, timestamp: Date.now(), source: 'app' })
      authedFetch('/api/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      })
        .then(r => r.json())
        .then(data => {
          if (data.success && data.results) {
            const summary = data.results.map((r: { deptId: string; reply?: string; error?: string }) =>
              `[${r.deptId}] ${r.reply?.substring(0, 100) || r.error || '...'}`
            ).join('\n')
            addActivity({ deptId: selectedDeptId || 'system', role: 'assistant', text: t('cmd.broadcast.done', { count: data.results.length }) + '\n' + summary, timestamp: Date.now(), source: 'app' })
          } else {
            addActivity({ deptId: selectedDeptId || 'system', role: 'assistant', text: t('cmd.broadcast.failed', { error: data.error || '' }), timestamp: Date.now(), source: 'app' })
          }
        })
        .catch(() => {
          addActivity({ deptId: selectedDeptId || 'system', role: 'assistant', text: t('cmd.broadcast.failed', { error: t('common.networkError') }), timestamp: Date.now(), source: 'app' })
        })
      return true
    }

    // /export or /导出
    if (/^\/(export|导出)$/i.test(trimmed)) {
      if (selectedDeptId) {
        addActivity({ deptId: selectedDeptId, role: 'assistant', text: t('cmd.export.started'), timestamp: Date.now(), source: 'app' })
      }
      return true
    }

    // /status or /状态
    if (/^\/(status|状态)$/i.test(trimmed)) {
      authedFetch('/health')
        .then(r => r.json())
        .then(data => {
          const lines = [
            `Gateway: ${data.gateway || 'unknown'}`,
            `Uptime: ${data.uptime ? Math.floor(data.uptime / 60) + 'min' : 'N/A'}`,
            `WS Clients: ${data.wsClients ?? 'N/A'}`,
            `Departments: ${departments.length}`,
          ]
          addActivity({ deptId: selectedDeptId || 'system', role: 'assistant', text: t('cmd.status.result') + '\n' + lines.join('\n'), timestamp: Date.now(), source: 'app' })
        })
        .catch(() => {
          addActivity({ deptId: selectedDeptId || 'system', role: 'assistant', text: t('cmd.status.failed'), timestamp: Date.now(), source: 'app' })
        })
      return true
    }

    // /clear or /清屏
    if (/^\/(clear|清屏)$/i.test(trimmed)) {
      if (selectedDeptId) {
        setHistoryByDept(prev => {
          const next = { ...prev }
          delete next[selectedDeptId]
          return next
        })
      }
      return true
    }

    // /子代理名 消息 — call sub-agent by name from main chat
    if (selectedDeptId && subAgents.length > 0) {
      const slashName = trimmed.match(/^\/(\S+)\s+(.+)$/s)
      if (slashName) {
        const sub = subAgents.find(s => s.name === slashName[1])
        if (sub) {
          const message = slashName[2].trim()
          const prefix = `[${sub.name}] `
          addActivity({ deptId: selectedDeptId, role: 'user', text: prefix + message, timestamp: Date.now(), source: 'app' })
          authedFetch(`/api/departments/${selectedDeptId}/subagents/${sub.id}/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message }),
          })
            .then(r => r.json())
            .then(data => {
              if (data.success && data.reply) {
                addActivity({ deptId: selectedDeptId!, role: 'assistant', text: prefix + data.reply, timestamp: Date.now(), source: 'app' })
              } else {
                addActivity({ deptId: selectedDeptId!, role: 'assistant', text: prefix + (data.error || 'No reply'), timestamp: Date.now(), source: 'app' })
              }
            })
            .catch(() => {
              addActivity({ deptId: selectedDeptId!, role: 'assistant', text: prefix + t('common.networkError'), timestamp: Date.now(), source: 'app' })
            })
          return true
        }
      }
    }

    // /help or /帮助
    if (/^\/(help|帮助)$/i.test(trimmed)) {
      const chatCommands = [
        { cmd: '/dept', alias: '/部门', desc: t('cmd.dept.desc') },
        { cmd: '/broadcast', alias: '/广播', desc: t('cmd.broadcast.desc') },
        { cmd: '/export', alias: '/导出', desc: t('cmd.export.desc') },
        { cmd: '/status', alias: '/状态', desc: t('cmd.status.desc') },
        { cmd: '/clear', alias: '/清屏', desc: t('cmd.clear.desc') },
        { cmd: '/help', alias: '/帮助', desc: t('cmd.help.desc') },
        { cmd: '/子代理名', alias: '', desc: '向子代理发消息' },
      ]
      const helpText = chatCommands.map(c => `${c.cmd}  ${c.alias}  — ${c.desc}`).join('\n')
      addActivity({ deptId: selectedDeptId || 'system', role: 'assistant', text: t('cmd.help.title') + '\n' + helpText, timestamp: Date.now(), source: 'app' })
      return true
    }

    return false
  }, [selectedDeptId, departments.length, addActivity, onOpenDeptForm, t, subAgents])

  // Message send handler
  const handleSendMessage = useCallback(async (
    text: string,
    images: { data: string; name: string }[],
    docs: { file: File; name: string; size: number }[]
  ) => {
    if ((!text && images.length === 0 && docs.length === 0) || sending || !selectedDeptId) return

    // Check for chat commands first
    if (text && handleChatCommand(text)) return

    setSending(true)

    // Upload documents first
    const uploadedDocs: { name: string; extracted?: Record<string, unknown> }[] = []
    if (docs.length > 0) {
      for (const doc of docs) {
        try {
          const formData = new FormData()
          formData.append('file', doc.file)
          const res = await authedFetch('/api/files/upload', {
            method: 'POST',
            body: formData
          })
          const data = await res.json()
          if (data.success) {
            uploadedDocs.push({ name: doc.name, extracted: data.extracted })
          }
        } catch (err) {
          console.error('Upload error:', err)
        }
      }
    }

    // Add user message immediately
    const subName = subAgents.find(s => s.id === activeChat)?.name || ''
    let displayText = activeChat === 'main' ? text : `[${subName}] ${text}`
    if (images.length) {
      displayText += t('chat.message.images', { count: images.length })
    }
    if (uploadedDocs.length) {
      displayText += t('chat.message.docs', { count: uploadedDocs.length, names: uploadedDocs.map(d => d.name).join(', ') })
    }

    addActivity({
      deptId: selectedDeptId,
      role: 'user',
      text: displayText,
      timestamp: Date.now(),
      images: images.map(img => img.data),
    })

    try {
      const url = activeChat === 'main'
        ? `/api/departments/${selectedDeptId}/chat`
        : `/api/departments/${selectedDeptId}/subagents/${activeChat}/chat`

      const body: Record<string, unknown> = { message: text }
      if (images.length > 0) {
        body.images = images.map(img => img.data)
      }
      if (uploadedDocs.length > 0) {
        body.documents = uploadedDocs
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
          attachments: data.attachments,
        })

        // Feature 2: Detect and forward @mentions to other departments
        if (activeChat === 'main' && text) {
          const mentions = detectMentions(text, departments, selectedDeptId)
          if (mentions.length > 0) {
            addActivity({
              deptId: selectedDeptId,
              role: 'assistant',
              text: `正在转发至 ${mentions.map(m => `@${m.deptName}`).join(', ')}...`,
              timestamp: Date.now(),
            })

            // Forward to each mentioned department
            for (const mention of mentions) {
              try {
                const mentionRes = await authedFetch(`/api/departments/${mention.deptId}/chat`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    message: text,
                    sourceDept: selectedDeptId
                  })
                })
                const mentionData = await mentionRes.json()
                if (mentionData.success && mentionData.reply) {
                  addActivity({
                    deptId: selectedDeptId,
                    role: 'assistant',
                    text: `[@${mention.deptName}] ${mentionData.reply}`,
                    timestamp: Date.now(),
                  })
                }
              } catch (err) {
                console.error('Mention forward error:', err)
              }
            }
          }
        }
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
  }, [sending, selectedDeptId, activeChat, subAgents, addActivity, handleChatCommand, t])

  // Timer creation handler
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
      const res = await authedFetch('/api/cron/jobs', {
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

  const handleSubAgentsChange = useCallback((deptId: string, subs: SubAgent[]) => {
    setSubAgents(subs)
    onSubAgentsChange?.(deptId, subs)
  }, [onSubAgentsChange])

  return (
    <div className="chat-panel" style={{ position: 'relative' }}>
      <ChatToolbar
        selectedDeptId={selectedDeptId}
        dept={dept}
        departments={departments}
        activeChat={activeChat}
        subAgents={subAgents}
        showToolbar={showToolbar}
        fileInputRef={fileInputRef}
        docInputRef={docInputRef}
        onShowToolbar={setShowToolbar}
        onShowEmailForm={setShowEmailForm}
        onShowSkillPicker={setShowSkillPicker}
        onShowWorkflow={setShowWorkflow}
        onShowTimerForm={setShowTimerForm}
      />

      <SubAgentPanel
        selectedDeptId={selectedDeptId}
        activeChat={activeChat}
        onActiveChatChange={setActiveChat}
        onSubAgentsChange={handleSubAgentsChange}
      />

      <ChatMessages
        deptActivities={deptActivities}
        departments={departments}
        selectedDeptId={selectedDeptId}
        sending={sending && activeChat === 'main'}
        streamingText={streamingTexts?.get(selectedDeptId || '')}
        onImageClick={setModalImage}
      />

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

      <ChatInput
        selectedDeptId={selectedDeptId}
        dept={dept}
        activeChat={activeChat}
        subAgents={subAgents}
        sending={sending}
        onSendMessage={handleSendMessage}
        onShowToolbar={setShowToolbar}
        showToolbar={showToolbar}
        prefillMessage={prefillMessage}
        onPrefillConsumed={onPrefillConsumed}
        messagesRef={messagesRef}
        fileInputRef={fileInputRef}
        docInputRef={docInputRef}
        showEmailForm={showEmailForm}
        onShowEmailForm={setShowEmailForm}
      />

      {/* Skill picker modal */}
      <SkillPicker
        open={showSkillPicker}
        onClose={() => setShowSkillPicker(false)}
        selectedDeptId={selectedDeptId}
        deptName={dept?.name || selectedDeptId || ''}
        onExecuted={(skillName, reply) => {
          addActivity({
            deptId: selectedDeptId || 'system',
            role: 'user',
            text: `[Skill] ${skillName}`,
            timestamp: Date.now(),
          })
          addActivity({
            deptId: selectedDeptId || 'system',
            role: 'assistant',
            text: reply,
            timestamp: Date.now(),
          })
        }}
      />

      {/* Workflow editor modal */}
      {showWorkflow && <WorkflowEditor onClose={() => setShowWorkflow(false)} />}

      {/* Fullscreen image modal */}
      {modalImage && <ImageModal src={modalImage} onClose={() => setModalImage(null)} />}
    </div>
  )
}
