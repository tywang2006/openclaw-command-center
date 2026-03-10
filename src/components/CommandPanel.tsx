import { useState, useRef, useCallback, useEffect } from 'react'
import type { Department, Activity } from '../hooks/useAgentState'
import { DeptIcon, SendIcon, ImageIcon } from './Icons'
import { useLocale } from '../i18n/index'
import { authedFetch } from '../utils/api'
import './CommandPanel.css'

interface CommandPanelProps {
  selectedDeptId: string | null
  departments: Department[]
  addActivity: (a: Activity) => void
}

export default function CommandPanel({ selectedDeptId, departments, addActivity }: CommandPanelProps) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [status, setStatus] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const { t } = useLocale()

  const autoResize = useCallback(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 150) + 'px'
  }, [])

  useEffect(() => { autoResize() }, [text, autoResize])

  const dept = departments.find(d => d.id === selectedDeptId)

  if (!selectedDeptId || !dept) {
    return (
      <div className="command-panel">
        <div className="command-empty">
          {t('command.empty')}
        </div>
      </div>
    )
  }

  const sendText = async () => {
    if (!text.trim() || sending) return
    setSending(true)
    setStatus(null)
    try {
      const res = await authedFetch(`/api/departments/${selectedDeptId}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text.trim() })
      })
      const data = await res.json()
      if (data.success) {
        setStatus({ type: 'ok', msg: t('command.sent') })
        addActivity({
          deptId: selectedDeptId!,
          role: 'user',
          text: t('chat.message.command.prefix', { message: text.trim() }),
          timestamp: Date.now(),
        })
        setText('')
      } else {
        setStatus({ type: 'err', msg: data.error || t('command.send.failed') })
      }
    } catch (e) {
      setStatus({ type: 'err', msg: t('command.network.error') })
    }
    setSending(false)
    setTimeout(() => setStatus(null), 3000)
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      setPreview(reader.result as string)
    }
    reader.readAsDataURL(file)
  }

  const sendPhoto = async () => {
    if (!preview || sending) return
    setSending(true)
    setStatus(null)
    try {
      const res = await authedFetch(`/api/departments/${selectedDeptId}/photo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photo: preview, caption: text.trim() || '' })
      })
      const data = await res.json()
      if (data.success) {
        setStatus({ type: 'ok', msg: t('command.photo.sent') })
        addActivity({
          deptId: selectedDeptId!,
          role: 'user',
          text: text.trim() ? t('command.photo.caption', { caption: text.trim() }) : t('command.photo.default'),
          timestamp: Date.now(),
        })
        setPreview(null)
        setText('')
        if (fileRef.current) fileRef.current.value = ''
      } else {
        setStatus({ type: 'err', msg: data.error || t('command.send.failed') })
      }
    } catch (e) {
      setStatus({ type: 'err', msg: t('command.network.error') })
    }
    setSending(false)
    setTimeout(() => setStatus(null), 3000)
  }

  const cancelPreview = () => {
    setPreview(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (preview) {
        sendPhoto()
      } else {
        sendText()
      }
    }
  }

  return (
    <div className="command-panel">
      <div className="command-target">
        <DeptIcon deptId={selectedDeptId!} size={16} />
        <span className="target-name">{dept.name}</span>
        <span className={`target-status ${dept.status}`}>{dept.status}</span>
      </div>

      {preview && (
        <div className="image-preview">
          <img src={preview} alt="preview" />
          <button className="cancel-btn" onClick={cancelPreview}>x</button>
        </div>
      )}

      <div className="command-input-row">
        <textarea
          ref={textareaRef}
          className="command-input"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={preview ? t('command.placeholder.caption') : t('command.placeholder')}
          rows={3}
          disabled={sending}
        />
        <div className="command-actions">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            onChange={handleFileSelect}
            style={{ display: 'none' }}
          />
          <button
            className="action-btn upload-btn"
            onClick={() => fileRef.current?.click()}
            disabled={sending}
            title={t('command.upload')}
          >
            <ImageIcon size={14} />
          </button>
          <button
            className="action-btn send-btn"
            onClick={preview ? sendPhoto : sendText}
            disabled={sending || (!text.trim() && !preview)}
            title={t('command.send')}
          >
            {sending ? '...' : <SendIcon size={14} />}
          </button>
        </div>
      </div>

      {status && (
        <div className={`command-status ${status.type}`}>
          {status.msg}
        </div>
      )}
    </div>
  )
}
