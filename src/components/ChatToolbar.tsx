import { useState, useEffect } from 'react'
import type { Department } from '../hooks/useAgentState'
import type { SubAgent } from './ChatPanel'
import { DeptIcon } from './Icons'
import { useLocale } from '../i18n/index'
import { useToast } from './Toast'
import { authedFetch } from '../utils/api'

interface ChatToolbarProps {
  selectedDeptId: string | null
  dept: Department | undefined
  departments: Department[]
  activeChat: string
  subAgents: SubAgent[]
  showToolbar: boolean
  fileInputRef: React.RefObject<HTMLInputElement | null>
  docInputRef: React.RefObject<HTMLInputElement | null>
  onShowToolbar: (show: boolean) => void
  onShowEmailForm: (show: boolean) => void
  onShowSkillPicker: (show: boolean) => void
  onShowWorkflow: (show: boolean) => void
  onShowTimerForm: (show: boolean) => void
  showEmailForm?: boolean
}

export default function ChatToolbar({
  selectedDeptId,
  dept,
  departments,
  activeChat,
  subAgents,
  showToolbar,
  fileInputRef,
  docInputRef,
  onShowToolbar,
  onShowEmailForm,
  onShowSkillPicker,
  onShowWorkflow,
  onShowTimerForm,
}: ChatToolbarProps) {
  const { t } = useLocale()
  const { showToast } = useToast()
  const [showExportMenu, setShowExportMenu] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [emailConfigured, setEmailConfigured] = useState(false)
  const [driveConfigured, setDriveConfigured] = useState(false)
  const [showPersona, setShowPersona] = useState(false)
  const [personaContent, setPersonaContent] = useState<string | null>(null)
  const [personaLoading, setPersonaLoading] = useState(false)
  const [showDailyLog, setShowDailyLog] = useState(false)
  const [dailyDates, setDailyDates] = useState<string[]>([])
  const [selectedDate, setSelectedDate] = useState('')
  const [dailyContent, setDailyContent] = useState<string | null>(null)
  const [dailyLoading, setDailyLoading] = useState(false)

  // Check email and drive status
  useEffect(() => {
    authedFetch('/api/email/status').then(r => r.json()).then(d => setEmailConfigured(d.configured && d.enabled)).catch(() => {})
    authedFetch('/api/drive/status').then(r => r.json()).then(d => setDriveConfigured(d.configured && d.enabled)).catch(() => {})
  }, [])

  // Reset persona and daily log states when department changes
  useEffect(() => {
    setShowPersona(false)
    setPersonaContent(null)
    setShowDailyLog(false)
    setDailyDates([])
    setDailyContent(null)
    setSelectedDate('')
  }, [selectedDeptId])

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
          to: '',
          subject: t('email.default.subject', {
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

  return (
    <>
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

      {/* Bottom toolbar (collapsible) */}
      {showToolbar && selectedDeptId && (
        <div className="chat-toolbar">
          <button
            className="chat-toolbar-btn"
            onClick={() => { fileInputRef.current?.click(); onShowToolbar(false) }}
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
            onClick={() => { docInputRef.current?.click(); onShowToolbar(false) }}
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
            onClick={() => { onShowEmailForm(true); onShowToolbar(false) }}
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
              onShowToolbar(false)
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
            onClick={() => { onShowTimerForm(true); onShowToolbar(false) }}
          >
            <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" />
              <path d="M8 4v4l3 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <span>{t('chat.toolbar.timer')}</span>
          </button>
          <button
            className="chat-toolbar-btn"
            onClick={() => { onShowSkillPicker(true); onShowToolbar(false) }}
          >
            <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
              <path d="M8 1l2 4h4l-3 3 1 4-4-2-4 2 1-4-3-3h4z" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinejoin="round" />
            </svg>
            <span>{t('chat.toolbar.skills')}</span>
          </button>
          <button
            className="chat-toolbar-btn"
            onClick={() => { onShowWorkflow(true); onShowToolbar(false) }}
          >
            <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
              <path d="M2 3h5v3H2zM9 3h5v3H9zM5.5 10h5v3h-5z" stroke="currentColor" strokeWidth="1.3" fill="none" />
              <path d="M4.5 6v2h3.5v2M11.5 6v2H8v2" stroke="currentColor" strokeWidth="1.3" />
            </svg>
            <span>{t('chat.toolbar.workflow')}</span>
          </button>
        </div>
      )}
    </>
  )
}
