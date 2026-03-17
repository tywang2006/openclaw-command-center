import { useEffect, useState, useCallback, useMemo } from 'react'
import type { Department } from '../hooks/useAgentState'
import { DeptIcon } from './Icons'
import { useLocale } from '../i18n/index'
import { authedFetch } from '../utils/api'
import { useVisibilityInterval } from '../hooks/useVisibilityInterval'
import './DashboardTab.css'

interface DailyData {
  date: string
  messages: number
  errors: number
  tokens: { input: number; output: number }
  avgResponseMs: number
}

interface DashboardTabProps {
  departments: Department[]
}

interface MetricsData {
  totalMessages: number
  avgResponseTime: number
  errorRate: number
  uptime: number
  departments: {
    id: string
    messages: number
    errors: number
    avgResponseTime: number
    responseTimes: number[]
  }[]
  tokens?: {
    total: {
      input: number
      output: number
    }
    byDepartment: Record<string, {
      input: number
      output: number
    }>
  }
}

interface GatewayStats {
  connected: boolean
  latency: number
  pending: number
  uptime: number
  buffers: number
}

interface PermissionEvent {
  deptId: string
  toolName: string
  timestamp: number
}

interface IntegrationConfig {
  id: string
  name: string
  enabled: boolean
}

interface DepartmentHealth {
  id: string
  lastActiveMs?: number
  estimatedResponseTimeMs: number
  errorCount: number
  todayMessages: number
}

