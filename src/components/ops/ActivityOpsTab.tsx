import { useState, useEffect, useCallback } from 'react'
import type { Department } from '../../hooks/useAgentState'
import { DeptIcon } from '../Icons'
import { useLocale } from '../../i18n/index'
import { authedFetch } from '../../utils/api'
import './ActivityOpsTab.css'

interface AuditEntry {
  id: string
  action: string
  deptId: string | null
  target: string
  details: string
  timestamp: string
}

interface AuditStats {
  total: number
  recentHour: number
  topActions: Array<{ action: string; count: number }>
}

interface Props {
  departments: Department[]
}

const ACTION_COLORS: Record<string, string> = {
  chat: '#00d4aa',
  broadcast: '#00a8ff',
  config: '#ffbb00',
  error: '#ff4466',
  cron: '#9966ff',
  meeting: '#00d4aa',
  system: '#888'
}

const ACTION_OPTIONS = [
  'all',
  'chat',
  'broadcast',
  'config',
  'error',
  'cron',
  'meeting',
  'system'
]

export default function ActivityOpsTab({ departments }: Props) {
  const { t } = useLocale()
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [stats, setStats] = useState<AuditStats | null>(null)
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(false)
  const [filterAction, setFilterAction] = useState('all')
  const [filterDept, setFilterDept] = useState('all')
  const [exporting, setExporting] = useState(false)

  const fetchEntries = useCallback(async (currentOffset: number, append = false) => {
    setLoading(true)
    try {
      let url = `/api/audit?limit=50&offset=${currentOffset}`
      if (filterAction !== 'all') {
        url += `&action=${filterAction}`
      }
      if (filterDept !== 'all') {
        url += `&deptId=${filterDept}`
      }

      const res = await authedFetch(url)
      const json = await res.json()

      if (json.entries) {
        if (append) {
          setEntries(prev => [...prev, ...json.entries])
        } else {
          setEntries(json.entries)
        }
        setTotal(json.total || 0)
      }
    } catch (err) {
      console.error('Failed to fetch audit entries:', err)
    } finally {
      setLoading(false)
    }
  }, [filterAction, filterDept])

  const fetchStats = useCallback(async () => {
    try {
      const res = await authedFetch('/api/audit/stats')
      const json = await res.json()

      const topActions = Object.entries(json.byAction || {})
        .map(([action, count]) => ({ action, count: count as number }))
        .sort((a, b) => b.count - a.count)
      setStats({
        total: json.totalEntries || 0,
        recentHour: json.recentHour || 0,
        topActions,
      })
    } catch (err) {
      console.error('Failed to fetch audit stats:', err)
    }
  }, [])

  useEffect(() => {
    fetchEntries(0, false)
    fetchStats()
  }, [fetchEntries, fetchStats])

  useEffect(() => {
    setOffset(0)
    fetchEntries(0, false)
  }, [filterAction, filterDept, fetchEntries])

  const handleLoadMore = () => {
    const newOffset = offset + 50
    setOffset(newOffset)
    fetchEntries(newOffset, true)
  }

  const handleExport = async () => {
    setExporting(true)
    try {
      let url = '/api/audit/export'
      const params = new URLSearchParams()
      if (filterAction !== 'all') {
        params.append('action', filterAction)
      }
      if (filterDept !== 'all') {
        params.append('deptId', filterDept)
      }
      if (params.toString()) {
        url += `?${params.toString()}`
      }

      const res = await authedFetch(url)
      const blob = await res.blob()

      const downloadUrl = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = downloadUrl
      a.download = `audit-${Date.now()}.csv`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      window.URL.revokeObjectURL(downloadUrl)
    } catch (err) {
      console.error('Failed to export audit log:', err)
    } finally {
      setExporting(false)
    }
  }

  const formatTimestamp = (ts: string): string => {
    const date = new Date(ts)
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    const minutes = Math.floor(diff / 60000)

    if (minutes < 1) return t('ops.activity.time.now')
    if (minutes < 60) return t('ops.activity.time.minutes', { n: minutes })

    const hours = Math.floor(minutes / 60)
    if (hours < 24) return t('ops.activity.time.hours', { n: hours })

    const days = Math.floor(hours / 24)
    if (days < 7) return t('ops.activity.time.days', { n: days })

    return date.toLocaleString()
  }

  const getActionColor = (action: string): string => {
    return ACTION_COLORS[action] || ACTION_COLORS.system
  }

  const getDeptName = (deptId: string | null): string => {
    if (!deptId) return t('ops.activity.dept.system')
    const dept = departments.find(d => d.id === deptId)
    return dept?.name || deptId
  }

  return (
    <div className="ops-activity-container">
      <div className="ops-activity-header">
        <h2>{t('ops.activity.title')}</h2>
        <button
          className="ops-activity-export"
          onClick={handleExport}
          disabled={exporting}
        >
          {exporting ? t('ops.activity.exporting') : t('ops.activity.export')}
        </button>
      </div>

      {stats && (
        <div className="ops-activity-stats">
          <div className="ops-activity-stat">
            <div className="ops-activity-stat-value">{stats.total}</div>
            <div className="ops-activity-stat-label">{t('ops.activity.stats.total')}</div>
          </div>
          <div className="ops-activity-stat">
            <div className="ops-activity-stat-value">{stats.recentHour}</div>
            <div className="ops-activity-stat-label">{t('ops.activity.stats.recent')}</div>
          </div>
          <div className="ops-activity-stat">
            <div className="ops-activity-stat-value">
              {stats.topActions[0]?.action || '-'}
            </div>
            <div className="ops-activity-stat-label">{t('ops.activity.stats.top')}</div>
          </div>
        </div>
      )}

      <div className="ops-activity-filters">
        <div className="ops-activity-filter-group">
          <label>{t('ops.activity.filter.action')}</label>
          <select
            value={filterAction}
            onChange={(e) => setFilterAction(e.target.value)}
          >
            {ACTION_OPTIONS.map(action => (
              <option key={action} value={action}>
                {t(`ops.activity.actions.${action}`)}
              </option>
            ))}
          </select>
        </div>

        <div className="ops-activity-filter-group">
          <label>{t('ops.activity.filter.dept')}</label>
          <select
            value={filterDept}
            onChange={(e) => setFilterDept(e.target.value)}
          >
            <option value="all">{t('ops.activity.dept.all')}</option>
            {departments.map(dept => (
              <option key={dept.id} value={dept.id}>
                {dept.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="ops-activity-list">
        {entries.map(entry => (
          <div key={entry.id} className="ops-activity-entry">
            <div className="ops-activity-time">
              {formatTimestamp(entry.timestamp)}
            </div>
            <div
              className="ops-activity-badge"
              style={{ backgroundColor: getActionColor(entry.action) }}
            >
              {entry.action}
            </div>
            <div className="ops-activity-target">
              {entry.target}
            </div>
            {entry.deptId && (
              <div className="ops-activity-dept">
                <DeptIcon deptId={entry.deptId} size={16} />
                <span>{getDeptName(entry.deptId)}</span>
              </div>
            )}
          </div>
        ))}

        {entries.length === 0 && !loading && (
          <div className="ops-activity-empty">
            {t('ops.activity.empty')}
          </div>
        )}

        {loading && (
          <div className="ops-activity-loading">
            {t('ops.activity.loading')}
          </div>
        )}
      </div>

      {entries.length < total && (
        <div className="ops-activity-load-more">
          <button onClick={handleLoadMore} disabled={loading}>
            {t('ops.activity.loadMore')} ({entries.length} / {total})
          </button>
        </div>
      )}
    </div>
  )
}
