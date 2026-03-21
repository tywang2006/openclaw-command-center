import { useEffect, useState, useCallback } from 'react'
import type { Department } from '../hooks/useAgentState'
import { MemoryIcon, DeptIcon } from './Icons'
import { useLocale } from '../i18n/index'
import { authedFetch } from '../utils/api'
import './MemoryTab.css'

interface SearchResult {
  deptId: string
  matches: { line: number; text: string }[]
}

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
  const [driveSaving, setDriveSaving] = useState(false)
  const [driveConfigured, setDriveConfigured] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [searchDone, setSearchDone] = useState(false)
  const [viewMode, setViewMode] = useState<'memory' | 'persona'>('memory')
  const [personaContent, setPersonaContent] = useState<string | null>(null)
  const [personaEdit, setPersonaEdit] = useState('')
  const [personaLoading, setPersonaLoading] = useState(false)
  const [editingPersona, setEditingPersona] = useState(false)
  const [personaSaving, setPersonaSaving] = useState(false)
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
    authedFetch(`/api/departments/${selectedDeptId}/memory`)
      .then(res => res.json())
      .then(data => {
        const content = data.content || ''
        setMemoryContent(content)
        setEditContent(content)
      })
      .catch((err) => {
        if (import.meta.env.DEV) console.warn('Fetch memory failed:', err);
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

  // Reset view mode when dept changes
  useEffect(() => {
    setViewMode('memory')
    setPersonaContent(null)
    setEditingPersona(false)
  }, [selectedDeptId])

  // Fetch persona when switching to persona view
  useEffect(() => {
    if (viewMode !== 'persona' || !selectedDeptId) return
    if (personaContent !== null) return
    setPersonaLoading(true)
    authedFetch(`/api/departments/${selectedDeptId}/persona`)
      .then(r => r.json())
      .then(d => {
        setPersonaContent(d.content || '')
        setPersonaEdit(d.content || '')
      })
      .catch((err) => {
        if (import.meta.env.DEV) console.warn('Fetch persona failed:', err);
        setPersonaContent('')
        setPersonaEdit('')
      })
      .finally(() => setPersonaLoading(false))
  }, [viewMode, selectedDeptId, personaContent])

  const handleSavePersona = useCallback(async () => {
    if (!selectedDeptId) return
    setPersonaSaving(true)
    try {
      const res = await authedFetch(`/api/departments/${selectedDeptId}/persona`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: personaEdit }),
      })
      const data = await res.json()
      if (data.success) {
        setPersonaContent(personaEdit)
        setEditingPersona(false)
        setSaveMsg(t('memory.saved'))
        setTimeout(() => setSaveMsg(null), 2000)
      }
    } catch {
      setSaveMsg(t('memory.save.failed'))
    }
    setPersonaSaving(false)
  }, [selectedDeptId, personaEdit, t])

  // Check drive status
  useEffect(() => {
    authedFetch('/api/drive/status').then(r => r.json()).then(d => setDriveConfigured(d.configured && d.enabled)).catch((err) => {
      if (import.meta.env.DEV) console.warn('Fetch drive status failed:', err);
    })
  }, [])

  const handleSearch = useCallback(async () => {
    if (searchQuery.trim().length < 2) return
    setSearching(true)
    setSearchDone(false)
    try {
      const res = await authedFetch(`/api/search?q=${encodeURIComponent(searchQuery.trim())}&scope=memory`)
      const data = await res.json()
      setSearchResults(data.results || [])
    } catch {
      setSearchResults([])
    }
    setSearching(false)
    setSearchDone(true)
  }, [searchQuery])

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
      const res = await authedFetch(`/api/departments/${selectedDeptId}/memory`, {
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
      const res = await authedFetch(`/api/departments/${selectedDeptId}/memory/history`)
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
      const res = await authedFetch(`/api/departments/${selectedDeptId}/memory/history/${filename}`)
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
      const res = await authedFetch(`/api/departments/${selectedDeptId}/memory`, {
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

  const handleSaveToDrive = useCallback(async () => {
    if (!selectedDeptId) return
    setDriveSaving(true)
    try {
      const res = await authedFetch('/api/drive/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: `${selectedDeptId}-memory-${new Date().toISOString().split('T')[0]}.md`,
          content: memoryContent || '',
          mimeType: 'text/markdown',
        }),
      })
      const data = await res.json()
      if (data.success) {
        setSaveMsg(t('drive.saved'))
        setTimeout(() => setSaveMsg(null), 2000)
      } else {
        setSaveMsg(t('drive.failed', { error: data.error || '' }))
      }
    } catch {
      setSaveMsg(t('drive.failed', { error: t('common.networkError') }))
    }
    setDriveSaving(false)
  }, [selectedDeptId, memoryContent, t])

  if (!selectedDeptId) {
    return (
      <div className="memory-tab empty">
        <div className="memory-search-bar">
          <input
            className="memory-search-input"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSearch() }}
            placeholder={t('memory.search.placeholder')}
            aria-label="搜索记忆"
          />
          <button className="mem-btn" onClick={handleSearch} disabled={searching || searchQuery.trim().length < 2} aria-label="搜索">
            {searching ? '...' : (
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.3" />
                <path d="M11 11l4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
            )}
          </button>
        </div>
        {searchDone && searchResults.length > 0 ? (
          <div className="memory-search-results">
            <p className="memory-search-count">{t('memory.search.results', { count: searchResults.length })}</p>
            {searchResults.map(r => (
              <div key={r.deptId} className="memory-search-dept">
                <div className="memory-search-dept-header">
                  <DeptIcon deptId={r.deptId} size={14} />
                  <span>{departments.find(d => d.id === r.deptId)?.name || r.deptId}</span>
                </div>
                {r.matches.map((m, i) => (
                  <div key={`${r.deptId}-match-${m.line}-${i}`} className="memory-search-match">
                    <span className="memory-search-line">{t('memory.search.line', { line: m.line })}</span>
                    <span className="memory-search-text">{m.text}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        ) : searchDone ? (
          <div className="empty-message">
            <p>{t('memory.search.no.results')}</p>
          </div>
        ) : (
          <div className="empty-message">
            <div className="empty-icon"><MemoryIcon size={32} color="#a0a0b0" /></div>
            <p>{t('memory.empty.icon')}</p>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="memory-tab">
      <div className="memory-header">
        <DeptIcon deptId={selectedDeptId} size={18} />
        <h2>{selectedDept?.name || selectedDeptId}</h2>
        <div className="memory-mode-toggle">
          <button className={`mode-btn ${viewMode === 'memory' ? 'active' : ''}`} onClick={() => setViewMode('memory')}>{t('memory.mode.memory')}</button>
          <button className={`mode-btn ${viewMode === 'persona' ? 'active' : ''}`} onClick={() => setViewMode('persona')}>{t('memory.mode.persona')}</button>
        </div>
        <div className="memory-actions">
          {viewMode === 'persona' ? (
            !editingPersona ? (
              <button className="mem-btn" onClick={() => { setEditingPersona(true); setPersonaEdit(personaContent || '') }} title={t('memory.edit')} aria-label="编辑">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <path d="M11.5 1.5l3 3L5 14H2v-3L11.5 1.5z" stroke="currentColor" strokeWidth="1.3" />
                </svg>
              </button>
            ) : (
              <>
                <button className="mem-btn save" onClick={handleSavePersona} disabled={personaSaving}>
                  {personaSaving ? '...' : t('memory.save')}
                </button>
                <button className="mem-btn cancel" onClick={() => { setEditingPersona(false); setPersonaEdit(personaContent || '') }}>
                  {t('memory.cancel')}
                </button>
              </>
            )
          ) : !editing ? (
            <>
              {driveConfigured && (
                <button className="mem-btn" onClick={handleSaveToDrive} disabled={driveSaving} title={t('drive.save')} aria-label="保存到云盘">
                  {driveSaving ? t('drive.saving') : (
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                      <path d="M8 1v10M4 8l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M2 12v2h12v-2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  )}
                </button>
              )}
              <button className="mem-btn" onClick={() => { setShowHistory(!showHistory); if (!showHistory) fetchHistory() }} title={t('memory.history')} aria-label="查看历史">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.3" />
                  <path d="M8 4v4l2 2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                  <path d="M3 8h1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                </svg>
              </button>
              <button className="mem-btn" onClick={handleEdit} title={t('memory.edit')} aria-label="编辑">
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
            <button className="mem-btn" onClick={() => { setShowHistory(false); setSelectedVersion(null); setVersionContent(null) }} aria-label="关闭">{t('common.close')}</button>
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
      {viewMode === 'persona' ? (
        personaLoading ? (
          <div className="empty-message"><p>{t('memory.loading')}</p></div>
        ) : editingPersona ? (
          <textarea
            className="memory-editor"
            value={personaEdit}
            onChange={e => setPersonaEdit(e.target.value)}
            spellCheck={false}
            autoFocus
          />
        ) : personaContent ? (
          <pre className="memory-content">{personaContent}</pre>
        ) : (
          <div className="empty-message"><p>{t('memory.persona.empty')}</p></div>
        )
      ) : loading ? (
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