export default function DashboardTab({ departments }: DashboardTabProps) {
  const [metrics, setMetrics] = useState<MetricsData | null>(null)
  const [gatewayStats, setGatewayStats] = useState<GatewayStats | null>(null)
  const [permissions, setPermissions] = useState<PermissionEvent[]>([])
  const [integrations, setIntegrations] = useState<IntegrationConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [dailyData, setDailyData] = useState<DailyData[]>([])
  const [healthStatus, setHealthStatus] = useState<Record<string, { consecutiveErrors: number; status: string }>>({})
  const { t } = useLocale()

  const fetchMetrics = useCallback(async () => {
    try {
      const res = await authedFetch('/api/metrics')
      const raw = await res.json()
      if (!raw.success) return
      // Transform API response to component format
      const depts = Object.entries(raw.departments || {}).map(([id, d]: [string, any]) => ({
        id,
        messages: d.messageCount || 0,
        errors: d.errorCount || 0,
        avgResponseTime: d.avgResponseMs || 0,
        responseTimes: d.recentResponseTimes || [],
      }))
      const totalInput = Object.values(raw.departments || {}).reduce((s: number, d: any) => s + (d.tokens?.input || 0), 0)
      const totalOutput = Object.values(raw.departments || {}).reduce((s: number, d: any) => s + (d.tokens?.output || 0), 0)
      const byDept: Record<string, { input: number; output: number }> = {}
      for (const [id, d] of Object.entries(raw.departments || {}) as [string, any][]) {
        if (d.tokens && (d.tokens.input > 0 || d.tokens.output > 0)) {
          byDept[id] = { input: d.tokens.input, output: d.tokens.output }
        }
      }
      const g = raw.global || {}
      const totalMsgs = g.totalMessages || 0
      const totalErrors = g.totalErrors || 0
      setMetrics({
        totalMessages: totalMsgs,
        avgResponseTime: g.avgResponseMs || 0,
        errorRate: totalMsgs > 0 ? totalErrors / totalMsgs : 0,
        uptime: (raw.uptime || 0) / 1000,
        departments: depts,
        tokens: (totalInput > 0 || totalOutput > 0) ? { total: { input: totalInput, output: totalOutput }, byDepartment: byDept } : undefined,
      })

      // Parse daily data (last 14 days)
      const daily = Object.entries(raw.daily || {})
        .map(([date, d]: [string, any]) => ({
          date,
          messages: d.messages || 0,
          errors: d.errors || 0,
          tokens: { input: d.tokens?.input || 0, output: d.tokens?.output || 0 },
          avgResponseMs: d.avgResponseMs || 0
        }))
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(-14)
      setDailyData(daily)

      // Store health status
      setHealthStatus(raw.healthStatus || {})
    } catch (err) {
      console.error('Failed to fetch metrics:', err)
    }
  }, [])

  const fetchGatewayStats = useCallback(async () => {
    try {
      const res = await authedFetch('/api/gateway/stats')
      const raw = await res.json()
      if (!raw.success) return
      const gw = raw.gateway || {}
      setGatewayStats({
        connected: gw.connected ?? false,
        latency: gw.latencyMs ?? 0,
        pending: gw.pendingRequests ?? 0,
        uptime: (gw.uptime ?? 0) / 1000,
        buffers: gw.streamBuffers ?? 0,
      })
    } catch (err) {
      console.error('Failed to fetch gateway stats:', err)
    }
  }, [])

  const fetchPermissions = useCallback(async () => {
    try {
      const res = await authedFetch('/api/metrics/permissions')
      const raw = await res.json()
      if (!raw.success || !raw.data?.permissions) return
      setPermissions(raw.data.permissions)
    } catch (err) {
      console.error('Failed to fetch permissions:', err)
    }
  }, [])

  const fetchIntegrations = useCallback(async () => {
    try {
      const res = await authedFetch('/api/integrations/config')
      const raw = await res.json()
      if (!raw.success || !raw.integrations) return
      setIntegrations(raw.integrations || [])
    } catch (err) {
      console.error('Failed to fetch integrations:', err)
    }
  }, [])

  useEffect(() => {
    fetchMetrics().then(() => setLoading(false))
  }, [fetchMetrics])

  useVisibilityInterval(fetchMetrics, 10000, [fetchMetrics])
  useVisibilityInterval(fetchGatewayStats, 10000, [fetchGatewayStats])
  useVisibilityInterval(fetchPermissions, 30000, [fetchPermissions])
  useVisibilityInterval(fetchIntegrations, 60000, [fetchIntegrations])

  const formatUptime = (seconds: number): string => {
    if (seconds < 60) return `${Math.floor(seconds)}s`
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    return `${hours}h${minutes}m`
  }

  const formatPercent = (value: number): string => {
    return `${(value * 100).toFixed(1)}%`
  }

  const getTimeSince = (timestampMs: number): string => {
    const seconds = Math.floor((Date.now() - timestampMs) / 1000)
    if (seconds < 60) return 'just now'
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
    return `${Math.floor(seconds / 86400)}d ago`
  }

  const getTodayMessages = (deptId: string): number => {
    const deptMetrics = metrics?.departments.find(d => d.id === deptId)
    if (!deptMetrics) return 0
    // For simplicity, we'll use total messages as approximation
    // In production, you'd filter by timestamp
    return deptMetrics.messages
  }

  const handleBroadcast = () => {
    // Trigger broadcast to all departments
    const message = prompt('Enter message to broadcast to all departments:')
    if (message) {
      authedFetch('/api/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message })
      }).then(() => alert('Broadcast sent!'))
        .catch(() => alert('Broadcast failed'))
    }
  }

  const handleStartMeeting = () => {
    alert('Meeting feature coming soon!')
  }

  const handleCreateWorkflow = () => {
    alert('Please use the Workflow tab to create workflows')
  }

  // Chart components
  const SVGBarChart = ({ data }: { data: DailyData[] }) => {
    if (!data.length) return null
    const maxMessages = Math.max(...data.map(d => d.messages), 1)
    return (
      <svg viewBox="0 0 300 100" style={{ width: '100%', height: '100px' }}>
        {data.map((d, i) => {
          const x = (i / data.length) * 300
          const w = 300 / data.length - 4
          const h1 = (d.messages / maxMessages) * 80
          const h2 = (d.errors / maxMessages) * 80
          return (
            <g key={d.date}>
              <rect x={x} y={100 - h1} width={w} height={h1} fill="#00d4aa" />
              <rect x={x} y={100 - h2} width={w} height={h2} fill="#ff4466" />
              <title>{d.date}: {d.messages} messages, {d.errors} errors</title>
            </g>
          )
        })}
      </svg>
    )
  }

  const SVGLineChart = ({ data }: { data: DailyData[] }) => {
    if (!data.length) return null
    const maxTime = Math.max(...data.map(d => d.avgResponseMs), 1)
    const points = data.map((d, i) => {
      const x = (i / (data.length - 1)) * 280 + 10
      const y = 90 - (d.avgResponseMs / maxTime) * 70
      return `${x},${y}`
    }).join(' ')
    return (
      <svg viewBox="0 0 300 100" style={{ width: '100%', height: '100px' }}>
        <polyline points={points} fill="none" stroke="#ffbb00" strokeWidth="2" />
        {data.map((d, i) => {
          const x = (i / (data.length - 1)) * 280 + 10
          const y = 90 - (d.avgResponseMs / maxTime) * 70
          return <circle key={d.date} cx={x} cy={y} r="3" fill="#ffbb00"><title>{d.date}: {Math.round(d.avgResponseMs)}ms</title></circle>
        })}
      </svg>
    )
  }

  const SVGStackedArea = ({ data }: { data: DailyData[] }) => {
    if (!data.length) return null
    const maxTokens = Math.max(...data.map(d => d.tokens.input + d.tokens.output), 1)
    const inputPath = data.map((d, i) => {
      const x = (i / (data.length - 1)) * 280 + 10
      const y = 90 - (d.tokens.input / maxTokens) * 70
      return i === 0 ? `M${x},${y}` : `L${x},${y}`
    }).join(' ') + ` L290,90 L10,90 Z`
    const totalPath = data.map((d, i) => {
      const x = (i / (data.length - 1)) * 280 + 10
      const y = 90 - ((d.tokens.input + d.tokens.output) / maxTokens) * 70
      return i === 0 ? `M${x},${y}` : `L${x},${y}`
    }).join(' ') + ` L290,90 L10,90 Z`
    return (
      <svg viewBox="0 0 300 100" style={{ width: '100%', height: '100px' }}>
        <path d={totalPath} fill="#00a8ff" opacity="0.6" />
        <path d={inputPath} fill="#00e5ff" opacity="0.6" />
      </svg>
    )
  }

  if (loading) {
    return (
      <div className="dashboard">
        <div className="dashboard-loading">{t('common.loading')}</div>
      </div>
    )
  }

  if (!metrics || metrics.totalMessages === 0) {
    return (
      <div className="dashboard">
        <div className="dashboard-empty">
          <p>{t('dashboard.noData')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h2>{t('dashboard.title')}</h2>
      </div>

      {/* Quick Action Buttons */}
      <div className="dashboard-quick-actions">
        <button className="quick-action-btn broadcast" onClick={handleBroadcast}>
          <span className="action-icon">📢</span>
          <span className="action-label">{t('dashboard.action.broadcast')}</span>
        </button>
        <button className="quick-action-btn meeting" onClick={handleStartMeeting}>
          <span className="action-icon">👥</span>
          <span className="action-label">{t('dashboard.action.meeting')}</span>
        </button>
        <button className="quick-action-btn workflow" onClick={handleCreateWorkflow}>
          <span className="action-icon">⚙️</span>
          <span className="action-label">{t('dashboard.action.workflow')}</span>
        </button>
      </div>

      {/* Global Stats Row */}
      <div className="dashboard-stats-row">
        <div className="dashboard-stat-card">
          <div className="dashboard-stat-value">{metrics.totalMessages}</div>
          <div className="dashboard-stat-label">{t('dashboard.stat.messages')}</div>
        </div>
        <div className="dashboard-stat-card">
          <div className="dashboard-stat-value">{Math.round(metrics.avgResponseTime)}ms</div>
          <div className="dashboard-stat-label">{t('dashboard.stat.avgResponse')}</div>
        </div>
        <div className="dashboard-stat-card">
          <div className="dashboard-stat-value">{formatPercent(metrics.errorRate)}</div>
          <div className="dashboard-stat-label">{t('dashboard.stat.errorRate')}</div>
        </div>
        <div className="dashboard-stat-card">
          <div className="dashboard-stat-value">{formatUptime(metrics.uptime)}</div>
          <div className="dashboard-stat-label">{t('dashboard.stat.uptime')}</div>
        </div>
      </div>

      {/* System Status Panel */}
      <div className="dashboard-system-status">
        <h3>{t('dashboard.system.title')}</h3>
        <div className="system-status-grid">
          <div className="status-item">
            <span className="status-label">{t('dashboard.system.gateway')}:</span>
            <span className={`status-value ${gatewayStats?.connected ? 'healthy' : 'error'}`}>
              {gatewayStats?.connected ? t('dashboard.gateway.connected') : t('dashboard.gateway.disconnected')}
            </span>
          </div>
          <div className="status-item">
            <span className="status-label">{t('dashboard.system.integrations')}:</span>
            <span className="status-value healthy">
              {integrations.filter(i => i.enabled).length}/{integrations.length} {t('dashboard.system.active')}
            </span>
          </div>
          <div className="status-item">
            <span className="status-label">{t('dashboard.stat.uptime')}:</span>
            <span className="status-value">{formatUptime(metrics.uptime)}</span>
          </div>
        </div>
      </div>

      {/* Gateway Stats */}
      {gatewayStats && (
        <div className="dashboard-gateway">
          <h3>{t('dashboard.gateway.title')}</h3>
          <div className="dashboard-gateway-grid">
            <div className="gateway-stat">
              <span className={`gateway-status ${gatewayStats.connected ? 'connected' : 'disconnected'}`}>
                {gatewayStats.connected ? t('dashboard.gateway.connected') : t('dashboard.gateway.disconnected')}
              </span>
            </div>
            <div className="gateway-stat">
              <span className="gateway-label">{t('dashboard.gateway.latency')}:</span>
              <span className="gateway-value">{gatewayStats.latency}ms</span>
            </div>
            <div className="gateway-stat">
              <span className="gateway-label">{t('dashboard.gateway.pending')}:</span>
              <span className="gateway-value">{gatewayStats.pending}</span>
            </div>
            <div className="gateway-stat">
              <span className="gateway-label">{t('dashboard.gateway.uptime')}:</span>
              <span className="gateway-value">{formatUptime(gatewayStats.uptime)}</span>
            </div>
            <div className="gateway-stat">
              <span className="gateway-label">{t('dashboard.gateway.buffers')}:</span>
              <span className="gateway-value">{gatewayStats.buffers}</span>
            </div>
          </div>
        </div>
      )}

      {/* Dashboard Trend Charts */}
      {dailyData.length > 0 && (
        <div className="dashboard-trends">
          <h3>趋势分析</h3>
          <div className="dashboard-trends-grid">
            <div className="trend-chart-card">
              <h4>消息量</h4>
              <SVGBarChart data={dailyData} />
            </div>
            <div className="trend-chart-card">
              <h4>响应时间</h4>
              <SVGLineChart data={dailyData} />
            </div>
            <div className="trend-chart-card">
              <h4>Token 用量</h4>
              <SVGStackedArea data={dailyData} />
            </div>
          </div>
        </div>
      )}

      {/* Department Health Cards */}
      <div className="dashboard-dept-section">
        <h3>{t('dashboard.health.title')}</h3>
        <div className="dashboard-dept-grid">
          {metrics.departments.map((deptMetrics) => {
            const dept = departments.find(d => d.id === deptMetrics.id)
            if (!dept) return null

            const maxResponseTime = Math.max(...deptMetrics.responseTimes, 1)
            const health = healthStatus[deptMetrics.id]?.status || 'healthy'

            return (
              <div key={dept.id} className={`dashboard-dept-card ${health}`}>
                <div className="dept-card-header">
                  <DeptIcon deptId={dept.id} size={16} />
                  <span className="dept-card-name" style={{ color: `var(--dept-${dept.id})` }}>
                    {dept.name}
                  </span>
                  <span className={`dept-health-badge ${health}`}>
                    {health === 'healthy' ? '✓' : health === 'warning' ? '⚠' : '✗'}
                  </span>
                </div>
                <div className="dept-card-stats">
                  <div className="dept-stat">
                    <span className="stat-icon">💬</span>
                    <span>{t('dashboard.health.today')}: {getTodayMessages(dept.id)} {t('dashboard.stat.messages').toLowerCase()}</span>
                  </div>
                  <div className="dept-stat">
                    <span className="stat-icon">⏱</span>
                    <span>{t('dashboard.health.response')}: ~{Math.round(deptMetrics.avgResponseTime)}ms</span>
                  </div>
                  {deptMetrics.errors > 0 && (
                    <div className="dept-stat error">
                      <span className="stat-icon">⚠</span>
                      <span>{deptMetrics.errors} {t('dashboard.health.errors')}</span>
                    </div>
                  )}
                </div>
                {deptMetrics.responseTimes.length > 0 && (
                  <div className="dashboard-bar-chart">
                    {deptMetrics.responseTimes.slice(-50).map((time, i) => {
                      const height = Math.max((time / maxResponseTime) * 100, 5)
                      const isError = time > metrics.avgResponseTime * 2
                      return (
                        <div
                          key={`${deptMetrics.id}-bar-${i}`}
                          className={`dashboard-bar ${isError ? 'error' : ''}`}
                          style={{ height: `${height}%` }}
                          title={`${Math.round(time)}ms`}
                        />
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Token Usage Section */}
      {metrics.tokens && (
        <div className="dashboard-tokens">
          <h3>{t('dashboard.tokens.title')} {!metrics.tokens && <span className="token-estimated">{t('dashboard.tokens.estimated')}</span>}</h3>
          <div className="token-totals">
            <div className="token-stat">
              <span className="token-label">{t('dashboard.tokens.input')}:</span>
              <span className="token-value">{metrics.tokens.total.input.toLocaleString()}</span>
            </div>
            <div className="token-stat">
              <span className="token-label">{t('dashboard.tokens.output')}:</span>
              <span className="token-value">{metrics.tokens.total.output.toLocaleString()}</span>
            </div>
            <div className="token-stat">
              <span className="token-label">{t('dashboard.tokens.total')}:</span>
              <span className="token-value total">{(metrics.tokens.total.input + metrics.tokens.total.output).toLocaleString()}</span>
            </div>
          </div>
          <div className="token-bars">
            {Object.entries(metrics.tokens.byDepartment).map(([deptId, tokens]) => {
              const dept = departments.find(d => d.id === deptId)
              if (!dept) return null

              const totalTokens = tokens.input + tokens.output
              const grandTotal = metrics.tokens!.total.input + metrics.tokens!.total.output
              const percentage = (totalTokens / grandTotal) * 100

              return (
                <div key={deptId} className="dashboard-token-bar-row">
                  <div className="token-bar-label">{dept.name}</div>
                  <div className="token-bar-container">
                    <div
                      className="dashboard-token-bar"
                      style={{
                        width: `${percentage}%`,
                        backgroundColor: `var(--dept-${deptId})`
                      }}
                    />
                  </div>
                  <div className="token-bar-value">{totalTokens.toLocaleString()}</div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Recent Permissions Section */}
      {permissions.length > 0 && (
        <div className="dashboard-permissions">
          <h3>{t('dashboard.permissions.title')}</h3>
          <div className="permissions-list">
            {permissions.slice(-20).reverse().map((p, i) => (
              <div key={`${p.deptId}-${p.toolName}-${p.timestamp}-${i}`} className="permission-item">
                <span className="permission-tool">{p.toolName}</span>
                <span className="permission-dept">{departments.find(d => d.id === p.deptId)?.name || p.deptId}</span>
                <span className="permission-time">{new Date(p.timestamp).toLocaleTimeString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
