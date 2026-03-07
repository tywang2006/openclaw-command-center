import { useEffect, useState, useCallback } from 'react'
import type { Department } from '../hooks/useAgentState'
import { MemoryIcon, DeptIcon } from './Icons'
import { useLocale } from '../i18n/index'
import { authedFetch } from '../utils/api'
import './MemoryTab.css'

interface MemoryTabProps {
  selectedDeptId: string | null
  memories: Map<string, string>
  departments: Department[]
}

export default function MemoryTab({ selectedDeptId, memories, departments }: MemoryTabProps) {
  const [memoryContent, setMemoryContent] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [versions, setVersions] = useState<{ filename: string; timestamp: string; size: number }[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [selectedVersion, setSelectedVersion] = useState<string | null>(null)
  const [versionContent, setVersionContent] = useState<string | null>(null)
  const [versionLoading, setVersionLoading] = useState(false)
  const { t } = useLocale()

  const selectedDept = departments.find(d => d.id === selectedDeptId)

  // Fetch memory from API when department changes
  useEffect(() => {
    if (!selectedDeptId) {
      setMemoryContent(null)
      setEditing(false)
      return
    }

    const cached = memories.get(selectedDeptId)
    if (cached) {
      setMemoryContent(cached)
      setEditContent(cached)
      return
    }

    setLoading(true)
    authedFetch(`/cmd/api/departments/${selectedDeptId}/memory`)
      .then(res => res.json())
      .then(data => {
        const content = data.content || ''
        setMemoryContent(content)
        setEditContent(content)
      })
      .catch(() => {
        setMemoryContent('')
        setEditContent('')
      })
      .finally(() => setLoading(false))
  }, [selectedDeptId, memories])

  // Reset editing when dept changes
  useEffect(() => {
    setEditing(false)
    setSaveMsg(null)
    setShowHistory(false)
    setVersions([])
    setSelectedVersion(null)
    setVersionContent(null)
  }, [selectedDeptId])

  const handleEdit = useCallback(() => {
    setEditing(true)
    setEditContent(memoryContent || '')
    setSaveMsg(null)
  }, [memoryContent])

  const handleCancel = useCallback(() => {
    setEditing(false)
    setEditContent(memoryContent || '')
    setSaveMsg(null)
  }, [memoryContent])

  const handleSave = useCallback(async () => {
    if (!selectedDeptId) return
    setSaving(true)
    setSaveMsg(null)
    try {
      const res = await authedFetch(`/cmd/api/departments/${selectedDeptId}/memory`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: editContent }),
      })
      const data = await res.json()
      if (data.success) {
        setMemoryContent(editContent)
        setEditing(false)
        setSaveMsg(t('memory.saved'))
        setTimeout(() => setSaveMsg(null), 2000)
      } else {
        setSaveMsg(t('memory.save.failed'))
      }
    } catch {
      setSaveMsg(t('memory.save.failed'))
    } finally {
      setSaving(false)
    }
  }, [selectedDeptId, editContent, t])

  const fetchHistory = useCallback(async () => {
    if (!selectedDeptId) return
    setHistoryLoading(true)
    try {
      const res = await authedFetch(`/cmd/api/departments/${selectedDeptId}/memory/history`)
      const data = await res.json()
      setVersions(data.versions || [])
    } catch {
      setVersions([])
    }
    setHistoryLoading(false)
  }, [selectedDeptId])

  const fetchVersionContent = useCallback(async (filename: string) => {
    if (!selectedDeptId) return
    setVersionLoading(true)
    setSelectedVersion(filename)
    try {
      const res = await authedFetch(`/cmd/api/departments/${selectedDeptId}/memory/history/${filename}`)
      const data = await res.json()
      setVersionContent(data.content || '')
    } catch {
      setVersionContent('')
    }
    setVersionLoading(false)
  }, [selectedDeptId])

  const restoreVersion = useCallback(async () => {
    if (!selectedDeptId || !versionContent) return
    setSaving(true)
    try {
      const res = await authedFetch(`/cmd/api/departments/${selectedDeptId}/memory`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: versionContent }),
      })
      const data = await res.json()
      if (data.success) {
        setMemoryContent(versionContent)
        setEditContent(versionContent)
        setShowHistory(false)
        setSelectedVersion(null)
        setVersionContent(null)
        setSaveMsg(t('memory.history.restored'))
        setTimeout(() => setSaveMsg(null), 2000)
      }
    } catch {
      setSaveMsg(t('memory.save.failed'))
    }
    setSaving(false)
  }, [selectedDeptId, versionContent, t])

  if (!selectedDeptId) {
    return (
      <div className="memory-tab empty">
        <div className="empty-message">
          <div className="empty-icon"><MemoryIcon size={32} color="#a0a0b0" /></div>
          <p>{t('memory.empty.icon')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="memory-tab">
      <div className="memory-header">
        <DeptIcon deptId={selectedDeptId} size={18} />
        <h2>{selectedDept?.name || selectedDeptId}</h2>
        <div className="memory-actions">
          {!editing ? (
            <>
              <button className="mem-btn" onClick={() => { setShowHistory(!showHistory); if (!showHistory) fetchHistory() }} title={t('memory.history')}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.3" />
                  <path d="M8 4v4l2 2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                  <path d="M3 8h1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                </svg>
              </button>
              <button className="mem-btn" onClick={handleEdit} title={t('memory.edit')}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <path d="M11.5 1.5l3 3L5 14H2v-3L11.5 1.5z" stroke="currentColor" strokeWidth="1.3" />
                </svg>
              </button>
            </>
          ) : (
            <>
              <button className="mem-btn save" onClick={handleSave} disabled={saving}>
                {saving ? '...' : t('memory.save')}
              </button>
              <button className="mem-btn cancel" onClick={handleCancel} disabled={saving}>
                {t('memory.cancel')}
              </button>
            </>
          )}
          {saveMsg && <span className="save-msg">{saveMsg}</span>}
        </div>
      </div>
      {showHistory && (
        <div className="memory-history-panel">
          <div className="memory-history-header">
            <h3>{t('memory.history.title')}</h3>
            <button className="mem-btn" onClick={() => { setShowHistory(false); setSelectedVersion(null); setVersionContent(null) }}>{t('common.close')}</button>
          </div>
          {historyLoading ? (
            <p className="memory-history-loading">{t('memory.history.loading')}</p>
          ) : versions.length === 0 ? (
            <p className="memory-history-empty">{t('memory.history.empty')}</p>
          ) : (
            <div className="memory-history-list">
              {versions.map(v => (
                <button
                  key={v.filename}
                  className={`memory-history-item ${selectedVersion === v.filename ? 'active' : ''}`}
                  onClick={() => fetchVersionContent(v.filename)}
                >
                  <span className="history-item-time">{new Date(v.timestamp).toLocaleString()}</span>
                  <span className="history-item-size">{Math.round(v.size / 1024)}KB</span>
                </button>
              ))}
            </div>
          )}
          {selectedVersion && (
            <div className="memory-version-preview">
              {versionLoading ? (
                <p>{t('memory.history.loading')}</p>
              ) : (
                <>
                  <pre className="memory-version-content">{versionContent}</pre>
                  <button className="mem-btn save" onClick={restoreVersion} disabled={saving}>
                    {t('memory.history.restore')}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}
      {loading ? (
        <div className="empty-message"><p>{t('memory.loading')}</p></div>
      ) : editing ? (
        <textarea
          className="memory-editor"
          value={editContent}
          onChange={e => setEditContent(e.target.value)}
          spellCheck={false}
          autoFocus
        />
      ) : memoryContent ? (
        <pre className="memory-content">{memoryContent}</pre>
      ) : (
        <div className="empty-message"><p>{t('memory.empty')}</p></div>
      )}
    </div>
  )
}
