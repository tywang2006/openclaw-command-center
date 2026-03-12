import { useEffect, useState, useCallback } from 'react'
import type { Department } from '../hooks/useAgentState'
import { DeptIcon } from './Icons'
import { useLocale } from '../i18n/index'
import { authedFetch } from '../utils/api'
import { useVisibilityInterval } from '../hooks/useVisibilityInterval'
import './DashboardTab.css'

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

export default function DashboardTab({ departments }: DashboardTabProps) {
  const [metrics, setMetrics] = useState<MetricsData | null>(null)
  const [gatewayStats, setGatewayStats] = useState<GatewayStats | null>(null)
  const [permissions, setPermissions] = useState<PermissionEvent[]>([])
  const [loading, setLoading] = useState(true)
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

  useEffect(() => {
    fetchMetrics().then(() => setLoading(false))
  }, [fetchMetrics])

  useVisibilityInterval(fetchMetrics, 10000, [fetchMetrics])
  useVisibilityInterval(fetchGatewayStats, 10000, [fetchGatewayStats])
  useVisibilityInterval(fetchPermissions, 30000, [fetchPermissions])

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

      {/* Per-Department Cards */}
      <div className="dashboard-dept-section">
        <h3>{t('dashboard.title')}</h3>
        <div className="dashboard-dept-grid">
          {metrics.departments.map((deptMetrics) => {
            const dept = departments.find(d => d.id === deptMetrics.id)
            if (!dept) return null

            const maxResponseTime = Math.max(...deptMetrics.responseTimes, 1)

            return (
              <div key={dept.id} className="dashboard-dept-card">
                <div className="dept-card-header">
                  <DeptIcon deptId={dept.id} size={16} />
                  <span className="dept-card-name" style={{ color: `var(--dept-${dept.id})` }}>
                    {dept.name}
                  </span>
                </div>
                <div className="dept-card-stats">
                  <div className="dept-stat">{t('dashboard.dept.messages', { count: deptMetrics.messages })}</div>
                  {deptMetrics.errors > 0 && (
                    <div className="dept-stat error">{t('dashboard.dept.errors', { count: deptMetrics.errors })}</div>
                  )}
                  <div className="dept-stat">{t('dashboard.dept.avgMs', { ms: Math.round(deptMetrics.avgResponseTime) })}</div>
                </div>
                {deptMetrics.responseTimes.length > 0 && (
                  <div className="dashboard-bar-chart">
                    {deptMetrics.responseTimes.slice(-50).map((time, i) => {
                      const height = Math.max((time / maxResponseTime) * 100, 5)
                      const isError = time > metrics.avgResponseTime * 2
                      return (
                        <div
                          key={i}
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
              <div key={i} className="permission-item">
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
