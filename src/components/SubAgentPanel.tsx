import { useState, useEffect } from 'react'
import type { SubAgent } from './ChatPanel'
import { useToast } from './Toast'
import { useLocale } from '../i18n/index'
import { authedFetch } from '../utils/api'
import { useSubAgentEvents, consumeSubAgentEvent } from '../hooks/useAgentState'

interface SubAgentPanelProps {
  selectedDeptId: string | null
  activeChat: string
  onActiveChatChange: (chatId: string) => void
  onSubAgentsChange?: (deptId: string, subs: SubAgent[]) => void
}

export default function SubAgentPanel({
  selectedDeptId,
  activeChat,
  onActiveChatChange,
  onSubAgentsChange,
}: SubAgentPanelProps) {
  const [subAgents, setSubAgents] = useState<SubAgent[]>([])
  const [showNewSub, setShowNewSub] = useState(false)
  const [newSubName, setNewSubName] = useState('')
  const [newSubTask, setNewSubTask] = useState('')
  const [newSubSkills, setNewSubSkills] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { showToast } = useToast()
  const { t } = useLocale()
  const subAgentEvents = useSubAgentEvents()

  // Load sub-agents when department changes
  useEffect(() => {
    if (!selectedDeptId) {
      setSubAgents([])
      onActiveChatChange('main')
      setError(null)
      return
    }

    setIsLoading(true)
    setError(null)
    authedFetch(`/api/departments/${selectedDeptId}/subagents`)
      .then(res => res.json())
      .then(data => {
        const agents = data.agents || []
        setSubAgents(agents)
        onSubAgentsChange?.(selectedDeptId, agents)
        setIsLoading(false)
      })
      .catch((err) => {
        console.error('[SubAgent] Failed to load sub-agents:', err)
        setSubAgents([])
        onSubAgentsChange?.(selectedDeptId, [])
        setError(t('chat.subagent.load.error'))
        setIsLoading(false)
      })
  }, [selectedDeptId, onSubAgentsChange, onActiveChatChange, t])

  // Listen to WebSocket sub-agent events for real-time updates
  useEffect(() => {
    const event = consumeSubAgentEvent()
    if (!event || event.deptId !== selectedDeptId) return

    if (event.type === 'created') {
      const newSub: SubAgent = {
        id: event.subId,
        name: event.name || 'Sub-agent',
        task: event.task || '',
        status: event.status || 'active'
      }
      setSubAgents(prev => {
        const exists = prev.some(s => s.id === newSub.id)
        if (exists) return prev
        const next = [...prev, newSub]
        onSubAgentsChange?.(event.deptId, next)
        return next
      })
    } else if (event.type === 'removed') {
      setSubAgents(prev => {
        const next = prev.filter(s => s.id !== event.subId)
        onSubAgentsChange?.(event.deptId, next)
        return next
      })
      if (activeChat === event.subId) onActiveChatChange('main')
    }
  }, [subAgentEvents, selectedDeptId, onSubAgentsChange, activeChat, onActiveChatChange])

  const createSubAgent = async () => {
    if (!newSubTask.trim() || !selectedDeptId) return
    const agentName = newSubName.trim() || undefined
    setIsLoading(true)
    setError(null)
    try {
      const res = await authedFetch(`/api/departments/${selectedDeptId}/subagents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: newSubTask.trim(), name: agentName, ...(newSubSkills.trim() ? { skills: newSubSkills.split(',').map(s => s.trim()).filter(Boolean) } : {}) })
      })
      const data = await res.json()
      if (data.success) {
        // WebSocket event will update the list, but add immediately for better UX
        const newSub = { id: data.subId, name: data.name, task: newSubTask.trim(), status: 'active' }
        setSubAgents(prev => {
          const exists = prev.some(s => s.id === newSub.id)
          if (exists) return prev
          const next = [...prev, newSub]
          onSubAgentsChange?.(selectedDeptId!, next)
          return next
        })
        onActiveChatChange(data.subId)
        setNewSubName('')
        setNewSubTask('')
        setNewSubSkills('')
        setShowNewSub(false)
      } else {
        const errorMsg = data.error || t('chat.subagent.create.failed')
        console.error('[SubAgent] Failed to create sub-agent:', data.error)
        setError(errorMsg)
        showToast(errorMsg)
      }
    } catch (err) {
      const errorMsg = t('chat.subagent.create.error')
      console.error('[SubAgent] Network error creating sub-agent:', err)
      setError(errorMsg)
      showToast(errorMsg)
    } finally {
      setIsLoading(false)
    }
  }

  const removeSubAgentHandler = async (subId: string) => {
    if (!selectedDeptId) return
    setError(null)
    try {
      const res = await authedFetch(`/api/departments/${selectedDeptId}/subagents/${subId}`, { method: 'DELETE' })
      if (!res.ok) {
        const errorMsg = t('chat.subagent.delete.failed')
        console.error('[SubAgent] Failed to delete sub-agent:', res.status)
        setError(errorMsg)
        showToast(errorMsg)
        return
      }
      // WebSocket event will update the list, but remove immediately for better UX
      setSubAgents(prev => {
        const next = prev.filter(s => s.id !== subId)
        onSubAgentsChange?.(selectedDeptId!, next)
        return next
      })
      if (activeChat === subId) onActiveChatChange('main')
    } catch (err) {
      const errorMsg = t('chat.subagent.delete.error')
      console.error('[SubAgent] Network error deleting sub-agent:', err)
      setError(errorMsg)
      showToast(errorMsg)
    }
  }

  if (!selectedDeptId) return null

  return (
    <>
      {/* Error indicator */}
      {error && (
        <div className="sub-agent-error" style={{
          padding: '6px 12px',
          marginBottom: '8px',
          background: 'rgba(239, 68, 68, 0.1)',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          borderRadius: '4px',
          color: '#ef4444',
          fontSize: '12px'
        }}>
          {error}
        </div>
      )}

      {/* Sub-agent selector */}
      <div className="chat-agent-bar">
        <button
          className={`agent-chip ${activeChat === 'main' ? 'active' : ''}`}
          onClick={() => onActiveChatChange('main')}
          title={t('chat.agent.main')}
        >
          <span className="agent-chip-icon">●</span>
          <span className="agent-chip-label">{t('chat.agent.main')}</span>
        </button>
        {subAgents.map(sub => (
          <button
            key={sub.id}
            className={`agent-chip ${activeChat === sub.id ? 'active' : ''}`}
            onClick={() => onActiveChatChange(sub.id)}
            title={`${sub.name}: ${sub.task} (${sub.status})`}
          >
            <span className="agent-chip-icon" style={{
              opacity: sub.status === 'active' ? 1 : 0.5
            }}>
              {sub.name.charAt(0)}
            </span>
            <span className="agent-chip-label">{sub.name}</span>
            <span
              className="agent-chip-close"
              onClick={(e) => { e.stopPropagation(); removeSubAgentHandler(sub.id) }}
              title={t('chat.subagent.remove')}
            >x</span>
          </button>
        ))}
        <button
          className="agent-chip add-sub"
          onClick={() => setShowNewSub(!showNewSub)}
          disabled={isLoading}
        >
          {isLoading ? '...' : '+'}
        </button>
      </div>

      {/* New sub-agent form */}
      {showNewSub && (
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
          <input
            className="sub-skills-input"
            value={newSubSkills}
            onChange={e => setNewSubSkills(e.target.value)}
            placeholder={t('chat.subagent.skills.placeholder')}
          />
          <button onClick={createSubAgent} disabled={!newSubTask.trim() || isLoading}>
            {isLoading ? t('chat.subagent.creating') || '创建中...' : t('chat.subagent.create')}
          </button>
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
    </>
  )
}
