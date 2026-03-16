import { useEffect, useState, useCallback, useMemo, useRef, lazy, Suspense, Component, type ReactNode, type ErrorInfo } from 'react'
import { useAgentState } from './hooks/useAgentState'
import { useLocale } from './i18n/index'
import { useMobile, useSwipeGesture } from './hooks/useMobile'
import { getToken, clearToken, setOnUnauthorized, authedFetch } from './utils/api'
import { getNotificationPrefs, saveNotificationPrefs, requestPermission } from './utils/notifications'
import LoginPanel from './components/LoginPanel'
import SetupWizard from './components/SetupWizard'
import DeptFormModal from './components/DeptFormModal'
import OfficeCanvas from './components/OfficeCanvas'
import ChatPanel, { type SubAgent } from './components/ChatPanel'
import StatusBar from './components/StatusBar'
import MobileNav from './components/MobileNav'
import MobileDrawer from './components/MobileDrawer'
import { BulletinIcon, MemoryIcon, ActivityIcon } from './components/Icons'
import { useVisibilityInterval } from './hooks/useVisibilityInterval'
import './App.css'

// Lazy load heavy tabs that aren't needed immediately
const BulletinTab = lazy(() => import('./components/BulletinTab'))
const MemoryTab = lazy(() => import('./components/MemoryTab'))
const ActivityTab = lazy(() => import('./components/ActivityTab'))
const CronTab = lazy(() => import('./components/CronTab'))
const DashboardTab = lazy(() => import('./components/DashboardTab'))
const IntegrationsTab = lazy(() => import('./components/IntegrationsTab'))
const SystemTab = lazy(() => import('./components/SystemTab'))
const RequestsTab = lazy(() => import('./components/RequestsTab'))
const GuideTab = lazy(() => import('./components/GuideTab'))
const SkillsTab = lazy(() => import('./components/SkillsTab'))

function TabFallback() {
  return <div style={{ padding: 24, color: '#666', textAlign: 'center' }}>...</div>
}

