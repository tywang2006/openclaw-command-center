import { useEffect, useState, Component, type ReactNode, type ErrorInfo } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useLocale } from './i18n/index'
import { useTheme } from './hooks/useTheme'
import { getToken, clearToken, setOnUnauthorized, authedFetch } from './utils/api'
import { AgentStateProvider } from './contexts/AgentStateContext'
import LoginPanel from './components/LoginPanel'
import SetupWizard from './components/SetupWizard'
import AppSidebar from './components/AppSidebar'
import OfficePage from './pages/OfficePage'
import OpsConsolePage from './pages/OpsConsolePage'
import './App.css'

const RELOAD_THROTTLE_MS = 10000

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
    console.error('[ErrorBoundary]', error, info)
    if (error?.message?.includes('dynamically imported module') || error?.message?.includes('Failed to fetch')) {
      const reloadKey = 'openclaw-chunk-reload'
      const last = sessionStorage.getItem(reloadKey)
      if (!last || Date.now() - Number(last) > RELOAD_THROTTLE_MS) {
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

export default function App() {
  const { t, locale, setLocale } = useLocale()
  const { theme, setTheme } = useTheme()
  const [authToken, setAuthToken] = useState<string | null>(getToken())
  const [setupReady, setSetupReady] = useState<boolean | null>(null)

  const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, '')
  useEffect(() => {
    fetch(`${API_BASE}/api/setup/status`)
      .then(r => r.json())
      .then(data => setSetupReady(data.ready))
      .catch((err) => {
        if (import.meta.env.DEV) console.warn('Fetch setup status failed:', err);
        setSetupReady(true);
      })
  }, [API_BASE])

  useEffect(() => {
    setOnUnauthorized(() => setAuthToken(null))
  }, [])

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  const handleLogout = () => {
    authedFetch('/api/auth/logout', { method: 'POST' }).catch((err) => {
      if (import.meta.env.DEV) console.warn('Logout request failed:', err);
    })
    clearToken()
    setAuthToken(null)
  }

  if (setupReady === false) {
    return <SetupWizard onComplete={() => { setSetupReady(true); window.location.reload() }} />
  }

  if (setupReady === null) {
    return null
  }

  if (!authToken) {
    return <LoginPanel onLogin={(token) => setAuthToken(token)} />
  }

  return (
    <ErrorBoundary>
      <AgentStateProvider>
        <div className="app-with-sidebar">
          <AppSidebar />
          <div className="app-main-area">
            <Routes>
              <Route path="/" element={
                <OfficePage t={t} locale={locale} setLocale={setLocale}
                  theme={theme} setTheme={setTheme} onLogout={handleLogout} />
              } />
              <Route path="/ops/:module?" element={
                <OpsConsolePage t={t} locale={locale} setLocale={setLocale}
                  theme={theme} setTheme={setTheme} onLogout={handleLogout} />
              } />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </div>
        </div>
      </AgentStateProvider>
    </ErrorBoundary>
  )
}
