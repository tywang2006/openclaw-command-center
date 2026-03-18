import { useState, useRef, useEffect, useCallback } from 'react'
import type { Department } from '../hooks/useAgentState'
import type { SubAgent } from './ChatPanel'
import { SendIcon } from './Icons'
import { useToast } from './Toast'
import { useLocale } from '../i18n/index'
import { authedFetch } from '../utils/api'

interface ChatInputProps {
  selectedDeptId: string | null
  dept: Department | undefined
  activeChat: string
  subAgents: SubAgent[]
  sending: boolean
  onSendMessage: (text: string, images: { data: string; name: string }[], docs: { file: File; name: string; size: number }[]) => void
  onShowToolbar: (show: boolean) => void
  showToolbar: boolean
  prefillMessage?: string | null
  onPrefillConsumed?: () => void
  messagesRef: React.RefObject<HTMLDivElement | null>
  fileInputRef: React.RefObject<HTMLInputElement | null>
  docInputRef: React.RefObject<HTMLInputElement | null>
  showEmailForm: boolean
  onShowEmailForm: (show: boolean) => void
}

export default function ChatInput({
  selectedDeptId,
  dept,
  activeChat,
  subAgents,
  sending,
  onSendMessage,
  onShowToolbar,
  showToolbar,
  prefillMessage,
  onPrefillConsumed,
  messagesRef,
  fileInputRef,
  docInputRef,
  showEmailForm,
  onShowEmailForm,
}: ChatInputProps) {
  const [text, setText] = useState('')
  const [pendingImages, setPendingImages] = useState<{ data: string; name: string }[]>([])
  const [pendingDocs, setPendingDocs] = useState<{ file: File; name: string; size: number }[]>([])
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [recording, setRecording] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [emailForm, setEmailForm] = useState({ to: '', subject: '', body: '' })
  const [emailSending, setEmailSending] = useState(false)
  const [emailConfigured, setEmailConfigured] = useState(false)
  const [voiceConfigured, setVoiceConfigured] = useState(false)
  const [showCmdHints, setShowCmdHints] = useState(false)
  const [cmdFilter, setCmdFilter] = useState('')

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const dragCounterRef = useRef(0)

  const { showToast } = useToast()
  const { t, locale } = useLocale()

  // Accept prefill message from external source
  useEffect(() => {
    if (prefillMessage) {
      setText(prefillMessage)
      onPrefillConsumed?.()
      setTimeout(() => textareaRef.current?.focus(), 100)
    }
  }, [prefillMessage, onPrefillConsumed])

  // Check email and voice status
  useEffect(() => {
    authedFetch('/api/email/status').then(r => r.json()).then(d => setEmailConfigured(d.configured && d.enabled)).catch(() => {})
    authedFetch('/api/voice/status').then(r => r.json()).then(d => setVoiceConfigured(d.configured)).catch(() => {})
  }, [])

  // Auto-resize textarea
  const autoResizeTextarea = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 120) + 'px'
  }, [])

  useEffect(() => {
    autoResizeTextarea()
  }, [text, autoResizeTextarea])

  // Cleanup MediaRecorder on unmount
  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stream?.getTracks().forEach(t => t.stop())
        mediaRecorderRef.current.stop()
      }
    }
  }, [])

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
        onShowEmailForm(false)
        setEmailForm({ to: '', subject: '', body: '' })
      } else {
        showToast(t('email.failed', { error: data.error || '' }))
      }
    } catch {
      showToast(t('email.failed', { error: t('common.networkError') }))
    }
    setEmailSending(false)
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
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      setShowCmdHints(false)
      handleSend()
    }
  }

  const handleSend = () => {
    if ((!text.trim() && pendingImages.length === 0 && pendingDocs.length === 0) || sending || !selectedDeptId) return
    onSendMessage(text.trim(), pendingImages, pendingDocs)
    setText('')
    setPendingImages([])
    setPendingDocs([])
    setShowCmdHints(false)
  }

  const selectCommand = (cmd: string) => {
    setText(cmd + ' ')
    setShowCmdHints(false)
    textareaRef.current?.focus()
  }

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

  return (
    <>
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

      {/* Image preview */}
      {pendingImages.length > 0 && (
        <div className="chat-image-preview">
          {pendingImages.map((img, i) => (
            <div key={`img-${img.name}-${i}`} className="preview-thumb">
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
            <div key={`doc-${doc.name}-${i}`} className="doc-thumb">
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

      {/* Input row */}
      <div
        className="chat-input-row"
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <button
          className="chat-btn toolbar-toggle-btn"
          onClick={() => onShowToolbar(!showToolbar)}
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
          onClick={handleSend}
          disabled={sending || !selectedDeptId || (!text.trim() && pendingImages.length === 0 && pendingDocs.length === 0)}
          title={t('common.send')}
        >
          {sending ? '...' : <SendIcon size={16} color="#00d4aa" />}
        </button>
      </div>
    </>
  )
}
