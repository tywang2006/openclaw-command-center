import { useEffect, useState, useCallback, useMemo } from 'react'
import type { Department } from '../hooks/useAgentState'
import { DeptIcon } from './Icons'
import { useLocale } from '../i18n/index'
import { authedFetch } from '../utils/api'
import { useVisibilityInterval } from '../hooks/useVisibilityInterval'
import type { OpsModule } from '../types'
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
  onSwitchTab?: (tab: string) => void
  onNavigateModule?: (module: OpsModule) => void
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
  }[]
}

interface GatewayStats {
  connected: boolean
  latency: number
  pending: number
  uptime: number
  buffers: number
  reconnects: number
}

interface PermissionEvent {
  deptId: string
  toolName: string
  timestamp: number
}

interface AuditEntry {
  id: string
  action: string
  deptId?: string
  target?: string
  timestamp: number
}

interface SessionInfo {
  id: string
  deptId: string
  type: string
  createdAt: number
}

export default function DashboardTab({ departments, onSwitchTab, onNavigateModule }: DashboardTabProps) {
  const [metrics, setMetrics] = useState<MetricsData | null>(null)
  const [gatewayStats, setGatewayStats] = useState<GatewayStats | null>(null)
  const [permissions, setPermissions] = useState<PermissionEvent[]>([])
  const [recentAudit, setRecentAudit] = useState<AuditEntry[]>([])
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [dailyData, setDailyData] = useState<DailyData[]>([])
  const [loading, setLoading] = useState(true)
  const [showBroadcastModal, setShowBroadcastModal] = useState(false)
  const [broadcastInput, setBroadcastInput] = useState('')
  const [broadcastSending, setBroadcastSending] = useState(false)
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null)
  const { t } = useLocale()

  const fetchMetrics = useCallback(async () => {
    try {
      const res = await authedFetch('/api/metrics')
      const raw = await res.json()
      if (!raw.success) return
      const depts = Object.entries(raw.departments || {}).map(([id, d]: [string, any]) => ({
        id,
        messages: d.messageCount || 0,
        errors: d.errorCount || 0,
        avgResponseTime: d.avgResponseMs || 0,
      }))
      const g = raw.global || {}
      const totalMsgs = g.totalMessages || 0
      const totalErrors = g.totalErrors || 0
      setMetrics({
        totalMessages: totalMsgs,
        avgResponseTime: g.avgResponseMs || 0,
        errorRate: totalMsgs > 0 ? totalErrors / totalMsgs : 0,
        uptime: (raw.uptime || 0) / 1000,
        departments: depts,
      })
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
        reconnects: gw.reconnectCount ?? 0,
      })
    } catch (err) {
      console.error('Failed to fetch gateway stats:', err)
    }
  }, [])

  const fetchPermissions = useCallback(async () => {
    try {
      const res = await authedFetch('/api/metrics/permissions')
      const raw = await res.json()
      if (!raw.success || !raw.permissions) return
      setPermissions(raw.permissions)
    } catch (err) {
      console.error('Failed to fetch permissions:', err)
    }
  }, [])

  const fetchRecentAudit = useCallback(async () => {
    try {
      const res = await authedFetch('/api/audit?limit=5')
      const raw = await res.json()
      if (raw.entries) {
        setRecentAudit(raw.entries)
      }
    } catch (err) {
      console.error('Failed to fetch audit:', err)
    }
  }, [])

  const fetchSessions = useCallback(async () => {
    try {
      const res = await authedFetch('/api/system/sessions')
      const raw = await res.json()
      if (raw.sessions) {
        setSessions(raw.sessions.slice(0, 5))
      }
    } catch (err) {
      // sessions endpoint may not exist, ignore
    }
  }, [])

  useEffect(() => {
    Promise.all([fetchMetrics(), fetchGatewayStats(), fetchPermissions(), fetchRecentAudit(), fetchSessions()])
      .then(() => setLoading(false))
  }, [fetchMetrics, fetchGatewayStats, fetchPermissions, fetchRecentAudit, fetchSessions])

  useVisibilityInterval(fetchMetrics, 10000, [fetchMetrics])
  useVisibilityInterval(fetchGatewayStats, 10000, [fetchGatewayStats])
  useVisibilityInterval(fetchPermissions, 30000, [fetchPermissions])
  useVisibilityInterval(fetchRecentAudit, 15000, [fetchRecentAudit])

  useEffect(() => {
    if (statusMessage) {
      const timer = setTimeout(() => setStatusMessage(null), 3000)
      return () => clearTimeout(timer)
    }
  }, [statusMessage])

  const onlineAgents = useMemo(() =>
    departments.filter(d => d.status === 'active').length
  , [departments])

  const activeTasks = useMemo(() =>
    metrics?.departments.reduce((s, d) => s + d.messages, 0) || 0
  , [metrics])

  const formatUptime = (seconds: number): string => {
    if (seconds < 60) return `${Math.floor(seconds)}s`
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    return `${hours}h${minutes}m`
  }

  const formatPercent = (value: number): string => `${(value * 100).toFixed(1)}%`

  const getTimeSince = (ts: number): string => {
    const seconds = Math.floor((Date.now() - ts) / 1000)
    if (seconds < 60) return t('cron.time.now')
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`
    return `${Math.floor(seconds / 86400)}d`
  }

  const actionColor = (action: string): string => {
    switch (action) {
      case 'chat': return '#00d4aa'
      case 'broadcast': return '#00a8ff'
      case 'config': return '#ffbb00'
      case 'error': return '#ff4466'
      default: return '#888'
    }
  }

  const handleBroadcast = () => {
    setShowBroadcastModal(true)
    setBroadcastInput('')
  }

  const handleBroadcastSubmit = async () => {
    if (!broadcastInput.trim()) return
    setBroadcastSending(true)
    try {
      await authedFetch('/api/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: broadcastInput })
      })
      setStatusMessage({ text: t('dashboard.action.broadcast.sent'), type: 'success' })
      setShowBroadcastModal(false)
      setBroadcastInput('')
    } catch {
      setStatusMessage({ text: t('dashboard.action.broadcast.failed'), type: 'error' })
    } finally {
      setBroadcastSending(false)
    }
  }

  const handleBroadcastCancel = () => {
    setShowBroadcastModal(false)
    setBroadcastInput('')
  }

  // Mini charts — memoized to avoid full DOM rebuild on every render
  const workloadChart = useMemo(() => {
    if (!metrics?.departments.length) return null
    const maxMsgs = Math.max(...metrics.departments.map(d => d.messages), 1)
    return (
      <div className="ops-dash-workload-bars">
        {metrics.departments.map(d => {
          const dept = departments.find(dp => dp.id === d.id)
          if (!dept) return null
          const pct = (d.messages / maxMsgs) * 100
          return (
            <div key={d.id} className="ops-dash-workload-row">
              <span className="ops-dash-workload-label">{dept.name}</span>
              <div className="ops-dash-workload-track">
                <div className="ops-dash-workload-fill" style={{ width: `${pct}%`, backgroundColor: `var(--dept-${d.id})` }} />
              </div>
              <span className="ops-dash-workload-count">{d.messages}</span>
            </div>
          )
        })}
      </div>
    )
  }, [metrics?.departments, departments])

  const throughputChart = useMemo(() => {
    if (!dailyData.length) return null
    const maxMsg = Math.max(...dailyData.map(d => d.messages), 1)
    const denom = Math.max(dailyData.length - 1, 1)
    const points = dailyData.map((d, i) => {
      const x = (i / denom) * 280 + 10
      const y = 80 - (d.messages / maxMsg) * 60
      return `${x},${y}`
    }).join(' ')
    return (
      <svg viewBox="0 0 300 90" style={{ width: '100%', height: '80px' }}>
        <polyline points={points} fill="none" stroke="#00d4aa" strokeWidth="2" />
        {dailyData.map((d, i) => {
          const x = (i / denom) * 280 + 10
          const y = 80 - (d.messages / maxMsg) * 60
          return <circle key={d.date} cx={x} cy={y} r="2.5" fill="#00d4aa"><title>{d.date}: {d.messages}</title></circle>
        })}
      </svg>
    )
  }, [dailyData])

  if (loading) {
    return <div className="ops-dash-container"><div className="ops-dash-loading">{t('common.loading')}</div></div>
  }

  return (
    <div className="ops-dash-container">
      {/* Quick Actions */}
      <div className="ops-dash-actions">
        <button className="ops-dash-action-btn" onClick={handleBroadcast}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M13 3L6 6H3v4h3l7 3V3z" stroke="currentColor" strokeWidth="1.5" fill="none"/><path d="M13 6c1 1 1 3 0 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
          <span>{t('dashboard.action.broadcast')}</span>
        </button>
        <button className="ops-dash-action-btn" onClick={() => onSwitchTab?.('meeting')}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="6" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.5"/><path d="M2 13c0-2.2 1.8-4 4-4s4 1.8 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
          <span>{t('dashboard.action.meeting')}</span>
        </button>
      </div>

      {/* Row 1: Stat Cards */}
      <div className="ops-dash-stat-row">
        <div className="ops-dash-stat-card">
          <div className="ops-dash-stat-value">{onlineAgents}/{departments.length}</div>
          <div className="ops-dash-stat-label">{t('ops.dash.stat.onlineAgents')}</div>
        </div>
        <div className="ops-dash-stat-card">
          <div className="ops-dash-stat-value">{activeTasks}</div>
          <div className="ops-dash-stat-label">{t('ops.dash.stat.activeTasks')}</div>
        </div>
        <div className="ops-dash-stat-card">
          <div className="ops-dash-stat-value">{formatPercent(metrics?.errorRate || 0)}</div>
          <div className="ops-dash-stat-label">{t('dashboard.stat.errorRate')}</div>
        </div>
        <div className="ops-dash-stat-card">
          <div className="ops-dash-stat-value">{Math.round(metrics?.avgResponseTime || 0)}ms</div>
          <div className="ops-dash-stat-label">{t('dashboard.stat.avgResponse')}</div>
        </div>
      </div>

      {/* Row 2: Panels */}
      <div className="ops-dash-panel-row">
        <div className="ops-dash-panel">
          <h3>{t('ops.dash.panel.workload')}</h3>
          {workloadChart}
        </div>
        <div className="ops-dash-panel">
          <h3>{t('ops.dash.panel.throughput')}</h3>
          {throughputChart}
        </div>
        <div className="ops-dash-panel ops-dash-panel-gw">
          <h3>{t('ops.dash.panel.gateway')}</h3>
          <div className="ops-dash-gw-summary">
            <div className="ops-dash-gw-status-row">
              <span className={`ops-dash-gw-dot ${gatewayStats?.connected ? 'connected' : 'disconnected'}`} />
              <span className="ops-dash-gw-label">
                {gatewayStats?.connected ? t('dashboard.gateway.connected') : t('dashboard.gateway.disconnected')}
              </span>
            </div>
            <div className="ops-dash-gw-stats">
              <span>{t('dashboard.gateway.latency')}: {gatewayStats?.latency ?? 0}ms</span>
              <span>{t('dashboard.stat.uptime')}: {formatUptime(gatewayStats?.uptime ?? 0)}</span>
              <span>{t('dashboard.gateway.pending')}: {gatewayStats?.pending ?? 0}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Row 3: Preview Panels */}
      <div className="ops-dash-preview-row">
        {/* Pending Approvals */}
        <div className="ops-dash-preview-panel">
          <div className="ops-dash-preview-header">
            <h4>{t('ops.dash.preview.approvals')}</h4>
            <button className="ops-dash-view-all" onClick={() => onNavigateModule?.('approvals')}>
              {t('ops.dash.viewAll')} →
            </button>
          </div>
          <div className="ops-dash-preview-list">
            {permissions.length === 0 && <span className="ops-dash-preview-empty">{t('dashboard.permissions.empty')}</span>}
            {permissions.slice(-5).reverse().map((p, i) => (
              <div key={`perm-${i}`} className="ops-dash-preview-item">
                <span className="ops-dash-preview-tool">{p.toolName}</span>
                <span className="ops-dash-preview-dept">{departments.find(d => d.id === p.deptId)?.name || p.deptId}</span>
                <span className="ops-dash-preview-time">{getTimeSince(p.timestamp)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Active Sessions */}
        <div className="ops-dash-preview-panel">
          <div className="ops-dash-preview-header">
            <h4>{t('ops.dash.preview.sessions')}</h4>
            <button className="ops-dash-view-all" onClick={() => onNavigateModule?.('agents')}>
              {t('ops.dash.viewAll')} →
            </button>
          </div>
          <div className="ops-dash-preview-list">
            {sessions.length === 0 && <span className="ops-dash-preview-empty">{t('system.sessions.empty')}</span>}
            {sessions.map((s, i) => (
              <div key={`sess-${i}`} className="ops-dash-preview-item">
                <DeptIcon deptId={s.deptId} size={12} />
                <span className="ops-dash-preview-dept">{departments.find(d => d.id === s.deptId)?.name || s.deptId}</span>
                <span className="ops-dash-preview-type">{s.type}</span>
                <span className="ops-dash-preview-time">{getTimeSince(s.createdAt)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Recent Activity */}
        <div className="ops-dash-preview-panel">
          <div className="ops-dash-preview-header">
            <h4>{t('ops.dash.preview.activity')}</h4>
            <button className="ops-dash-view-all" onClick={() => onNavigateModule?.('activity')}>
              {t('ops.dash.viewAll')} →
            </button>
          </div>
          <div className="ops-dash-preview-list">
            {recentAudit.length === 0 && <span className="ops-dash-preview-empty">{t('activity.empty.title')}</span>}
            {recentAudit.map((entry, i) => (
              <div key={`audit-${i}`} className="ops-dash-preview-item">
                <span className="ops-dash-preview-badge" style={{ color: actionColor(entry.action) }}>{entry.action}</span>
                <span className="ops-dash-preview-target">{entry.target || '-'}</span>
                <span className="ops-dash-preview-time">{getTimeSince(entry.timestamp)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Broadcast Modal */}
      {showBroadcastModal && (
        <div className="dashboard-modal-overlay" onClick={handleBroadcastCancel}>
          <div className="dashboard-modal" onClick={e => e.stopPropagation()}>
            <div className="dashboard-modal-header">
              <h3>{t('dashboard.action.broadcast')}</h3>
              <button className="dashboard-modal-close" onClick={handleBroadcastCancel}>&times;</button>
            </div>
            <div className="dashboard-modal-body">
              <label className="dashboard-modal-label">{t('dashboard.action.broadcast.prompt')}</label>
              <textarea
                className="dashboard-modal-input"
                value={broadcastInput}
                onChange={e => setBroadcastInput(e.target.value)}
                placeholder={t('dashboard.action.broadcast.prompt')}
                rows={4}
                autoFocus
              />
            </div>
            <div className="dashboard-modal-footer">
              <button className="dashboard-btn-cancel" onClick={handleBroadcastCancel}>{t('common.cancel')}</button>
              <button
                className="dashboard-btn-submit"
                onClick={handleBroadcastSubmit}
                disabled={!broadcastInput.trim() || broadcastSending}
              >
                {broadcastSending ? t('common.saving') : t('dashboard.action.broadcast')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Status Message */}
      {statusMessage && (
        <div className={`dashboard-status-message ${statusMessage.type}`} onClick={() => setStatusMessage(null)}>
          <span className="status-message-text">{statusMessage.text}</span>
          <button className="status-message-close" onClick={() => setStatusMessage(null)}>&times;</button>
        </div>
      )}
    </div>
  )
}
