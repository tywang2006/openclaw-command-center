import { useState } from 'react'
import { setToken } from '../utils/api'
import './LoginPanel.css'

interface LoginPanelProps {
  onLogin: (token: string) => void
}

export default function LoginPanel({ onLogin }: LoginPanelProps) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!password.trim() || loading) return
    setLoading(true)
    setError('')
    try {
      const base = import.meta.env.BASE_URL.replace(/\/$/, '')
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
        setError(data.error || 'Login failed')
      }
    } catch {
      setError('Network error')
    }
    setLoading(false)
  }

  return (
    <div className="login-overlay">
      <form className="login-panel" onSubmit={handleSubmit}>
        <div className="login-title">OpenClaw</div>
        <div className="login-subtitle">Command Center</div>
        <input
          type="password"
          className="login-input"
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder="Password"
          autoFocus
          disabled={loading}
        />
        <button className="login-btn" type="submit" disabled={loading || !password.trim()}>
          {loading ? '...' : 'LOGIN'}
        </button>
        {error && <div className="login-error">{error}</div>}
      </form>
    </div>
  )
}
