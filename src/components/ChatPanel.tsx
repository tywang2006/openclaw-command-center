import { useState, useRef, useEffect } from 'react'
import type { Department, Activity } from '../hooks/useAgentState'
import { DeptIcon, SendIcon } from './Icons'
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
}

export default function ChatPanel({ selectedDeptId, departments, activities, addActivity, onSubAgentsChange }: ChatPanelProps) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [subAgents, setSubAgents] = useState<SubAgent[]>([])
  const [activeChat, setActiveChat] = useState<string>('main') // 'main' or subAgent id
  const [showNewSub, setShowNewSub] = useState(false)
  const [newSubName, setNewSubName] = useState('')
  const [newSubTask, setNewSubTask] = useState('')
  const [error, setError] = useState<string | null>(null)
  const messagesRef = useRef<HTMLDivElement>(null)

  const dept = departments.find(d => d.id === selectedDeptId)

  // Filter activities for selected department
  const deptActivities = selectedDeptId
    ? activities.filter(a => a.deptId === selectedDeptId)
    : activities

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
    fetch(`/cmd/api/departments/${selectedDeptId}/subagents`)
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
    if (!text.trim() || sending || !selectedDeptId) return
    const msg = text.trim()
    setText('')
    setSending(true)

    // Add user message immediately
    addActivity({
      deptId: selectedDeptId,
      role: 'user',
      text: activeChat === 'main' ? msg : `[${subAgents.find(s => s.id === activeChat)?.name || '子代理'}] ${msg}`,
      timestamp: Date.now(),
    })

    try {
      const url = activeChat === 'main'
        ? `/cmd/api/departments/${selectedDeptId}/chat`
        : `/cmd/api/departments/${selectedDeptId}/subagents/${activeChat}/chat`

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg })
      })
      const data = await res.json()
      if (data.success && data.reply) {
        const prefix = activeChat === 'main' ? '' : `[${subAgents.find(s => s.id === activeChat)?.name || '子代理'}] `
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
          text: `[Error] ${data.error || 'Agent not responding'}`,
          timestamp: Date.now(),
        })
      }
    } catch {
      addActivity({
        deptId: selectedDeptId,
        role: 'assistant',
        text: '[Error] Network error',
        timestamp: Date.now(),
      })
    }
    setSending(false)
  }

  const createSubAgent = async () => {
    if (!newSubTask.trim() || !selectedDeptId) return
    const agentName = newSubName.trim() || undefined
    setError(null)
    try {
      const res = await fetch(`/cmd/api/departments/${selectedDeptId}/subagents`, {
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
          text: `[系统] 创建子代理「${data.name}」，任务: ${newSubTask.trim()}`,
          timestamp: Date.now(),
        })
      } else {
        console.error('[SubAgent] Failed to create sub-agent:', data.error)
        setError(`创建子代理失败: ${data.error || '未知错误'}`)
      }
    } catch (err) {
      console.error('[SubAgent] Network error creating sub-agent:', err)
      setError('网络错误，无法创建子代理')
    }
    setNewSubName('')
    setNewSubTask('')
    setShowNewSub(false)
  }

  const removeSubAgentHandler = async (subId: string) => {
    if (!selectedDeptId) return
    setError(null)
    try {
      const res = await fetch(`/cmd/api/departments/${selectedDeptId}/subagents/${subId}`, { method: 'DELETE' })
      if (!res.ok) {
        console.error('[SubAgent] Failed to delete sub-agent:', res.status)
        setError('删除子代理失败')
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
      setError('网络错误，无法删除子代理')
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const formatTime = (ts: number) => {
    return new Date(ts).toLocaleTimeString('zh-CN', {
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
          </>
        ) : (
          <span className="chat-no-dept">
            {departments.length > 0
              ? '选择一个部门开始对话'
              : 'Loading...'}
          </span>
        )}
      </div>

      {/* Error display */}
      {error && (
        <div style={{ padding: '8px 12px', background: '#ff4444', color: 'white', fontSize: '12px' }}>
          {error}
        </div>
      )}

      {/* Sub-agent selector */}
      {selectedDeptId && (
        <div className="chat-agent-bar">
          <button
            className={`agent-chip ${activeChat === 'main' ? 'active' : ''}`}
            onClick={() => setActiveChat('main')}
          >
            主代理
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
            placeholder="名字 (如: 小王)"
          />
          <input
            value={newSubTask}
            onChange={e => setNewSubTask(e.target.value)}
            placeholder="任务描述..."
            onKeyDown={e => { if (e.key === 'Enter') createSubAgent() }}
          />
          <button onClick={createSubAgent} disabled={!newSubTask.trim()}>创建</button>
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
            <div className="sub-detail-task">任务: {sub.task}</div>
          </div>
        )
      })()}

      {/* Messages */}
      <div className="chat-messages" ref={messagesRef}>
        {deptActivities.length === 0 ? (
          <div className="chat-empty">
            {selectedDeptId
              ? `发送消息到 ${dept?.name || selectedDeptId}`
              : '点击底部部门开始对话'}
          </div>
        ) : (
          deptActivities.map((msg, i) => (
            <div key={i} className={`chat-msg ${msg.role}`}>
              <div className="chat-msg-meta">
                {msg.role === 'user' ? (
                  <span className="chat-msg-sender you">YOU</span>
                ) : (
                  <>
                    <DeptIcon deptId={msg.deptId} size={12} />
                    <span className="chat-msg-sender bot">
                      {departments.find(d => d.id === msg.deptId)?.name || msg.deptId}
                    </span>
                  </>
                )}
                <span className="chat-msg-time">{formatTime(msg.timestamp)}</span>
              </div>
              <div className="chat-msg-text">{msg.text}</div>
            </div>
          ))
        )}
        {sending && (
          <div className="chat-msg assistant">
            <div className="chat-msg-meta">
              <DeptIcon deptId={selectedDeptId || ''} size={12} />
              <span className="chat-msg-sender bot">Thinking...</span>
            </div>
            <div className="chat-typing">
              <span></span><span></span><span></span>
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="chat-input-row">
        <textarea
          className="chat-input"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            !selectedDeptId
              ? '选择一个部门...'
              : activeChat === 'main'
                ? `消息到 ${dept?.name || ''}...`
                : `消息到 ${subAgents.find(s => s.id === activeChat)?.name || '子代理'}...`
          }
          rows={1}
          disabled={sending || !selectedDeptId}
        />
        <button
          className="chat-btn send-btn"
          onClick={sendMessage}
          disabled={sending || !selectedDeptId || !text.trim()}
          title="Send"
        >
          {sending ? '...' : <SendIcon size={16} color="#00d4aa" />}
        </button>
      </div>
    </div>
  )
}
