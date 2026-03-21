import { useEffect, useState, useCallback, useMemo, useRef, lazy, Suspense, type RefObject } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAgentStateContext } from '../contexts/AgentStateContext'
import { useMobile, useSwipeGesture } from '../hooks/useMobile'
import { authedFetch } from '../utils/api'
import { getNotificationPrefs, saveNotificationPrefs, requestPermission, subscribePush, unsubscribePush } from '../utils/notifications'
import DeptFormModal from '../components/DeptFormModal'
import ChatPanel, { type SubAgent } from '../components/ChatPanel'
import StatusBar from '../components/StatusBar'
import MobileNav from '../components/MobileNav'
import MobileDrawer from '../components/MobileDrawer'
import { BulletinIcon, MemoryIcon, ActivityIcon } from '../components/Icons'
import { useVisibilityInterval } from '../hooks/useVisibilityInterval'
import type { RightTab } from '../types'

const BulletinTab = lazy(() => import('../components/BulletinTab'))
const MemoryTab = lazy(() => import('../components/MemoryTab'))
const ActivityTab = lazy(() => import('../components/ActivityTab'))
const IntegrationsTab = lazy(() => import('../components/IntegrationsTab'))
const RequestsTab = lazy(() => import('../components/RequestsTab'))
const GuideTab = lazy(() => import('../components/GuideTab'))
const SkillsTab = lazy(() => import('../components/SkillsTab'))
const MeetingRoom = lazy(() => import('../components/MeetingRoom'))
const CommandPalette = lazy(() => import('../components/CommandPalette'))
const OfficeCanvas = lazy(() => import('../components/OfficeCanvas'))

function TabFallback() {
  return <div style={{ padding: 24, color: '#666', textAlign: 'center' }}>...</div>
}

