import { useEffect, useState } from 'react'
import { useAgentState } from './hooks/useAgentState'
import { useLocale } from './i18n/index'
import { getToken, clearToken, setOnUnauthorized, authedFetch } from './utils/api'
import { getNotificationPrefs, saveNotificationPrefs, requestPermission } from './utils/notifications'
import LoginPanel from './components/LoginPanel'

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
import SkillsTab from './components/SkillsTab'
import DashboardTab from './components/DashboardTab'
import StatusBar from './components/StatusBar'
import { BulletinIcon, MemoryIcon, ActivityIcon } from './components/Icons'
import './App.css'

type RightTab = 'chat' | 'bulletin' | 'memory' | 'activity' | 'cron' | 'skills' | 'dashboard'

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

  return <AuthenticatedApp t={t} locale={locale} setLocale={setLocale} onLogout={handleLogout} />
}

function AuthenticatedApp({ t, locale, setLocale, onLogout }: {
  t: (key: string, params?: Record<string, string | number>) => string
  locale: string
  setLocale: (l: 'zh' | 'en') => void
  onLogout: () => void
}) {
  const agentState = useAgentState()
  const [rightTab, setRightTab] = useState<RightTab>('chat')
  const [panelCollapsed, setPanelCollapsed] = useState(false)
  const [subAgentsByDept, setSubAgentsByDept] = useState<Record<string, SubAgent[]>>({})

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
    const poll = () => authedFetch('/cmd/api/gateway/stats').then(r => r.json()).then(d => setGatewayStats(d.gateway || d)).catch(() => {})
    poll()
    const timer = setInterval(poll, 30000)
    return () => clearInterval(timer)
  }, [])

  // Notification preferences
  const [notifyPrefs, setNotifyPrefs] = useState(getNotificationPrefs())
  const [showNotifyDropdown, setShowNotifyDropdown] = useState(false)

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

  const RIGHT_TABS: { id: RightTab; label: string; Icon: React.FC<{ size?: number; color?: string }> }[] = [
    { id: 'chat', label: t('app.tab.chat'), Icon: ({ size = 14, color = '#a0a0b0' }) => (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
        <path d="M2 2h12v9H5l-3 3V2z" stroke={color} strokeWidth="1.5" fill="none" />
      </svg>
    )},
    { id: 'bulletin', label: t('app.tab.bulletin'), Icon: BulletinIcon },
    { id: 'memory', label: t('app.tab.memory'), Icon: MemoryIcon },
    { id: 'activity', label: t('app.tab.activity'), Icon: ActivityIcon },
    { id: 'cron', label: t('app.tab.cron'), Icon: ({ size = 14, color = '#a0a0b0' }: { size?: number; color?: string }) => (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="6.5" stroke={color} strokeWidth="1.5" />
        <path d="M8 4v4l3 2" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    )},
    { id: 'skills', label: t('app.tab.skills'), Icon: ({ size = 14, color = '#a0a0b0' }: { size?: number; color?: string }) => (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
        <path d="M8 1l2 4h4l-3 3 1 4-4-2-4 2 1-4-3-3h4z" stroke={color} strokeWidth="1.3" fill="none" />
      </svg>
    )},
    { id: 'dashboard', label: t('app.tab.dashboard'), Icon: ({ size = 14, color = '#a0a0b0' }: { size?: number; color?: string }) => (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
        <rect x="1" y="8" width="3" height="7" stroke={color} strokeWidth="1.3" fill="none" />
        <rect x="6" y="4" width="3" height="11" stroke={color} strokeWidth="1.3" fill="none" />
        <rect x="11" y="1" width="3" height="14" stroke={color} strokeWidth="1.3" fill="none" />
      </svg>
    )},
  ]

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
          authedFetch(`/cmd/api/departments/${dept.id}/subagents`)
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
            {rightTab === 'chat' && (
              <ChatPanel
                selectedDeptId={agentState.selectedDeptId}
                departments={agentState.departments}
                activities={agentState.activities}
                addActivity={agentState.addActivity}
                onSubAgentsChange={handleSubAgentsChange}
                streamingTexts={agentState.streamingTexts}
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
            {rightTab === 'skills' && <SkillsTab />}
            {rightTab === 'dashboard' && <DashboardTab departments={agentState.departments} />}
          </div>
        </div>
      </div>

      <StatusBar
        departments={agentState.departments}
        selectedDeptId={agentState.selectedDeptId}
        onSelectDept={agentState.setSelectedDeptId}
      />
    </div>
  )
}
