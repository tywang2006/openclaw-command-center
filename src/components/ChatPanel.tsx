import { useState, useRef, useEffect, useCallback } from 'react'
import type { Department, Activity } from '../hooks/useAgentState'
import { useStreamingTexts } from '../hooks/useAgentState'
import { DeptIcon, SendIcon } from './Icons'
import { useToast } from './Toast'
import { useLocale } from '../i18n/index'
import { authedFetch } from '../utils/api'
import ImageModal from './ImageModal'
import SkillPicker from './SkillPicker'
import WorkflowEditor from './WorkflowEditor'
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

export default function ChatPanel({ selectedDeptId, departments, activities, addActivity, onSubAgentsChange, prefillMessage, onPrefillConsumed, onOpenDeptForm }: ChatPanelProps) {
  const streamingTexts = useStreamingTexts()
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)

  // Accept prefill message from external source (e.g. IntegrationsTab)
  useEffect(() => {
    if (prefillMessage) {
      setText(prefillMessage)
      onPrefillConsumed?.()
      // Focus textarea
      setTimeout(() => textareaRef.current?.focus(), 100)
    }
  }, [prefillMessage])
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

  // Document attachments
  const [pendingDocs, setPendingDocs] = useState<{ file: File; name: string; size: number }[]>([])
  const docInputRef = useRef<HTMLInputElement>(null)

  // Upload progress
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)

  // Fullscreen image modal
  const [modalImage, setModalImage] = useState<string | null>(null)

  // Pull-to-refresh
  const [pullDistance, setPullDistance] = useState(0)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const pullStartY = useRef<number | null>(null)
  const PULL_THRESHOLD = 60

  // Auto-resize textarea ref
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Bottom toolbar toggle
  const [showToolbar, setShowToolbar] = useState(false)

  // Slash command hints
  const [showCmdHints, setShowCmdHints] = useState(false)
  const [cmdFilter, setCmdFilter] = useState('')

  // Drag and drop
  const [isDragging, setIsDragging] = useState(false)
  const dragCounterRef = useRef(0)

  // Voice input
  const [recording, setRecording] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])

  // Email form
  const [showEmailForm, setShowEmailForm] = useState(false)
  const [emailForm, setEmailForm] = useState({ to: '', subject: '', body: '' })
  const [emailSending, setEmailSending] = useState(false)
  const [emailConfigured, setEmailConfigured] = useState(false)

  // Export dropdown
  const [showExportMenu, setShowExportMenu] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [driveConfigured, setDriveConfigured] = useState(false)
  const [voiceConfigured, setVoiceConfigured] = useState(false)

  // Skill picker & Workflow
  const [showSkillPicker, setShowSkillPicker] = useState(false)
  const [showWorkflow, setShowWorkflow] = useState(false)

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

  const addDocument = useCallback((file: File) => {
    const allowedTypes = ['.pdf', '.docx', '.xlsx', '.pptx', '.txt', '.csv', '.json', '.md']
    const ext = '.' + file.name.split('.').pop()?.toLowerCase()
    if (!allowedTypes.includes(ext)) {
      showToast(t('chat.doc.unsupported'))
      return
    }
    if (file.size > 50 * 1024 * 1024) {
      showToast(t('chat.doc.tooLarge'))
      return
    }
    setPendingDocs(prev => [...prev, { file, name: file.name, size: file.size }])
  }, [showToast])

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

  // Drag and drop handlers
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current++
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragging(true)
    }
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current--
    if (dragCounterRef.current === 0) {
      setIsDragging(false)
    }
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    dragCounterRef.current = 0
    if (!selectedDeptId) return
    const files = e.dataTransfer.files
    if (!files.length) return
    for (const file of Array.from(files)) {
      if (file.type.startsWith('image/')) {
        addImageFromFile(file)
      } else {
        addDocument(file)
      }
    }
  }, [selectedDeptId, addImageFromFile, addDocument])

  // Pull-to-refresh handlers
  const handlePullStart = useCallback((e: React.TouchEvent) => {
    if (messagesRef.current && messagesRef.current.scrollTop <= 0) {
      pullStartY.current = e.touches[0].clientY
    }
  }, [])

  const handlePullMove = useCallback((e: React.TouchEvent) => {
    if (pullStartY.current === null || isRefreshing) return
    const delta = e.touches[0].clientY - pullStartY.current
    if (delta > 0 && messagesRef.current && messagesRef.current.scrollTop <= 0) {
      setPullDistance(Math.min(delta * 0.5, 100))
    }
  }, [isRefreshing])

  const handlePullEnd = useCallback(() => {
    if (pullDistance >= PULL_THRESHOLD && selectedDeptId && !isRefreshing) {
      setIsRefreshing(true)
      // Reload chat history
      setHistoryByDept(prev => {
        const next = { ...prev }
        delete next[selectedDeptId]
        return next
      })
      setTimeout(() => {
        setIsRefreshing(false)
        setPullDistance(0)
      }, 1000)
    } else {
      setPullDistance(0)
    }
    pullStartY.current = null
  }, [pullDistance, selectedDeptId, isRefreshing])

  // Auto-resize textarea
  const autoResizeTextarea = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 120) + 'px'
  }, [])

  // Voice input handlers
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4'
      const mediaRecorder = new MediaRecorder(stream, { mimeType })
      audioChunksRef.current = []
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data)
      }
      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType })
        await transcribeAudio(audioBlob, mimeType)
      }
      mediaRecorder.start()
      mediaRecorderRef.current = mediaRecorder
      setRecording(true)
    } catch {
      showToast(t('voice.permission.denied'))
    }
  }

  const stopRecording = () => {
    mediaRecorderRef.current?.stop()
    setRecording(false)
  }

  const transcribeAudio = async (blob: Blob, mimeType: string) => {
    setTranscribing(true)
    try {
      const ext = mimeType.includes('webm') ? 'webm' : 'mp4'
      const formData = new FormData()
      formData.append('audio', blob, `recording.${ext}`)
      const res = await authedFetch('/api/voice/transcribe', { method: 'POST', body: formData })
      const data = await res.json()
      if (data.success && data.text) {
        setText(prev => prev + (prev ? ' ' : '') + data.text)
      } else {
        showToast(t('voice.failed'))
      }
    } catch {
      showToast(t('voice.error'))
    }
    setTranscribing(false)
  }

  // Email handler
  const handleSendEmail = async () => {
    if (!emailForm.to || !emailForm.subject) return
    setEmailSending(true)
    try {
      const res = await authedFetch('/api/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(emailForm),
      })
      const data = await res.json()
      if (data.success) {
        showToast(t('email.sent'))
        setShowEmailForm(false)
        setEmailForm({ to: '', subject: '', body: '' })
      } else {
        showToast(t('email.failed', { error: data.error || '' }))
      }
    } catch {
      showToast(t('email.failed', { error: t('common.networkError') }))
    }
    setEmailSending(false)
  }

  // Export handlers
  const handleExport = async (format: 'md' | 'html') => {
    if (!selectedDeptId) return
    setExporting(true)
    try {
      const res = await authedFetch(`/api/departments/${selectedDeptId}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format }),
      })
      const blob = await res.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      const ext = format === 'md' ? 'md' : 'html'
      a.download = `chat-export-${selectedDeptId}-${new Date().toISOString().split('T')[0]}.${ext}`
      a.click()
      URL.revokeObjectURL(a.href)
    } catch {
      showToast(t('export.failed'))
    }
    setExporting(false)
    setShowExportMenu(false)
  }

  const handleExportEmail = async () => {
    if (!selectedDeptId) return
    setExporting(true)
    try {
      const res = await authedFetch(`/api/departments/${selectedDeptId}/export/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: emailForm.to || '',
          subject: emailForm.subject || t('email.default.subject', {
            dept: dept?.name || selectedDeptId,
            date: new Date().toISOString().split('T')[0]
          }),
        }),
      })
      const data = await res.json()
      if (data.success) {
        showToast(t('export.sent'))
      } else {
        showToast(t('export.failed'))
      }
    } catch {
      showToast(t('export.failed'))
    }
    setExporting(false)
    setShowExportMenu(false)
  }

  const handleExportDrive = async () => {
    if (!selectedDeptId) return
    setExporting(true)
    try {
      const res = await authedFetch(`/api/departments/${selectedDeptId}/export/drive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: `chat-export-${selectedDeptId}-${new Date().toISOString().split('T')[0]}.md`,
        }),
      })
      const data = await res.json()
      if (data.success) {
        showToast(t('drive.saved'))
      } else {
        showToast(t('drive.failed', { error: data.error || '' }))
      }
    } catch {
      showToast(t('drive.failed', { error: t('common.networkError') }))
    }
    setExporting(false)
    setShowExportMenu(false)
  }

  useEffect(() => {
    autoResizeTextarea()
  }, [text, autoResizeTextarea])

  // Check email, drive, and voice status
  useEffect(() => {
    authedFetch('/api/email/status').then(r => r.json()).then(d => setEmailConfigured(d.configured && d.enabled)).catch(() => {})
    authedFetch('/api/drive/status').then(r => r.json()).then(d => setDriveConfigured(d.configured && d.enabled)).catch(() => {})
    authedFetch('/api/voice/status').then(r => r.json()).then(d => setVoiceConfigured(d.configured)).catch(() => {})
  }, [])

  const dept = departments.find(d => d.id === selectedDeptId)

  // Fetch department persona
  const fetchPersona = async () => {
    if (!selectedDeptId) return
    setPersonaLoading(true)
    try {
      const res = await authedFetch(`/api/departments/${selectedDeptId}/persona`)
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
    authedFetch(`/api/departments/${selectedDeptId}/history?limit=50`)
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

  // Scroll to bottom when department changes or history finishes loading
  const currentHistory = selectedDeptId ? (historyByDept[selectedDeptId] || []) : []
  const historyLoaded = currentHistory.length > 0
  useEffect(() => {
    if (selectedDeptId && messagesRef.current) {
      // Use requestAnimationFrame to ensure DOM has rendered
      requestAnimationFrame(() => {
        if (messagesRef.current) {
          messagesRef.current.scrollTop = messagesRef.current.scrollHeight
        }
      })
    }
  }, [selectedDeptId, historyLoaded])

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

    authedFetch(`/api/departments/${selectedDeptId}/subagents`)
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

  // Slash command definitions
  const chatCommands = [
    { cmd: '/dept', alias: '/部门', desc: t('cmd.dept.desc'), hint: t('cmd.dept.hint') },
    { cmd: '/broadcast', alias: '/广播', desc: t('cmd.broadcast.desc'), hint: t('cmd.broadcast.hint') },
    { cmd: '/export', alias: '/导出', desc: t('cmd.export.desc'), hint: t('cmd.export.hint') },
    { cmd: '/status', alias: '/状态', desc: t('cmd.status.desc'), hint: t('cmd.status.hint') },
    { cmd: '/clear', alias: '/清屏', desc: t('cmd.clear.desc'), hint: t('cmd.clear.hint') },
    { cmd: '/help', alias: '/帮助', desc: t('cmd.help.desc'), hint: t('cmd.help.hint') },
  ]

  const filteredCommands = cmdFilter
    ? chatCommands.filter(c => c.cmd.startsWith(cmdFilter) || c.alias.startsWith(cmdFilter))
    : chatCommands

  // Chat command handler
  const handleChatCommand = (msg: string): boolean => {
    const trimmed = msg.trim()
    if (!trimmed.startsWith('/')) return false

    // /dept or /部门
    const deptMatch = trimmed.match(/^\/(dept|部门)\s*(.*)$/i)
    if (deptMatch) {
      const arg = deptMatch[2].trim()
      setText('')
      setShowCmdHints(false)

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
      setText('')
      setShowCmdHints(false)
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
      setText('')
      setShowCmdHints(false)
      if (selectedDeptId) {
        handleExport('md')
        addActivity({ deptId: selectedDeptId, role: 'assistant', text: t('cmd.export.started'), timestamp: Date.now(), source: 'app' })
      }
      return true
    }

    // /status or /状态
    if (/^\/(status|状态)$/i.test(trimmed)) {
      setText('')
      setShowCmdHints(false)
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
      setText('')
      setShowCmdHints(false)
      if (selectedDeptId) {
        setHistoryByDept(prev => {
          const next = { ...prev }
          delete next[selectedDeptId]
          return next
        })
      }
      return true
    }

    // /help or /帮助
    if (/^\/(help|帮助)$/i.test(trimmed)) {
      setText('')
      setShowCmdHints(false)
      const helpText = chatCommands.map(c => `${c.cmd}  ${c.alias}  — ${c.desc}`).join('\n')
      addActivity({ deptId: selectedDeptId || 'system', role: 'assistant', text: t('cmd.help.title') + '\n' + helpText, timestamp: Date.now(), source: 'app' })
      return true
    }

    return false
  }

  const sendMessage = async () => {
    if ((!text.trim() && pendingImages.length === 0) || sending || !selectedDeptId) return
    const msg = text.trim()

    // Check for chat commands first
    if (msg && handleChatCommand(msg)) return
    const images = [...pendingImages]
    const docs = [...pendingDocs]
    setText('')
    setPendingImages([])
    setPendingDocs([])
    setSending(true)

    // Upload documents first
    const uploadedDocs: { name: string; extracted?: any }[] = []
    if (docs.length > 0) {
      setUploadProgress(0)
      for (let i = 0; i < docs.length; i++) {
        const doc = docs[i]
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
        setUploadProgress(Math.round(((i + 1) / docs.length) * 100))
      }
      setUploadProgress(null)
    }

    // Add user message immediately (with image and document indicators)
    const subName = subAgents.find(s => s.id === activeChat)?.name || ''
    let displayText = activeChat === 'main' ? msg : `[${subName}] ${msg}`
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

      const body: Record<string, unknown> = { message: msg }
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
      const res = await authedFetch(`/api/departments/${selectedDeptId}/subagents`, {
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
      const res = await authedFetch(`/api/departments/${selectedDeptId}/subagents/${subId}`, { method: 'DELETE' })
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

  const handleTextChange = (val: string) => {
    setText(val)
    if (val.startsWith('/') && !val.includes(' ') && !val.includes('\n')) {
      setCmdFilter(val)
      setShowCmdHints(true)
    } else {
      setShowCmdHints(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showCmdHints && (e.key === 'Escape' || e.key === 'Tab')) {
      e.preventDefault()
      setShowCmdHints(false)
      return
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      setShowCmdHints(false)
      sendMessage()
    }
  }

  const selectCommand = (cmd: string) => {
    setText(cmd + ' ')
    setShowCmdHints(false)
    textareaRef.current?.focus()
  }

  const formatTime = (ts: number) => {
    return new Date(ts).toLocaleTimeString(locale === 'zh' ? 'zh-CN' : 'en-US', {
      hour: '2-digit', minute: '2-digit', hour12: false
    })
  }

  // File type icon helper
  const getFileIcon = (filename: string, size: number = 16) => {
    const ext = filename.split('.').pop()?.toLowerCase() || ''
    const colors: Record<string, string> = {
      pdf: '#ff4444', docx: '#4488ff', xlsx: '#22aa44', pptx: '#ff8800',
      txt: '#a0a0b0', csv: '#22aa44', json: '#ffaa00', md: '#a0a0b0',
    }
    const color = colors[ext] || '#a0a0b0'
    const label = ext.toUpperCase().substring(0, 4)
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
        <path d="M2 1.5h8l4 4v9.5H2V1.5z" stroke={color} strokeWidth="1.2" fill="none" />
        <path d="M10 1.5v4h4" stroke={color} strokeWidth="1.2" />
        <text x="8" y="12" textAnchor="middle" fill={color} fontSize="4" fontWeight="700" fontFamily="var(--font-mono)">{label}</text>
      </svg>
    )
  }

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  }

  return (
    <div
      className="chat-panel"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      style={{ position: 'relative' }}
    >
      {/* Drag & drop overlay */}
      {isDragging && selectedDeptId && (
        <div className="chat-drop-overlay">
          <div className="chat-drop-overlay-content">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
              <path d="M4 20l12-12 12 12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M16 8v20" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
            <span className="chat-drop-overlay-text">{t('chat.drop.hint')}</span>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="chat-header">
        {dept ? (
          <>
            <DeptIcon deptId={dept.id} size={18} />
            <span className="chat-dept-name">{dept.name}</span>
            <span className={`chat-status ${dept.status}`}>{dept.status}</span>
            <div className="chat-export-wrapper">
              <button
                className="chat-btn"
                onClick={() => setShowExportMenu(!showExportMenu)}
                title={t('export.title')}
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <path d="M8 1v10M4 8l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M2 12v2h12v-2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
              {showExportMenu && (
                <div className="chat-export-menu">
                  <button onClick={() => handleExport('md')}>{t('export.md')}</button>
                  <button onClick={() => handleExport('html')}>{t('export.html')}</button>
                  <button onClick={() => handleExportEmail()} disabled={!emailConfigured}>{t('export.email')}</button>
                  <button onClick={() => handleExportDrive()} disabled={!driveConfigured}>{t('export.drive')}</button>
                </div>
              )}
            </div>
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
            title={t('chat.agent.main')}
          >
            <span className="agent-chip-icon">●</span>
            <span className="agent-chip-label">{t('chat.agent.main')}</span>
          </button>
          {subAgents.map(sub => (
            <button
              key={sub.id}
              className={`agent-chip ${activeChat === sub.id ? 'active' : ''}`}
              onClick={() => setActiveChat(sub.id)}
              title={`${sub.name}: ${sub.task}`}
            >
              <span className="agent-chip-icon">{sub.name.charAt(0)}</span>
              <span className="agent-chip-label">{sub.name}</span>
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
      <div
        className="chat-messages"
        ref={messagesRef}
        onTouchStart={handlePullStart}
        onTouchMove={handlePullMove}
        onTouchEnd={handlePullEnd}
      >
        {/* Pull-to-refresh indicator */}
        {(pullDistance > 0 || isRefreshing) && (
          <div
            className="pull-refresh-indicator"
            style={{ height: isRefreshing ? PULL_THRESHOLD : pullDistance }}
          >
            {isRefreshing ? (
              <div className="pull-refresh-spinner" />
            ) : (
              <svg
                width="20" height="20" viewBox="0 0 20 20" fill="none"
                style={{
                  transform: `rotate(${pullDistance >= PULL_THRESHOLD ? 180 : 0}deg)`,
                  transition: 'transform 0.2s',
                  opacity: Math.min(pullDistance / PULL_THRESHOLD, 1),
                }}
              >
                <path d="M10 4v10M6 10l4 4 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </div>
        )}
        {deptActivities.length === 0 ? (
          <div className="chat-empty">
            {selectedDeptId
              ? t('chat.message.send', { name: dept?.name || selectedDeptId })
              : t('chat.message.click')}
          </div>
        ) : (
          deptActivities.map((msg, i) => (
            <div key={i} className={`chat-msg ${msg.role} chat-msg-touch`}>
              <div className="chat-msg-meta">
                {msg.role === 'user' ? (
                  <>
                    <span className="chat-msg-sender you">
                      {msg.fromName || t('chat.message.you')}
                    </span>
                    {msg.source && msg.source !== 'app' && (
                      <span className={`chat-msg-source ${msg.source}`}>
                        {msg.source === 'telegram' ? t('chat.source.telegram') : msg.source === 'gateway' ? t('chat.source.gateway') : msg.source}
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
                        {msg.source === 'telegram' ? t('chat.source.telegram') : msg.source === 'gateway' ? t('chat.source.gateway') : msg.source}
                      </span>
                    )}
                  </>
                )}
                <span className="chat-msg-time">{formatTime(msg.timestamp)}</span>
              </div>
              <div className="chat-msg-text">{msg.text}</div>
              {msg.images && msg.images.length > 0 && (
                <div className="chat-msg-images">
                  {msg.images.map((imgSrc, j) => (
                    <img
                      key={j}
                      src={imgSrc}
                      className="chat-msg-img"
                      alt=""
                      onClick={() => setModalImage(imgSrc)}
                    />
                  ))}
                </div>
              )}
              {msg.attachments && msg.attachments.length > 0 && (
                <div className="chat-msg-attachments">
                  {msg.attachments.map((att, j) => (
                    <a key={j} href={att.url} download={att.name} className="chat-attachment">
                      <div className="attachment-icon-wrapper">
                        {getFileIcon(att.name, 16)}
                      </div>
                      <div className="attachment-info">
                        <span className="attachment-name">{att.name}</span>
                        <span className="attachment-size">{formatFileSize(att.size)}</span>
                      </div>
                      <svg className="attachment-download" width="14" height="14" viewBox="0 0 16 16" fill="none">
                        <path d="M8 2v9M4 8l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        <path d="M2 13h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                      </svg>
                    </a>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
        {sending && activeChat === 'main' && (() => {
          const streamText = streamingTexts?.get(selectedDeptId || '')
          return (
            <div className="chat-msg assistant chat-msg-touch">
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

      {/* Email form */}
      {showEmailForm && selectedDeptId && (
        <div className="chat-email-form">
          <div className="chat-email-title">{t('email.toolbar.label')}</div>
          <input
            placeholder={t('email.form.to')}
            value={emailForm.to}
            onChange={e => setEmailForm(f => ({ ...f, to: e.target.value }))}
            className="chat-email-input"
          />
          <input
            placeholder={t('email.form.subject')}
            value={emailForm.subject}
            onChange={e => setEmailForm(f => ({ ...f, subject: e.target.value }))}
            className="chat-email-input"
          />
          <textarea
            placeholder={t('email.form.body')}
            value={emailForm.body}
            onChange={e => setEmailForm(f => ({ ...f, body: e.target.value }))}
            className="chat-email-textarea"
            rows={3}
          />
          <button
            className="chat-email-send"
            onClick={handleSendEmail}
            disabled={emailSending || !emailForm.to || !emailForm.subject}
          >
            {emailSending ? t('email.form.sending') : t('email.form.send')}
          </button>
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
                authedFetch(`/api/departments/${selectedDeptId}/daily/${e.target.value}`)
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

      {/* Upload progress */}
      {uploadProgress !== null && (
        <div className="chat-upload-progress">
          <div className="upload-progress-label">
            <span>{t('chat.upload.progress')}</span>
            <span className="upload-progress-pct">{uploadProgress}%</span>
          </div>
          <div className="upload-progress-track">
            <div className="upload-progress-fill" style={{ width: `${uploadProgress}%` }} />
          </div>
        </div>
      )}

      {/* Document preview */}
      {pendingDocs.length > 0 && (
        <div className="chat-doc-preview">
          {pendingDocs.map((doc, i) => (
            <div key={i} className="doc-thumb">
              <div className="doc-icon-wrapper">
                {getFileIcon(doc.name, 18)}
              </div>
              <div className="doc-info">
                <span className="doc-name">{doc.name}</span>
                <span className="doc-size">{formatFileSize(doc.size)}</span>
              </div>
              <button className="preview-remove" onClick={() => setPendingDocs(prev => prev.filter((_, j) => j !== i))}>x</button>
            </div>
          ))}
        </div>
      )}

      {/* Bottom toolbar (collapsible) */}
      {showToolbar && selectedDeptId && (
        <div className="chat-toolbar">
          <button
            className="chat-toolbar-btn"
            onClick={() => { fileInputRef.current?.click(); setShowToolbar(false) }}
          >
            <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
              <rect x="1.5" y="2.5" width="13" height="11" rx="2" stroke="currentColor" strokeWidth="1.3" />
              <circle cx="5.5" cy="6.5" r="1.5" stroke="currentColor" strokeWidth="1.2" />
              <path d="M1.5 11l3.5-4 3 3 2-1.5 4.5 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>{t('chat.toolbar.image')}</span>
          </button>
          <button
            className="chat-toolbar-btn"
            onClick={() => { docInputRef.current?.click(); setShowToolbar(false) }}
          >
            <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
              <path d="M2 3h8l4 4v9H2V3z" stroke="currentColor" strokeWidth="1.3" fill="none" />
              <path d="M10 3v4h4" stroke="currentColor" strokeWidth="1.3" />
              <path d="M5 8h6M5 11h6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
            <span>{t('chat.toolbar.document')}</span>
          </button>
          <button
            className="chat-toolbar-btn"
            onClick={() => { setShowEmailForm(!showEmailForm); setShowToolbar(false) }}
            disabled={!emailConfigured}
          >
            <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
              <rect x="1" y="3" width="14" height="10" rx="1" stroke="currentColor" strokeWidth="1.3" />
              <path d="M1 4l7 5 7-5" stroke="currentColor" strokeWidth="1.3" />
            </svg>
            <span>{t('email.toolbar.label')}</span>
          </button>
          <button
            className="chat-toolbar-btn"
            onClick={() => {
              setShowDailyLog(!showDailyLog)
              setShowToolbar(false)
              if (!showDailyLog && dailyDates.length === 0 && selectedDeptId) {
                authedFetch(`/api/departments/${selectedDeptId}/daily-dates`)
                  .then(r => r.json())
                  .then(d => {
                    setDailyDates(d.dates || [])
                    if (d.dates?.[0]) setSelectedDate(d.dates[0])
                  })
                  .catch(() => {})
              }
            }}
          >
            <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
              <rect x="1.5" y="2.5" width="13" height="12" stroke="currentColor" strokeWidth="1.3" />
              <path d="M1.5 6.5h13" stroke="currentColor" strokeWidth="1.3" />
              <path d="M5 1v3M11 1v3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
            <span>{t('chat.toolbar.daily')}</span>
          </button>
          <button
            className="chat-toolbar-btn"
            onClick={() => { setShowTimerForm(!showTimerForm); setShowToolbar(false) }}
          >
            <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" />
              <path d="M8 4v4l3 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <span>{t('chat.toolbar.timer')}</span>
          </button>
          <button
            className="chat-toolbar-btn"
            onClick={() => { setShowSkillPicker(true); setShowToolbar(false) }}
          >
            <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
              <path d="M8 1l2 4h4l-3 3 1 4-4-2-4 2 1-4-3-3h4z" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinejoin="round" />
            </svg>
            <span>{t('chat.toolbar.skills')}</span>
          </button>
          <button
            className="chat-toolbar-btn"
            onClick={() => { setShowWorkflow(true); setShowToolbar(false) }}
          >
            <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
              <path d="M2 3h5v3H2zM9 3h5v3H9zM5.5 10h5v3h-5z" stroke="currentColor" strokeWidth="1.3" fill="none" />
              <path d="M4.5 6v2h3.5v2M11.5 6v2H8v2" stroke="currentColor" strokeWidth="1.3" />
            </svg>
            <span>{t('chat.toolbar.workflow')}</span>
          </button>
        </div>
      )}

      {/* Slash command hints */}
      {showCmdHints && filteredCommands.length > 0 && (
        <div className="cmd-hints-dropdown">
          {filteredCommands.map(c => (
            <button key={c.cmd} className="cmd-hint-item" onClick={() => selectCommand(c.cmd)}>
              <span className="cmd-hint-name">{c.cmd}</span>
              <span className="cmd-hint-alias">{c.alias}</span>
              <span className="cmd-hint-desc">{c.desc}</span>
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="chat-input-row">
        <button
          className="chat-btn toolbar-toggle-btn"
          onClick={() => setShowToolbar(!showToolbar)}
          disabled={!selectedDeptId}
          title={t('chat.toolbar.toggle')}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" style={{ transform: showToolbar ? 'rotate(45deg)' : 'none', transition: 'transform 0.2s' }}>
            <path d="M9 3v12M3 9h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
        <textarea
          ref={textareaRef}
          className="chat-input"
          value={text}
          onChange={e => handleTextChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onFocus={() => {
            // Scroll to bottom when keyboard appears
            setTimeout(() => {
              messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight, behavior: 'smooth' })
            }, 300)
          }}
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
        <input
          ref={docInputRef}
          type="file"
          accept=".pdf,.docx,.xlsx,.pptx,.txt,.csv,.json,.md"
          multiple
          style={{ display: 'none' }}
          onChange={e => {
            if (e.target.files) {
              Array.from(e.target.files).forEach(addDocument)
            }
            e.target.value = ''
          }}
        />
        {voiceConfigured && (
          <button
            className={`chat-btn mic-btn ${recording ? 'recording' : ''}`}
            onClick={recording ? stopRecording : startRecording}
            disabled={transcribing}
            title={recording ? t('voice.stop') : t('voice.record')}
          >
            {transcribing ? (
              <span style={{ fontSize: 10 }}>{t('voice.transcribing')}</span>
            ) : (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <rect x="5.5" y="1" width="5" height="9" rx="2.5" stroke="currentColor" strokeWidth="1.3" />
                <path d="M3 7.5a5 5 0 0 0 10 0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                <path d="M8 13v2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
            )}
          </button>
        )}
        <button
          className="chat-btn send-btn"
          onClick={sendMessage}
          disabled={sending || !selectedDeptId || (!text.trim() && pendingImages.length === 0 && pendingDocs.length === 0)}
          title="Send"
        >
          {sending ? '...' : <SendIcon size={16} color="#00d4aa" />}
        </button>
      </div>

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
