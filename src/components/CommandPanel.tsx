import { useState, useRef } from 'react'
import type { Department, Activity } from '../hooks/useAgentState'
import { DeptIcon, SendIcon, ImageIcon } from './Icons'
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

  const dept = departments.find(d => d.id === selectedDeptId)

  if (!selectedDeptId || !dept) {
    return (
      <div className="command-panel">
        <div className="command-empty">
          点击底部状态栏选择一个部门，即可发送指令
        </div>
      </div>
    )
  }

  const sendText = async () => {
    if (!text.trim() || sending) return
    setSending(true)
    setStatus(null)
    try {
      const res = await fetch(`/cmd/api/departments/${selectedDeptId}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text.trim() })
      })
      const data = await res.json()
      if (data.success) {
        setStatus({ type: 'ok', msg: '已发送' })
        addActivity({
          deptId: selectedDeptId!,
          role: 'user',
          text: `[指令] ${text.trim()}`,
          timestamp: Date.now(),
        })
        setText('')
      } else {
        setStatus({ type: 'err', msg: data.error || '发送失败' })
      }
    } catch (e) {
      setStatus({ type: 'err', msg: '网络错误' })
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
      const res = await fetch(`/cmd/api/departments/${selectedDeptId}/photo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photo: preview, caption: text.trim() || '' })
      })
      const data = await res.json()
      if (data.success) {
        setStatus({ type: 'ok', msg: '图片已发送' })
        addActivity({
          deptId: selectedDeptId!,
          role: 'user',
          text: `[图片] ${text.trim() || '截图'}`,
          timestamp: Date.now(),
        })
        setPreview(null)
        setText('')
        if (fileRef.current) fileRef.current.value = ''
      } else {
        setStatus({ type: 'err', msg: data.error || '发送失败' })
      }
    } catch (e) {
      setStatus({ type: 'err', msg: '网络错误' })
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
          className="command-input"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={preview ? '添加说明 (可选)...' : '输入指令发送给该部门...'}
          rows={2}
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
            title="上传截图"
          >
            <ImageIcon size={14} />
          </button>
          <button
            className="action-btn send-btn"
            onClick={preview ? sendPhoto : sendText}
            disabled={sending || (!text.trim() && !preview)}
            title="发送"
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
