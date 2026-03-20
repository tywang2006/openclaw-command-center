import { lazy, Suspense, Component, type ReactNode, type ErrorInfo, type JSX } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAgentStateContext } from '../contexts/AgentStateContext'
import type { OpsModule } from '../types'
import './OpsConsolePage.css'

const DashboardTab = lazy(() => import('../components/DashboardTab'))
const SystemTab = lazy(() => import('../components/SystemTab'))
const CronTab = lazy(() => import('../components/CronTab'))
const AgentsTab = lazy(() => import('../components/ops/AgentsTab'))
const GatewaysTab = lazy(() => import('../components/ops/GatewaysTab'))
const ActivityOpsTab = lazy(() => import('../components/ops/ActivityOpsTab'))
const ApprovalsTab = lazy(() => import('../components/ops/ApprovalsTab'))

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
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, error: undefined })
    }
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[OpsConsolePage ErrorBoundary]', error, info)
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 40, textAlign: 'center', color: '#ff5555', fontFamily: 'monospace' }}>
          <p style={{ color: '#888' }}>{this.state.error?.message}</p>
          <button onClick={() => this.setState({ hasError: false, error: undefined })} style={{
            marginTop: 16, padding: '8px 24px', background: '#00d4aa', border: 'none', color: '#000', cursor: 'pointer', borderRadius: '4px', fontWeight: 600
          }}>
            {document.documentElement.lang === 'zh' ? '重试' : 'Retry'}
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

const MODULES: { id: OpsModule; labelKey: string; icon: JSX.Element }[] = [
  {
    id: 'dashboard',
    labelKey: 'ops.module.dashboard',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <rect x="1" y="8" width="3" height="7" stroke="currentColor" strokeWidth="1.3" fill="none" />
        <rect x="6" y="4" width="3" height="11" stroke="currentColor" strokeWidth="1.3" fill="none" />
        <rect x="11" y="1" width="3" height="14" stroke="currentColor" strokeWidth="1.3" fill="none" />
      </svg>
    ),
  },
  {
    id: 'system',
    labelKey: 'ops.module.system',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.3" fill="none" />
        <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.5 1.5M11.5 11.5L13 13M3 13l1.5-1.5M11.5 4.5L13 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: 'cron',
    labelKey: 'ops.module.cron',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 4v4l3 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: 'agents',
    labelKey: 'ops.module.agents',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <circle cx="6" cy="4" r="2.5" stroke="currentColor" strokeWidth="1.3" />
        <path d="M2 13c0-2.2 1.8-4 4-4s4 1.8 4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        <circle cx="12" cy="5" r="1.8" stroke="currentColor" strokeWidth="1.1" />
        <path d="M12 8.5c1.4 0 2.5 1.1 2.5 2.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: 'gateways',
    labelKey: 'ops.module.gateways',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <rect x="2" y="5" width="12" height="6" stroke="currentColor" strokeWidth="1.3" />
        <circle cx="5" cy="8" r="1" fill="currentColor" />
        <circle cx="8" cy="8" r="1" fill="currentColor" />
        <path d="M4 2v3M12 2v3M4 11v3M12 11v3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: 'activity',
    labelKey: 'ops.module.activity',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M3 2v12M3 4h8M3 7h6M3 10h10M3 13h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: 'approvals',
    labelKey: 'ops.module.approvals',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <rect x="2" y="1" width="12" height="14" stroke="currentColor" strokeWidth="1.3" />
        <path d="M5 5h6M5 8h6M5 11h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        <path d="M12 10l-2 2-1-1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
]

interface OpsConsolePageProps {
  t: (key: string, params?: Record<string, string | number>) => string
  locale: string
  setLocale: (l: 'zh' | 'en') => void
  theme: 'dark' | 'light'
  setTheme: (t: 'dark' | 'light') => void
  onLogout: () => void
}

export default function OpsConsolePage({ t, locale, setLocale, theme, setTheme, onLogout }: OpsConsolePageProps) {
  const { module } = useParams<{ module?: string }>()
  const navigate = useNavigate()
  const agentState = useAgentStateContext()

  const validModules = new Set<string>(['dashboard', 'system', 'cron', 'agents', 'gateways', 'activity', 'approvals'])
  const activeModule: OpsModule = validModules.has(module || '') ? (module as OpsModule) : 'dashboard'

  const handleSwitchTab = (tab: string) => {
    navigate(`/?tab=${tab}`)
  }

  const handleNavigateModule = (mod: OpsModule) => {
    navigate(`/ops/${mod}`)
  }

  return (
    <div className="ops-console">
      <header className="ops-header">
        <h1 className="ops-header-title">{t('ops.title')}</h1>
        <div className="ops-header-controls">
          <button
            className="locale-toggle"
            onClick={() => setLocale(locale === 'zh' ? 'en' : 'zh')}
            title={t('app.locale.toggle')}
          >
            {locale === 'zh' ? 'EN' : '中'}
          </button>
          <button
            className="theme-toggle"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            title={t('app.theme.toggle')}
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
          <button className="logout-btn" onClick={onLogout} title={t('app.logout')}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M6 2H3v12h3M11 4l4 4-4 4M7 8h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </header>
      <div className="ops-body">
        <aside className="ops-menu">
          {MODULES.map(mod => (
            <button
              key={mod.id}
              className={`ops-menu-item ${activeModule === mod.id ? 'active' : ''}`}
              onClick={() => navigate(`/ops/${mod.id}`)}
            >
              {mod.icon}
              <span>{t(mod.labelKey)}</span>
            </button>
          ))}
        </aside>
        <main className="ops-content">
          <ErrorBoundary resetKey={activeModule}>
            <Suspense fallback={<TabFallback />}>
              {activeModule === 'dashboard' && (
                <DashboardTab departments={agentState.departments} onSwitchTab={handleSwitchTab} onNavigateModule={handleNavigateModule} />
              )}
              {activeModule === 'system' && <SystemTab />}
              {activeModule === 'cron' && (
                <CronTab departments={agentState.departments} selectedDeptId={agentState.selectedDeptId} />
              )}
              {activeModule === 'agents' && (
                <AgentsTab departments={agentState.departments} />
              )}
              {activeModule === 'gateways' && <GatewaysTab />}
              {activeModule === 'activity' && (
                <ActivityOpsTab departments={agentState.departments} />
              )}
              {activeModule === 'approvals' && (
                <ApprovalsTab departments={agentState.departments} />
              )}
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>
    </div>
  )
}
