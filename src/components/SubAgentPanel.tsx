import { useState, useEffect } from 'react'
import type { SubAgent } from './ChatPanel'
import { useToast } from './Toast'
import { useLocale } from '../i18n/index'
import { authedFetch } from '../utils/api'

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

  const { showToast } = useToast()
  const { t } = useLocale()

  // Load sub-agents when department changes
  useEffect(() => {
    if (!selectedDeptId) {
      setSubAgents([])
      onActiveChatChange('main')
      return
    }

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
  }, [selectedDeptId, onSubAgentsChange, onActiveChatChange])

  const createSubAgent = async () => {
    if (!newSubTask.trim() || !selectedDeptId) return
    const agentName = newSubName.trim() || undefined
    try {
      const res = await authedFetch(`/api/departments/${selectedDeptId}/subagents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: newSubTask.trim(), name: agentName, ...(newSubSkills.trim() ? { skills: newSubSkills.split(',').map(s => s.trim()).filter(Boolean) } : {}) })
      })
      const data = await res.json()
      if (data.success) {
        const newSub = { id: data.subId, name: data.name, task: newSubTask.trim(), status: 'active' }
        setSubAgents(prev => {
          const next = [...prev, newSub]
          onSubAgentsChange?.(selectedDeptId!, next)
          return next
        })
        onActiveChatChange(data.subId)
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
    setNewSubSkills('')
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
      if (activeChat === subId) onActiveChatChange('main')
    } catch (err) {
      console.error('[SubAgent] Network error deleting sub-agent:', err)
      showToast(t('chat.subagent.delete.error'))
    }
  }

  if (!selectedDeptId) return null

  return (
    <>
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
    </>
  )
}