function Clock({ locale }: { locale: string }) {
  const [time, setTime] = useState(new Date())
  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])
  return <div className="current-time">{time.toLocaleTimeString(locale === 'zh' ? 'zh-CN' : 'en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}</div>
}

interface OfficePageProps {
  t: (key: string, params?: Record<string, string | number>) => string
  locale: string
  setLocale: (l: 'zh' | 'en') => void
  theme: 'dark' | 'light'
  setTheme: (t: 'dark' | 'light') => void
  onLogout: () => void
}

export default function OfficePage({ t, locale, setLocale, theme, setTheme, onLogout }: OfficePageProps) {
  const agentState = useAgentStateContext()
  const isMobile = useMobile()
  const [searchParams, setSearchParams] = useSearchParams()

  // Valid tabs for URL sync
  const validTabs = useMemo(() => ['chat','bulletin','memory','activity','requests','meeting','integrations','skills','guide'], [])

  // Sync rightTab state with URL params
  const tabParam = searchParams.get('tab')
  const initialTab = (tabParam && validTabs.includes(tabParam)) ? (tabParam as RightTab) : 'chat'
  const [rightTab, setRightTab] = useState<RightTab>(initialTab)

  // Update rightTab when URL changes
  useEffect(() => {
    const currentTab = searchParams.get('tab')
    if (currentTab && validTabs.includes(currentTab) && currentTab !== rightTab) {
      setRightTab(currentTab as RightTab)
    } else if (!currentTab && rightTab !== 'chat') {
      setRightTab('chat')
    }
  }, [searchParams, rightTab, validTabs])
  const [panelCollapsed, setPanelCollapsed] = useState(false)
  const [subAgentsByDept, setSubAgentsByDept] = useState<Record<string, SubAgent[]>>({})
  const [showDeptPicker, setShowDeptPicker] = useState(false)
  const [chatPrefill, setChatPrefill] = useState<string | null>(null)
  const [showDeptForm, setShowDeptForm] = useState(false)
  const [editDeptData, setEditDeptData] = useState<{ id: string; name: string; agent?: string; icon: string; color: string; hue: number; telegramTopicId?: number; order: number } | null>(null)
  const [deleteDeptId, setDeleteDeptId] = useState<string | null>(null)
  const [showPalette, setShowPalette] = useState(false)
  const deleteDialogRef = useRef<HTMLDivElement>(null)
  const deleteTriggerRef = useRef<HTMLElement | null>(null)

  interface EditDeptParam {
    id: string
    name: string
    agent?: string
    icon?: string
    color?: string
    hue?: number
    telegramTopicId?: number
    order?: number
  }

  const handleEditDept = useCallback((dept: EditDeptParam) => {
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

  // Delete modal focus trap and escape handler
  useEffect(() => {
    if (!deleteDeptId) return

    // Save previous focus
    deleteTriggerRef.current = document.activeElement as HTMLElement

    // Focus first button
    const timer = setTimeout(() => {
      const firstBtn = deleteDialogRef.current?.querySelector<HTMLElement>('button')
      firstBtn?.focus()
    }, 50)

    // Escape key handler
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDeleteDeptId(null)
    }
    document.addEventListener('keydown', handleEscape)

    return () => {
      clearTimeout(timer)
      document.removeEventListener('keydown', handleEscape)
      deleteTriggerRef.current?.focus()
    }
  }, [deleteDeptId])

  const handleCloseDeptForm = useCallback(() => {
    setShowDeptForm(false)
    setEditDeptData(null)
  }, [])

  const handleSwitchToChat = useCallback((deptId: string, prefillMessage: string) => {
    agentState.setSelectedDeptId(deptId)
    setChatPrefill(prefillMessage)
    setSearchParams({ tab: 'chat' })
  }, [agentState.setSelectedDeptId, setSearchParams])

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
  const pollGateway = useCallback(() => {
    authedFetch('/api/gateway/stats').then(r => r.json()).then(d => setGatewayStats(d.gateway || d)).catch((err) => {
      if (import.meta.env.DEV) console.warn('Fetch gateway stats failed:', err);
    })
  }, [])
  useVisibilityInterval(pollGateway, 30000, [pollGateway])

  // Notification preferences
  const [notifyPrefs, setNotifyPrefs] = useState(getNotificationPrefs())
  const [showNotifyDropdown, setShowNotifyDropdown] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [pushEnabled, setPushEnabled] = useState(false)
  const notifyDropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if ('serviceWorker' in navigator && 'PushManager' in window) {
      navigator.serviceWorker.ready.then((reg) => {
        reg.pushManager.getSubscription().then((sub) => {
          setPushEnabled(!!sub)
        }).catch((err) => {
          if (import.meta.env.DEV) console.warn('Get push subscription failed:', err);
        })
      }).catch((err) => {
        if (import.meta.env.DEV) console.warn('Service worker ready failed:', err);
      })
    }
  }, [])

  const toggleNotifyPref = async (key: 'errors' | 'gateway' | 'slow') => {
    const newPrefs = { ...notifyPrefs, [key]: !notifyPrefs[key] }
    setNotifyPrefs(newPrefs)
    saveNotificationPrefs(newPrefs)
  }

  const toggleNotifications = async () => {
    if (!notifyPrefs.enabled) {
      await requestPermission()
    }
    const newPrefs = { ...notifyPrefs, enabled: !notifyPrefs.enabled }
    setNotifyPrefs(newPrefs)
    saveNotificationPrefs(newPrefs)
  }

  const togglePushNotifications = async () => {
    if (!pushEnabled) {
      const success = await subscribePush()
      if (success) setPushEnabled(true)
    } else {
      await unsubscribePush()
      setPushEnabled(false)
    }
  }

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

  // 9-tab grid (3x3): removed dashboard, system, cron
  const RIGHT_TABS = useMemo(() => [
    // Row 1: Chat, Activity, Meeting
    { id: 'chat' as RightTab, label: t('app.tab.chat'), Icon: ({ size = 14, color = '#a0a0b0' }: { size?: number; color?: string }) => (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
        <path d="M2 2h12v9H5l-3 3V2z" stroke={color} strokeWidth="1.5" fill="none" />
      </svg>
    )},
    { id: 'activity' as RightTab, label: t('app.tab.activity'), Icon: ActivityIcon },
    { id: 'meeting' as RightTab, label: t('app.tab.meeting'), Icon: ({ size = 14, color = '#a0a0b0' }: { size?: number; color?: string }) => (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
        <rect x="1" y="4" width="14" height="10" rx="1" stroke={color} strokeWidth="1.3" />
        <circle cx="5" cy="9" r="1.5" fill={color} />
        <circle cx="8" cy="9" r="1.5" fill={color} />
        <circle cx="11" cy="9" r="1.5" fill={color} />
        <path d="M3 4v-2h10v2" stroke={color} strokeWidth="1.3" />
      </svg>
    )},
    // Row 2: Requests, Bulletin, Memory
    { id: 'requests' as RightTab, label: t('app.tab.requests'), Icon: ({ size = 14, color = '#a0a0b0' }: { size?: number; color?: string }) => (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
        <path d="M3 2h10v12H3z" stroke={color} strokeWidth="1.3" fill="none" />
        <path d="M5 5h6M5 8h4M5 11h5" stroke={color} strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    )},
    { id: 'bulletin' as RightTab, label: t('app.tab.bulletin'), Icon: BulletinIcon },
    { id: 'memory' as RightTab, label: t('app.tab.memory'), Icon: MemoryIcon },
    // Row 3: Integrations, Skills, Guide
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
            .catch((err) => {
              if (import.meta.env.DEV) console.warn(`Fetch subagents for ${dept.id} failed:`, err);
              return { deptId: dept.id, agents: [] as SubAgent[] };
            })
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

  // Global Cmd+K listener for command palette
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setShowPalette(prev => !prev)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const tabContent = (
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
        <RequestsTab requests={agentState.requests} onRefresh={agentState.refreshRequests} />
      )}
      {rightTab === 'meeting' && <MeetingRoom departments={agentState.departments} onClose={() => setSearchParams({ tab: 'chat' })} />}
      {rightTab === 'integrations' && <IntegrationsTab onSwitchToChat={handleSwitchToChat} />}
      {rightTab === 'skills' && <SkillsTab />}
      {rightTab === 'guide' && <GuideTab />}
    </Suspense>
  )

  // ---- Mobile Layout ----
  if (isMobile) {
    return (
      <div className="app mobile" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
        <header className="mobile-topbar">
          <button className="mobile-hamburger" onClick={() => setDrawerOpen(true)} aria-label="打开菜单">
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
          onTabChange={(tab) => setSearchParams({ tab })}
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
              aria-label="通知设置"
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
                <label className="notify-option">
                  <input type="checkbox" checked={pushEnabled} onChange={togglePushNotifications} />
                  <span>{document.documentElement.lang === 'zh' ? '推送通知' : 'Push'}</span>
                </label>
              </div>
            )}
          </div>
          <button
            className="locale-toggle"
            onClick={() => setLocale(locale === 'zh' ? 'en' : 'zh')}
            title={t('app.locale.toggle')}
            aria-label="切换语言"
          >
            {locale === 'zh' ? 'EN' : '中'}
          </button>
          <button
            className="theme-toggle"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            title={t('app.theme.toggle')}
            aria-label="切换主题"
          >
            {theme === 'dark' ? (
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.3" />
                <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M13.5 9.5a5.5 5.5 0 0 1-7-7 5.5 5.5 0 1 0 7 7z" stroke="currentColor" strokeWidth="1.3" />
              </svg>
            )}
          </button>
          <button className="fullscreen-btn" onClick={toggleFullscreen} title={isFullscreen ? t('app.fullscreen.exit') : t('app.fullscreen.enter')} aria-label={isFullscreen ? "退出全屏" : "进入全屏"}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              {isFullscreen ? (
                <path d="M5 1v4H1M11 1v4h4M5 15v-4H1M11 15v-4h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              ) : (
                <path d="M1 5V1h4M15 5V1h-4M1 11v4h4M15 11v4h-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              )}
            </svg>
          </button>
          <button className="logout-btn" onClick={onLogout} title={t('app.logout')} aria-label="退出登录">
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
          <Suspense fallback={<div style={{width:'100%',height:'100%',background:'var(--bg-primary)'}} />}>
            <OfficeCanvas
              departments={agentState.departments}
              selectedDeptId={agentState.selectedDeptId}
              onSelectDept={agentState.setSelectedDeptId}
              subAgents={subAgentsByDept}
              toolStates={agentState.toolStates}
            />
          </Suspense>
        </div>
        <button className="panel-toggle" onClick={() => setPanelCollapsed(!panelCollapsed)} title={panelCollapsed ? t('app.panel.expand') : t('app.panel.collapse')} aria-label={panelCollapsed ? "展开面板" : "收起面板"}>
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
                onClick={() => setSearchParams({ tab: tab.id })}
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
        <div className="dept-modal-overlay" onClick={() => setDeleteDeptId(null)} role="dialog" aria-modal="true" aria-labelledby="delete-dept-title">
          <div className="dept-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 360 }} ref={deleteDialogRef}>
            <div className="dept-modal-header">
              <h3 id="delete-dept-title">{t('dept.delete')}</h3>
              <button className="dept-modal-close" onClick={() => setDeleteDeptId(null)} aria-label="Close">&times;</button>
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

      {showPalette && (
        <Suspense fallback={null}>
          <CommandPalette
            open={showPalette}
            onClose={() => setShowPalette(false)}
            departments={agentState.departments}
            onSelectDept={(id) => agentState.setSelectedDeptId(id)}
            onSwitchTab={(tab) => setSearchParams({ tab })}
            onOpenMeeting={() => setSearchParams({ tab: 'meeting' })}
          />
        </Suspense>
      )}
    </div>
  )
}
