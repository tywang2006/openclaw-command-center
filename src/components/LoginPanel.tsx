import { useState, useEffect } from 'react'
import { useLocale } from '../i18n/index'
import { setToken } from '../utils/api'
import './LoginPanel.css'

interface LoginPanelProps {
  onLogin: (token: string) => void
}

export default function LoginPanel({ onLogin }: LoginPanelProps) {
  const { t } = useLocale()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [setupMode, setSetupMode] = useState<boolean | null>(null) // null = checking

  const base = import.meta.env.BASE_URL.replace(/\/$/, '')

  useEffect(() => {
    fetch(`${base}/api/auth/status`)
      .then(r => r.json())
      .then(data => setSetupMode(!data.passwordSet))
      .catch(() => setSetupMode(false)) // fallback to login mode
  }, [base])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!password.trim() || loading) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: password.trim() }),
      })
      const data = await res.json()
      if (data.success && data.token) {
        setToken(data.token)
        onLogin(data.token)
      } else {
        setError(data.error || t('login.error.failed'))
      }
    } catch {
      setError(t('login.error.network'))
    }
    setLoading(false)
  }

  const handleSetup = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!password.trim() || loading) return
    if (password !== confirm) {
      setError(t('login.error.mismatch'))
      return
    }
    if (password.length < 8) {
      setError(t('login.error.short'))
      return
    }
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${base}/api/auth/setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: password.trim() }),
      })
      const data = await res.json()
      if (data.success && data.token) {
        setToken(data.token)
        onLogin(data.token)
      } else {
        setError(data.error || t('login.error.failed'))
      }
    } catch {
      setError(t('login.error.network'))
    }
    setLoading(false)
  }

  if (setupMode === null) {
    return <div className="login-overlay"><div className="login-panel"><div className="login-subtitle">...</div></div></div>
  }

  if (setupMode) {
    return (
      <div className="login-overlay">
        <form className="login-panel" onSubmit={handleSetup}>
          <div className="login-title">ChaoClaw</div>
          <div className="login-subtitle">{t('login.setup.title')}</div>
          <input
            type="password"
            className="login-input"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder={t('login.setup.password')}
            autoFocus
            disabled={loading}
          />
          <input
            type="password"
            className="login-input"
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            placeholder={t('login.setup.confirm')}
            disabled={loading}
          />
          <button className="login-btn" type="submit" disabled={loading || !password.trim() || !confirm.trim()}>
            {loading ? t('login.loading') : t('login.setup.submit')}
          </button>
          {error && <div className="login-error">{error}</div>}
        </form>
      </div>
    )
  }

  return (
    <div className="login-overlay">
      <form className="login-panel" onSubmit={handleLogin}>
        <div className="login-title">ChaoClaw</div>
        <div className="login-subtitle">Command Center</div>
        <input
          type="password"
          className="login-input"
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder={t('login.password')}
          autoFocus
          disabled={loading}
        />
        <button className="login-btn" type="submit" disabled={loading || !password.trim()}>
          {loading ? t('login.loading') : t('login.submit')}
        </button>
        {error && <div className="login-error">{error}</div>}
      </form>
    </div>
  )
}
