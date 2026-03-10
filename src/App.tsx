import { useEffect, useState, useCallback, useMemo, Component, type ReactNode, type ErrorInfo } from 'react'
import { useAgentState } from './hooks/useAgentState'
import { useLocale } from './i18n/index'
import { useMobile, useSwipeGesture } from './hooks/useMobile'
import { getToken, clearToken, setOnUnauthorized, authedFetch } from './utils/api'
import { getNotificationPrefs, saveNotificationPrefs, requestPermission } from './utils/notifications'
import LoginPanel from './components/LoginPanel'
import DeptFormModal from './components/DeptFormModal'

class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error?: Error }> {
  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { hasError: false }
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info)
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 40, textAlign: 'center', color: '#ff5555', fontFamily: 'monospace' }}>
          <h2>Something went wrong</h2>
          <p style={{ color: '#888' }}>{this.state.error?.message}</p>
          <button onClick={() => this.setState({ hasError: false })} style={{
            marginTop: 16, padding: '8px 24px', background: '#00d4aa', border: 'none', color: '#000', cursor: 'pointer', borderRadius: '4px', fontWeight: 600
          }}>
            Retry
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

function Clock({ locale }: { locale: string }) {
  const [time, setTime] = useState(new Date())
  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])
  return <div className="current-time">{time.toLocaleTimeString(locale === 'zh' ? 'zh-CN' : 'en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}</div>
}
import OfficeCanvas from './components/OfficeCanvas'
import ChatPanel, { type SubAgent } from './components/ChatPanel'
import BulletinTab from './components/BulletinTab'
import MemoryTab from './components/MemoryTab'
import ActivityTab from './components/ActivityTab'
import CronTab from './components/CronTab'
// SkillsTab merged into IntegrationsTab (Capabilities Dashboard)
import DashboardTab from './components/DashboardTab'
import IntegrationsTab from './components/IntegrationsTab'
import StatusBar from './components/StatusBar'
import MobileNav from './components/MobileNav'
import MobileDrawer from './components/MobileDrawer'
import { BulletinIcon, MemoryIcon, ActivityIcon } from './components/Icons'
import './App.css'

type RightTab = 'chat' | 'bulletin' | 'memory' | 'activity' | 'cron' | 'dashboard' | 'integrations'

export default function App() {
  const { t, locale, setLocale } = useLocale()
  const [authToken, setAuthToken] = useState<string | null>(getToken())

  // Register 401 handler
  useEffect(() => {
    setOnUnauthorized(() => setAuthToken(null))
  }, [])

  const handleLogout = () => {
    clearToken()
    setAuthToken(null)
  }

  if (!authToken) {
    return <LoginPanel onLogin={(token) => setAuthToken(token)} />
  }

  return (
    <ErrorBoundary>
      <AuthenticatedApp t={t} locale={locale} setLocale={setLocale} onLogout={handleLogout} />
    </ErrorBoundary>
  )
}

function AuthenticatedApp({ t, locale, setLocale, onLogout }: {
  t: (key: string, params?: Record<string, string | number>) => string
  locale: string
  setLocale: (l: 'zh' | 'en') => void
  onLogout: () => void
}) {
  const agentState = useAgentState()
  const isMobile = useMobile()
  const [rightTab, setRightTab] = useState<RightTab>('chat')
  const [panelCollapsed, setPanelCollapsed] = useState(false)
  const [subAgentsByDept, setSubAgentsByDept] = useState<Record<string, SubAgent[]>>({})
  const [showDeptPicker, setShowDeptPicker] = useState(false)
  const [chatPrefill, setChatPrefill] = useState<string | null>(null)
  const [showDeptForm, setShowDeptForm] = useState(false)
  const [editDeptData, setEditDeptData] = useState<{ id: string; name: string; agent?: string; icon: string; color: string; hue: number; telegramTopicId?: number; order: number } | null>(null)
  const [deleteDeptId, setDeleteDeptId] = useState<string | null>(null)

  const handleEditDept = useCallback((dept: any) => {
    setEditDeptData({
      id: dept.id,
      name: dept.name,
      agent: dept.agent,
      icon: dept.icon || 'bolt',
      color: dept.color || '#94a3b8',
      hue: dept.hue ?? 200,
      telegramTopicId: dept.telegramTopicId,
      order: dept.order ?? 0,
    })
    setShowDeptForm(true)
  }, [])

  const handleDeleteDept = useCallback(async () => {
    if (!deleteDeptId) return
    try {
      const res = await authedFetch(`/api/departments/${deleteDeptId}`, { method: 'DELETE' })
      const data = await res.json()
      if (data.success) {
        if (agentState.selectedDeptId === deleteDeptId) {
          agentState.setSelectedDeptId(null)
        }
      }
    } catch (err) {
      console.error('Failed to delete department:', err)
    }
    setDeleteDeptId(null)
  }, [deleteDeptId, agentState])

  const handleCloseDeptForm = useCallback(() => {
    setShowDeptForm(false)
    setEditDeptData(null)
  }, [])

  const handleSwitchToChat = useCallback((deptId: string, prefillMessage: string) => {
    agentState.setSelectedDeptId(deptId)
    setChatPrefill(prefillMessage)
    setRightTab('chat')
  }, [agentState])

  // Swipe to switch departments on mobile
  const swipeToDept = useCallback((direction: 'next' | 'prev') => {
    if (!isMobile || agentState.departments.length === 0) return
    const depts = agentState.departments
    const currentIdx = depts.findIndex(d => d.id === agentState.selectedDeptId)
    if (direction === 'next') {
      const nextIdx = currentIdx < depts.length - 1 ? currentIdx + 1 : 0
      agentState.setSelectedDeptId(depts[nextIdx].id)
    } else {
      const prevIdx = currentIdx > 0 ? currentIdx - 1 : depts.length - 1
      agentState.setSelectedDeptId(depts[prevIdx].id)
    }
  }, [isMobile, agentState.departments, agentState.selectedDeptId])

  const { handleTouchStart, handleTouchEnd } = useSwipeGesture(
    () => swipeToDept('next'),
    () => swipeToDept('prev')
  )

  // Fullscreen
  const [isFullscreen, setIsFullscreen] = useState(false)
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [])
  const toggleFullscreen = () => {
    if (document.fullscreenElement) { document.exitFullscreen() }
    else { document.documentElement.requestFullscreen() }
  }

  // Gateway stats
  const [gatewayStats, setGatewayStats] = useState<{ connected?: boolean; latencyMs?: number; pendingRequests?: number; uptime?: number; streamBuffers?: number } | null>(null)
  useEffect(() => {
    const poll = () => authedFetch('/api/gateway/stats').then(r => r.json()).then(d => setGatewayStats(d.gateway || d)).catch(() => {})
    poll()
    const timer = setInterval(poll, 30000)
    return () => clearInterval(timer)
  }, [])

  // Notification preferences
  const [notifyPrefs, setNotifyPrefs] = useState(getNotificationPrefs())
  const [showNotifyDropdown, setShowNotifyDropdown] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const toggleNotifyPref = async (key: 'errors' | 'gateway' | 'slow') => {
    const newPrefs = { ...notifyPrefs, [key]: !notifyPrefs[key] }
    setNotifyPrefs(newPrefs)
    saveNotificationPrefs(newPrefs)
  }

  const toggleNotifications = async () => {
    if (!notifyPrefs.enabled) {
      const granted = await requestPermission()
      if (!granted) return
    }
    const newPrefs = { ...notifyPrefs, enabled: !notifyPrefs.enabled }
    setNotifyPrefs(newPrefs)
    saveNotificationPrefs(newPrefs)
  }

  const RIGHT_TABS = useMemo(() => [
    { id: 'chat' as RightTab, label: t('app.tab.chat'), Icon: ({ size = 14, color = '#a0a0b0' }) => (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
        <path d="M2 2h12v9H5l-3 3V2z" stroke={color} strokeWidth="1.5" fill="none" />
      </svg>
    )},
    { id: 'bulletin' as RightTab, label: t('app.tab.bulletin'), Icon: BulletinIcon },
    { id: 'memory' as RightTab, label: t('app.tab.memory'), Icon: MemoryIcon },
    { id: 'activity' as RightTab, label: t('app.tab.activity'), Icon: ActivityIcon },
    { id: 'cron' as RightTab, label: t('app.tab.cron'), Icon: ({ size = 14, color = '#a0a0b0' }: { size?: number; color?: string }) => (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="6.5" stroke={color} strokeWidth="1.5" />
        <path d="M8 4v4l3 2" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    )},
    { id: 'dashboard' as RightTab, label: t('app.tab.dashboard'), Icon: ({ size = 14, color = '#a0a0b0' }: { size?: number; color?: string }) => (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
        <rect x="1" y="8" width="3" height="7" stroke={color} strokeWidth="1.3" fill="none" />
        <rect x="6" y="4" width="3" height="11" stroke={color} strokeWidth="1.3" fill="none" />
        <rect x="11" y="1" width="3" height="14" stroke={color} strokeWidth="1.3" fill="none" />
      </svg>
    )},
    { id: 'integrations' as RightTab, label: t('app.tab.integrations'), Icon: ({ size = 14, color = '#a0a0b0' }: { size?: number; color?: string }) => (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
        <circle cx="5" cy="8" r="3" stroke={color} strokeWidth="1.3" fill="none" />
        <circle cx="12" cy="5" r="2" stroke={color} strokeWidth="1.3" fill="none" />
        <circle cx="12" cy="11" r="2" stroke={color} strokeWidth="1.3" fill="none" />
        <path d="M7.5 6.5l3-1M7.5 9.5l3 1" stroke={color} strokeWidth="1.3" />
      </svg>
    )},
  ], [t])

  const handleSubAgentsChange = (deptId: string, subs: SubAgent[]) => {
    setSubAgentsByDept(prev => ({ ...prev, [deptId]: subs }))
  }

  // Load subagents for ALL departments on startup
  const [subAgentsLoaded, setSubAgentsLoaded] = useState(false)
  useEffect(() => {
    if (agentState.departments.length > 0 && !subAgentsLoaded) {
      setSubAgentsLoaded(true)
      Promise.all(
        agentState.departments.map(dept =>
          authedFetch(`/api/departments/${dept.id}/subagents`)
            .then(res => res.json())
            .then(data => ({ deptId: dept.id, agents: (data.agents || []) as SubAgent[] }))
            .catch(() => ({ deptId: dept.id, agents: [] as SubAgent[] }))
        )
      ).then(results => {
        const allSubs: Record<string, SubAgent[]> = {}
        for (const r of results) {
          if (r.agents.length > 0) {
            allSubs[r.deptId] = r.agents
          }
        }
        setSubAgentsByDept(allSubs)
      })
    }
  }, [agentState.departments.length])

  const tabContent = (
    <>
      {rightTab === 'chat' && (
        <ChatPanel
          selectedDeptId={agentState.selectedDeptId}
          departments={agentState.departments}
          activities={agentState.activities}
          addActivity={agentState.addActivity}
          onSubAgentsChange={handleSubAgentsChange}
          streamingTexts={agentState.streamingTexts}
          prefillMessage={chatPrefill}
          onPrefillConsumed={() => setChatPrefill(null)}
        />
      )}
      {rightTab === 'bulletin' && (
        <BulletinTab bulletin={agentState.bulletin} />
      )}
      {rightTab === 'memory' && (
        <MemoryTab
          selectedDeptId={agentState.selectedDeptId}
          memories={agentState.memories}
          departments={agentState.departments}
        />
      )}
      {rightTab === 'activity' && (
        <ActivityTab
          activities={agentState.activities}
          departments={agentState.departments}
          addActivity={agentState.addActivity}
        />
      )}
      {rightTab === 'cron' && <CronTab departments={agentState.departments} selectedDeptId={agentState.selectedDeptId} />}
      {rightTab === 'dashboard' && <DashboardTab departments={agentState.departments} />}
      {rightTab === 'integrations' && <IntegrationsTab onSwitchToChat={handleSwitchToChat} />}
    </>
  )

  // ---- Mobile Layout ----
  if (isMobile) {
    return (
      <div className="app mobile" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
        <header className="mobile-topbar">
          <button className="mobile-hamburger" onClick={() => setDrawerOpen(true)}>
            <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
              <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
          <h1 className="mobile-topbar-title">{t('app.title')}</h1>
          <div className="mobile-topbar-status">
            <span className={`status-dot ${agentState.connected ? 'connected' : 'disconnected'}`}></span>
          </div>
        </header>

        <MobileDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          locale={locale}
          onToggleLocale={() => setLocale(locale === 'zh' ? 'en' : 'zh')}
          onToggleFullscreen={toggleFullscreen}
          isFullscreen={isFullscreen}
          onLogout={onLogout}
          notifyPrefs={notifyPrefs}
          onToggleNotifications={toggleNotifications}
          onToggleNotifyPref={toggleNotifyPref}
          t={t}
        />

        <div className="mobile-content">
          {tabContent}
        </div>

        <MobileNav
          activeTab={rightTab}
          onTabChange={setRightTab}
          departments={agentState.departments}
          selectedDeptId={agentState.selectedDeptId}
          onSelectDept={agentState.setSelectedDeptId}
          showDeptPicker={showDeptPicker}
          onToggleDeptPicker={() => setShowDeptPicker(!showDeptPicker)}
        />
      </div>
    )
  }

  // ---- Desktop Layout ----
  return (
    <div className="app">
      <header className="header">
        <div className="header-title">
          <h1>{t('app.title')}</h1>
        </div>
        <div className="header-status">
          <div className="notify-wrapper">
            <button
              className={`notify-btn ${notifyPrefs.enabled ? 'active' : ''}`}
              onClick={() => setShowNotifyDropdown(!showNotifyDropdown)}
              title={t('notify.title')}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M8 1.5a4 4 0 0 0-4 4v3l-1.5 2h11L12 8.5v-3a4 4 0 0 0-4-4z" stroke="currentColor" strokeWidth="1.3" />
                <path d="M6 13.5a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.3" />
              </svg>
            </button>
            {showNotifyDropdown && (
              <div className="notify-dropdown">
                <label className="notify-option main">
                  <input type="checkbox" checked={notifyPrefs.enabled} onChange={toggleNotifications} />
                  <span>{t('notify.enable')}</span>
                </label>
                <label className="notify-option">
                  <input type="checkbox" checked={notifyPrefs.errors} onChange={() => toggleNotifyPref('errors')} disabled={!notifyPrefs.enabled} />
                  <span>{t('notify.errors')}</span>
                </label>
                <label className="notify-option">
                  <input type="checkbox" checked={notifyPrefs.gateway} onChange={() => toggleNotifyPref('gateway')} disabled={!notifyPrefs.enabled} />
                  <span>{t('notify.gateway')}</span>
                </label>
                <label className="notify-option">
                  <input type="checkbox" checked={notifyPrefs.slow} onChange={() => toggleNotifyPref('slow')} disabled={!notifyPrefs.enabled} />
                  <span>{t('notify.slow')}</span>
                </label>
              </div>
            )}
          </div>
          <button
            className="locale-toggle"
            onClick={() => setLocale(locale === 'zh' ? 'en' : 'zh')}
            title="Toggle language"
          >
            {locale === 'zh' ? 'EN' : '中'}
          </button>
          <button className="fullscreen-btn" onClick={toggleFullscreen} title={isFullscreen ? t('app.fullscreen.exit') : t('app.fullscreen.enter')}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              {isFullscreen ? (
                <path d="M5 1v4H1M11 1v4h4M5 15v-4H1M11 15v-4h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              ) : (
                <path d="M1 5V1h4M15 5V1h-4M1 11v4h4M15 11v4h-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              )}
            </svg>
          </button>
          <button className="logout-btn" onClick={onLogout} title="Logout">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M6 2H3v12h3M11 4l4 4-4 4M7 8h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <div className="gateway-status" title={gatewayStats ? `GW: ${gatewayStats.connected ? 'Connected' : 'Disconnected'}\nLatency: ${gatewayStats.latencyMs ?? '?'}ms\nPending: ${gatewayStats.pendingRequests ?? 0}\nStreams: ${gatewayStats.streamBuffers ?? 0}` : 'Gateway: unknown'}>
            <span className={`status-dot ${gatewayStats?.connected ? 'connected' : 'disconnected'}`}></span>
            <span>GW</span>
          </div>
          <div className="connection-status">
            <span className={`status-dot ${agentState.connected ? 'connected' : 'disconnected'}`}></span>
            <span>{agentState.connected ? t('app.status.online') : t('app.status.offline')}</span>
          </div>
          <Clock locale={locale} />
        </div>
      </header>

      <div className="main-content">
        <div className="left-panel">
          <OfficeCanvas
            departments={agentState.departments}
            selectedDeptId={agentState.selectedDeptId}
            onSelectDept={agentState.setSelectedDeptId}
            subAgents={subAgentsByDept}
            toolStates={agentState.toolStates}
          />
        </div>
        <button className="panel-toggle" onClick={() => setPanelCollapsed(!panelCollapsed)} title={panelCollapsed ? t('app.panel.expand') : t('app.panel.collapse')}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d={panelCollapsed ? 'M4 1l5 5-5 5' : 'M8 1l-5 5 5 5'} stroke="#a0a0b0" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className={`right-panel ${panelCollapsed ? 'collapsed' : ''}`}>
          <div className="right-tab-header">
            {RIGHT_TABS.map(tab => (
              <button
                key={tab.id}
                className={`right-tab ${rightTab === tab.id ? 'active' : ''}`}
                onClick={() => setRightTab(tab.id)}
              >
                <tab.Icon size={14} color={rightTab === tab.id ? '#00d4aa' : '#a0a0b0'} />
                <span>{tab.label}</span>
              </button>
            ))}
          </div>
          <div className="right-tab-content">
            {tabContent}
          </div>
        </div>
      </div>

      <StatusBar
        departments={agentState.departments}
        selectedDeptId={agentState.selectedDeptId}
        onSelectDept={agentState.setSelectedDeptId}
        onAddDept={() => { setEditDeptData(null); setShowDeptForm(true) }}
        onEditDept={handleEditDept}
        onDeleteDept={(id) => setDeleteDeptId(id)}
      />
      <DeptFormModal open={showDeptForm} onClose={handleCloseDeptForm} editDept={editDeptData} />

      {deleteDeptId && (
        <div className="dept-modal-overlay" onClick={() => setDeleteDeptId(null)}>
          <div className="dept-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 360 }}>
            <div className="dept-modal-header">
              <h3>{t('dept.delete')}</h3>
              <button className="dept-modal-close" onClick={() => setDeleteDeptId(null)}>&times;</button>
            </div>
            <div className="dept-modal-body">
              <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                {t('dept.delete.confirm', { id: deleteDeptId })}
              </p>
            </div>
            <div className="dept-modal-footer">
              <button className="dept-btn-cancel" onClick={() => setDeleteDeptId(null)}>{t('common.cancel')}</button>
              <button className="dept-btn-save" style={{ background: '#ff5555' }} onClick={handleDeleteDept}>{t('common.confirm')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
