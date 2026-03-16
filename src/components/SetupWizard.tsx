import { useState, useEffect, useRef } from 'react'
import './SetupWizard.css'

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, '')

interface SetupStatus {
  ready: boolean
  cliInstalled: boolean
  cliVersion: string | null
  configExists: boolean
  gatewayToken: boolean
  deptConfigExists: boolean
}

interface LogEntry {
  step: string
  message: string
  done?: boolean
  error?: boolean
}

export default function SetupWizard({ onComplete }: { onComplete: () => void }) {
  const [status, setStatus] = useState<SetupStatus | null>(null)
  const [installing, setInstalling] = useState(false)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch(`${API_BASE}/api/setup/status`)
      .then(r => r.json())
      .then(setStatus)
      .catch(() => setError('Cannot reach Command Center server'))
  }, [])

  // Listen for progress via WebSocket
  useEffect(() => {
    if (!installing) return

    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${proto}//${location.host}/cmd/ws`
    const ws = new WebSocket(wsUrl)

    ws.onopen = () => {
      // No auth needed for setup events — server broadcasts to all clients
      ws.send(JSON.stringify({ type: 'auth', token: 'setup' }))
    }

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        if (msg.event === 'setup:progress') {
          const entry = msg.data as LogEntry
          setLogs(prev => [...prev, entry])
          if (entry.done && !entry.error) {
            setDone(true)
            setTimeout(() => onComplete(), 1500)
          }
          if (entry.error) {
            setError(entry.message)
            setInstalling(false)
          }
        }
      } catch {}
    }

    ws.onerror = () => {}
    ws.onclose = () => {}

    return () => ws.close()
  }, [installing, onComplete])

  // Auto-scroll logs
  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight)
  }, [logs])

  const handleInstall = async () => {
    setInstalling(true)
    setError(null)
    setLogs([])

    try {
      const res = await fetch(`${API_BASE}/api/setup/install`, { method: 'POST' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Install failed' }))
        setError(data.error || 'Install failed')
        setInstalling(false)
      }
    } catch (err) {
      setError('Network error — is the server running?')
      setInstalling(false)
    }
  }

  if (!status) {
    return (
      <div className="setup-wizard">
        <div className="setup-card">
          <div className="setup-loading">Loading...</div>
        </div>
      </div>
    )
  }

  return (
    <div className="setup-wizard">
      <div className="setup-card">
        <div className="setup-logo">🦞</div>
        <h1 className="setup-title">OpenClaw Command Center</h1>
        <p className="setup-subtitle">Setup Required</p>

        <div className="setup-checklist">
          <CheckItem label="OpenClaw CLI" ok={status.cliInstalled} detail={status.cliVersion} />
          <CheckItem label="Configuration" ok={status.configExists} />
          <CheckItem label="Gateway Token" ok={status.gatewayToken} />
          <CheckItem label="Departments" ok={status.deptConfigExists} />
        </div>

        {!installing && !done && (
          <>
            <p className="setup-desc">
              {status.cliInstalled
                ? 'OpenClaw is installed but needs additional configuration.'
                : 'OpenClaw is not installed. Click below to install and configure automatically.'}
            </p>
            <button className="setup-btn" onClick={handleInstall}>
              {status.cliInstalled ? 'Configure & Connect' : 'Install OpenClaw'}
            </button>
          </>
        )}

        {installing && !done && (
          <div className="setup-progress">
            <div className="setup-spinner" />
            <span>Setting up...</span>
          </div>
        )}

        {done && (
          <div className="setup-done">
            Setup complete! Reloading...
          </div>
        )}

        {error && (
          <div className="setup-error">{error}</div>
        )}

        {logs.length > 0 && (
          <div className="setup-logs" ref={logRef}>
            {logs.map((l, i) => (
              <div key={i} className={`setup-log ${l.error ? 'log-error' : ''}`}>
                <span className="log-step">[{l.step}]</span> {l.message}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function CheckItem({ label, ok, detail }: { label: string; ok: boolean; detail?: string | null }) {
  return (
    <div className={`check-item ${ok ? 'check-ok' : 'check-missing'}`}>
      <span className="check-icon">{ok ? '\u2713' : '\u2717'}</span>
      <span className="check-label">{label}</span>
      {detail && <span className="check-detail">{detail}</span>}
    </div>
  )
}
