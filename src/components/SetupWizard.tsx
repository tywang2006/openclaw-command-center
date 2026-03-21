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

type WizardStep = 'welcome' | 'check' | 'install' | 'complete'

export default function SetupWizard({ onComplete }: { onComplete: () => void }) {
  const [currentStep, setCurrentStep] = useState<WizardStep>('welcome')
  const [status, setStatus] = useState<SetupStatus | null>(null)
  const [installing, setInstalling] = useState(false)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [checkComplete, setCheckComplete] = useState(false)
  const logRef = useRef<HTMLDivElement>(null)

  // Load status when entering check step
  useEffect(() => {
    if (currentStep === 'check' && !status) {
      setError(null)
      setCheckComplete(false)
      fetch(`${API_BASE}/api/setup/status`)
        .then(r => r.json())
        .then(data => {
          setStatus(data)
          setCheckComplete(true)
        })
        .catch(() => setError('Cannot reach Command Center server'))
    }
  }, [currentStep, status])

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
            setInstalling(false)
            setCurrentStep('complete')
            setTimeout(() => onComplete(), 2000)
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
    setCurrentStep('install')

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

  const canProceed = () => {
    switch (currentStep) {
      case 'welcome':
        return true
      case 'check':
        return checkComplete && status !== null
      case 'install':
        return done
      case 'complete':
        return false
      default:
        return false
    }
  }

  const handleNext = () => {
    if (!canProceed()) return

    switch (currentStep) {
      case 'welcome':
        setCurrentStep('check')
        break
      case 'check':
        if (status?.ready) {
          setDone(true)
          setCurrentStep('complete')
        } else {
          handleInstall()
        }
        break
      case 'install':
        setCurrentStep('complete')
        break
    }
  }

  const handleBack = () => {
    setError(null)
    switch (currentStep) {
      case 'check':
        setCurrentStep('welcome')
        setStatus(null)
        setCheckComplete(false)
        break
      case 'install':
        // Don't allow going back during installation
        if (!installing) {
          setCurrentStep('check')
          setLogs([])
          setInstalling(false)
        }
        break
      case 'complete':
        // Can't go back from complete
        break
    }
  }

  return (
    <div className="setup-wizard">
      <div className="setup-card">
        <div className="setup-logo">🦞</div>
        <h1 className="setup-title">OpenClaw Command Center</h1>

        {/* Step indicator */}
        <div className="setup-steps">
          <div className={`step-item ${currentStep === 'welcome' ? 'active' : ''} ${['check', 'install', 'complete'].includes(currentStep) ? 'completed' : ''}`}>
            <div className="step-number">1</div>
            <div className="step-label">欢迎</div>
          </div>
          <div className="step-line" />
          <div className={`step-item ${currentStep === 'check' ? 'active' : ''} ${['install', 'complete'].includes(currentStep) ? 'completed' : ''}`}>
            <div className="step-number">2</div>
            <div className="step-label">检查</div>
          </div>
          <div className="step-line" />
          <div className={`step-item ${currentStep === 'install' ? 'active' : ''} ${currentStep === 'complete' ? 'completed' : ''}`}>
            <div className="step-number">3</div>
            <div className="step-label">安装</div>
          </div>
          <div className="step-line" />
          <div className={`step-item ${currentStep === 'complete' ? 'active' : ''}`}>
            <div className="step-number">4</div>
            <div className="step-label">完成</div>
          </div>
        </div>

        {/* Step content */}
        <div className="setup-content">
          {currentStep === 'welcome' && (
            <>
              <h2 className="step-title">欢迎使用 Command Center</h2>
              <p className="setup-desc">
                Command Center 是您的 AI 团队指挥中心。让我们开始设置您的环境。
              </p>
              <ul className="setup-features">
                <li>多部门协作系统</li>
                <li>实时会议与决策</li>
                <li>智能任务分配</li>
                <li>集成工作流管理</li>
              </ul>
            </>
          )}

          {currentStep === 'check' && (
            <>
              <h2 className="step-title">系统检查</h2>
              {!checkComplete ? (
                <div className="setup-progress">
                  <div className="setup-spinner" />
                  <span>正在检查系统状态...</span>
                </div>
              ) : status ? (
                <>
                  <div className="setup-checklist">
                    <CheckItem label="OpenClaw CLI" ok={status.cliInstalled} detail={status.cliVersion} />
                    <CheckItem label="配置文件" ok={status.configExists} />
                    <CheckItem label="Gateway Token" ok={status.gatewayToken} />
                    <CheckItem label="部门配置" ok={status.deptConfigExists} />
                  </div>
                  {status.ready ? (
                    <p className="setup-desc status-ok">
                      系统已准备就绪！点击下一步开始使用。
                    </p>
                  ) : (
                    <p className="setup-desc status-warn">
                      {status.cliInstalled
                        ? '需要完成配置。点击下一步自动配置。'
                        : '需要安装 OpenClaw。点击下一步自动安装。'}
                    </p>
                  )}
                </>
              ) : null}
            </>
          )}

          {currentStep === 'install' && (
            <>
              <h2 className="step-title">安装配置</h2>
              {installing && !done && (
                <div className="setup-progress">
                  <div className="setup-spinner" />
                  <span>正在安装配置...</span>
                </div>
              )}
              {done && (
                <div className="setup-done">
                  安装完成！
                </div>
              )}
              {logs.length > 0 && (
                <div className="setup-logs" ref={logRef}>
                  {logs.map((l, i) => (
                    <div key={`log-${l.step}-${i}`} className={`setup-log ${l.error ? 'log-error' : ''}`}>
                      <span className="log-step">[{l.step}]</span> {l.message}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {currentStep === 'complete' && (
            <>
              <h2 className="step-title">设置完成</h2>
              <div className="setup-success">
                <svg className="success-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
                <p>OpenClaw Command Center 已成功设置！</p>
                <p className="setup-desc">即将重新加载...</p>
              </div>
            </>
          )}
        </div>

        {error && (
          <div className="setup-error">{error}</div>
        )}

        {/* Navigation buttons */}
        <div className="setup-actions">
          {currentStep !== 'welcome' && currentStep !== 'complete' && (
            <button
              className="setup-btn-secondary"
              onClick={handleBack}
              disabled={installing}
            >
              上一步
            </button>
          )}
          {currentStep !== 'complete' && (
            <button
              className="setup-btn"
              onClick={handleNext}
              disabled={!canProceed() || installing}
            >
              {currentStep === 'check' && status?.ready ? '完成' : '下一步'}
            </button>
          )}
          {currentStep === 'complete' && (
            <button className="setup-btn" onClick={onComplete}>
              进入系统
            </button>
          )}
        </div>
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