interface ErrorBoundaryProps { children: ReactNode; resetKey?: string }
interface ErrorBoundaryState { hasError: boolean; error?: Error }

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false }
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }
  componentDidUpdate(prevProps: ErrorBoundaryProps) {
    // Auto-reset when resetKey changes (e.g. switching tabs)
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, error: undefined })
    }
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info)
    // Auto-reload on stale chunk errors (dynamic import fails after deploy)
    if (error?.message?.includes('dynamically imported module') || error?.message?.includes('Failed to fetch')) {
      const reloadKey = 'openclaw-chunk-reload'
      const last = sessionStorage.getItem(reloadKey)
      if (!last || Date.now() - Number(last) > 10000) {
        sessionStorage.setItem(reloadKey, String(Date.now()))
        window.location.reload()
      }
    }
  }
  render() {
    if (this.state.hasError) {
      const isChunkError = this.state.error?.message?.includes('dynamically imported module') || this.state.error?.message?.includes('Failed to fetch')
      return (
        <div style={{ padding: 40, textAlign: 'center', color: '#ff5555', fontFamily: 'monospace' }}>
          <h2>{document.documentElement.lang === 'zh' ? '出错了' : 'Something went wrong'}</h2>
          <p style={{ color: '#888' }}>{this.state.error?.message}</p>
          <button onClick={() => isChunkError ? window.location.reload() : this.setState({ hasError: false, error: undefined })} style={{
            marginTop: 16, padding: '8px 24px', background: '#00d4aa', border: 'none', color: '#000', cursor: 'pointer', borderRadius: '4px', fontWeight: 600
          }}>
            {isChunkError
              ? (document.documentElement.lang === 'zh' ? '刷新页面' : 'Reload Page')
              : (document.documentElement.lang === 'zh' ? '重试' : 'Retry')
            }
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

type RightTab = 'chat' | 'bulletin' | 'memory' | 'activity' | 'requests' | 'cron' | 'dashboard' | 'integrations' | 'skills' | 'system' | 'guide'

export default function App() {
  const { t, locale, setLocale } = useLocale()
  const [authToken, setAuthToken] = useState<string | null>(getToken())
  const [setupReady, setSetupReady] = useState<boolean | null>(null) // null = loading

  // Check OpenClaw setup status on mount
  const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, '')
  useEffect(() => {
    fetch(`${API_BASE}/api/setup/status`)
      .then(r => r.json())
      .then(data => setSetupReady(data.ready))
      .catch(() => setSetupReady(true)) // If setup endpoint fails, skip wizard
  }, [API_BASE])

  // Register 401 handler
  useEffect(() => {
    setOnUnauthorized(() => setAuthToken(null))
  }, [])

  // Sync lang attribute for ErrorBoundary fallback
  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  const handleLogout = () => {
    clearToken()
    setAuthToken(null)
  }

  // Show setup wizard if OpenClaw not installed/configured
  if (setupReady === false) {
    return <SetupWizard onComplete={() => { setSetupReady(true); window.location.reload() }} />
  }

  // Still checking setup status
  if (setupReady === null) {
    return null
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
  }, [deleteDeptId, agentState.selectedDeptId, agentState.setSelectedDeptId])

  const handleCloseDeptForm = useCallback(() => {
    setShowDeptForm(false)
    setEditDeptData(null)
  }, [])

  const handleSwitchToChat = useCallback((deptId: string, prefillMessage: string) => {
    agentState.setSelectedDeptId(deptId)
    setChatPrefill(prefillMessage)
    setRightTab('chat')
  }, [agentState.setSelectedDeptId])

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

  // Gateway stats — pauses when tab hidden
  const [gatewayStats, setGatewayStats] = useState<{ connected?: boolean; latencyMs?: number; pendingRequests?: number; uptime?: number; streamBuffers?: number } | null>(null)
  const pollGateway = useCallback(() => {
    authedFetch('/api/gateway/stats').then(r => r.json()).then(d => setGatewayStats(d.gateway || d)).catch(() => {})
  }, [])
  useVisibilityInterval(pollGateway, 30000, [pollGateway])

  // Notification preferences
  const [notifyPrefs, setNotifyPrefs] = useState(getNotificationPrefs())
  const [showNotifyDropdown, setShowNotifyDropdown] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const notifyDropdownRef = useRef<HTMLDivElement>(null)

  const toggleNotifyPref = async (key: 'errors' | 'gateway' | 'slow') => {
    const newPrefs = { ...notifyPrefs, [key]: !notifyPrefs[key] }
    setNotifyPrefs(newPrefs)
    saveNotificationPrefs(newPrefs)
  }

  const toggleNotifications = async () => {
    if (!notifyPrefs.enabled) {
      // Try to request permission but don't block toggle if unavailable
      await requestPermission()
    }
    const newPrefs = { ...notifyPrefs, enabled: !notifyPrefs.enabled }
    setNotifyPrefs(newPrefs)
    saveNotificationPrefs(newPrefs)
  }

  // Close notification dropdown on outside click
  useEffect(() => {
    if (!showNotifyDropdown) return
    const handleClick = (e: MouseEvent) => {
      if (notifyDropdownRef.current && !notifyDropdownRef.current.contains(e.target as Node)) {
        setShowNotifyDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showNotifyDropdown])

  const RIGHT_TABS = useMemo(() => [
    { id: 'chat' as RightTab, label: t('app.tab.chat'), Icon: ({ size = 14, color = '#a0a0b0' }) => (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
        <path d="M2 2h12v9H5l-3 3V2z" stroke={color} strokeWidth="1.5" fill="none" />
      </svg>
    )},
    { id: 'bulletin' as RightTab, label: t('app.tab.bulletin'), Icon: BulletinIcon },
    { id: 'memory' as RightTab, label: t('app.tab.memory'), Icon: MemoryIcon },
    { id: 'activity' as RightTab, label: t('app.tab.activity'), Icon: ActivityIcon },
    { id: 'requests' as RightTab, label: t('app.tab.requests'), Icon: ({ size = 14, color = '#a0a0b0' }: { size?: number; color?: string }) => (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
        <path d="M3 2h10v12H3z" stroke={color} strokeWidth="1.3" fill="none" />
        <path d="M5 5h6M5 8h4M5 11h5" stroke={color} strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    )},
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
    { id: 'skills' as RightTab, label: t('app.tab.skills'), Icon: ({ size = 14, color = '#a0a0b0' }: { size?: number; color?: string }) => (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
        <path d="M8.5 1.5l1.2 3.8 4 .3-3.2 2.5 1 3.9L8.5 10l-3 2l1-3.9L3.3 5.6l4-.3z" stroke={color} strokeWidth="1.3" fill="none" />
      </svg>
    )},
    { id: 'system' as RightTab, label: t('app.tab.system'), Icon: ({ size = 14, color = '#a0a0b0' }: { size?: number; color?: string }) => (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="2.5" stroke={color} strokeWidth="1.3" fill="none" />
        <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.5 1.5M11.5 11.5L13 13M3 13l1.5-1.5M11.5 4.5L13 3" stroke={color} strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    )},
    { id: 'guide' as RightTab, label: t('app.tab.guide'), Icon: ({ size = 14, color = '#a0a0b0' }: { size?: number; color?: string }) => (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="6.5" stroke={color} strokeWidth="1.3" fill="none" />
        <path d="M6 6a2 2 0 1 1 2 2v1.5" stroke={color} strokeWidth="1.3" strokeLinecap="round" />
        <circle cx="8" cy="12" r="0.8" fill={color} />
      </svg>
    )},
  ], [t])

  const handleSubAgentsChange = useCallback((deptId: string, subs: SubAgent[]) => {
    setSubAgentsByDept(prev => ({ ...prev, [deptId]: subs }))
  }, [])

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
    <ErrorBoundary resetKey={rightTab}>
      <Suspense fallback={<TabFallback />}>
        {rightTab === 'chat' && (
          <ChatPanel
            selectedDeptId={agentState.selectedDeptId}
            departments={agentState.departments}
            activities={agentState.activities}
            addActivity={agentState.addActivity}
            onSubAgentsChange={handleSubAgentsChange}
            prefillMessage={chatPrefill}
            onPrefillConsumed={() => setChatPrefill(null)}
            onOpenDeptForm={() => { setEditDeptData(null); setShowDeptForm(true) }}
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
        {rightTab === 'requests' && (
          <RequestsTab requests={agentState.requests} />
        )}
        {rightTab === 'cron' && <CronTab departments={agentState.departments} selectedDeptId={agentState.selectedDeptId} />}
        {rightTab === 'dashboard' && <DashboardTab departments={agentState.departments} />}
        {rightTab === 'integrations' && <IntegrationsTab onSwitchToChat={handleSwitchToChat} />}
        {rightTab === 'skills' && <SkillsTab />}
        {rightTab === 'system' && <SystemTab />}
        {rightTab === 'guide' && <GuideTab />}
      </Suspense>
    </ErrorBoundary>
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
              <div ref={notifyDropdownRef} className="notify-dropdown">
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
            title={t('app.locale.toggle')}
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
          <button className="logout-btn" onClick={onLogout} title={t('app.logout')}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M6 2H3v12h3M11 4l4 4-4 4M7 8h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <div className="gateway-status" title={gatewayStats ? `${t('system.gateway.title')}: ${gatewayStats.connected ? t('system.gateway.connected') : t('system.gateway.disconnected')}\n${t('dashboard.gateway.latency')}: ${gatewayStats.latencyMs ?? '?'}ms\n${t('system.gateway.pending')}: ${gatewayStats.pendingRequests ?? 0}\n${t('system.gateway.streams')}: ${gatewayStats.streamBuffers ?? 0}` : `${t('system.gateway.title')}: ?`}>
            <span className={`status-dot ${gatewayStats?.connected ? 'connected' : 'disconnected'}`}></span>
            <span>{t('system.gateway.title')}</span>
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
