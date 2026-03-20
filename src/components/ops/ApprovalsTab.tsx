import { useState, useCallback, useMemo } from 'react'
import type { Department } from '../../hooks/useAgentState'
import { DeptIcon } from '../Icons'
import { useLocale } from '../../i18n/index'
import { authedFetch } from '../../utils/api'
import { useVisibilityInterval } from '../../hooks/useVisibilityInterval'
import './ApprovalsTab.css'

interface Permission {
  deptId: string
  toolName: string
  timestamp: number
}

interface PermissionsData {
  permissions: Permission[]
}

interface ApprovalsTabProps {
  departments: Department[]
}

type ViewMode = 'events' | 'by-tool'

export default function ApprovalsTab({ departments }: ApprovalsTabProps) {
  const { t } = useLocale()
  const [permissions, setPermissions] = useState<Permission[]>([])
  const [viewMode, setViewMode] = useState<ViewMode>('events')

  const fetchPermissions = useCallback(async () => {
    try {
      const res = await authedFetch('/api/metrics/permissions')
      if (!res.ok) return
      const json = await res.json()
      if (json.success && json.permissions) {
        setPermissions(json.permissions)
      }
    } catch (err) {
      console.error('Failed to fetch permissions:', err)
    }
  }, [])

  useVisibilityInterval(fetchPermissions, 30000)

  const stats = useMemo(() => {
    const total = permissions.length
    const uniqueTools = new Set(permissions.map(p => p.toolName)).size

    const toolCounts = new Map<string, number>()
    permissions.forEach(p => {
      toolCounts.set(p.toolName, (toolCounts.get(p.toolName) || 0) + 1)
    })

    let mostRequested = '-'
    let maxCount = 0
    toolCounts.forEach((count, tool) => {
      if (count > maxCount) {
        maxCount = count
        mostRequested = tool
      }
    })

    const oneHourAgo = Date.now() - 3600000
    const recentCount = permissions.filter(p => p.timestamp > oneHourAgo).length

    return { total, uniqueTools, mostRequested, recentCount }
  }, [permissions])

  const toolAggregation = useMemo(() => {
    const toolCounts = new Map<string, number>()
    permissions.forEach(p => {
      toolCounts.set(p.toolName, (toolCounts.get(p.toolName) || 0) + 1)
    })

    const items = Array.from(toolCounts.entries())
      .map(([tool, count]) => ({ tool, count }))
      .sort((a, b) => b.count - a.count)

    const maxCount = items.length > 0 ? items[0].count : 1

    return { items, maxCount }
  }, [permissions])

  const getDeptName = useCallback((deptId: string) => {
    const dept = departments.find(d => d.id === deptId)
    return dept?.name || deptId
  }, [departments])

  const formatTimestamp = useCallback((ts: number) => {
    const date = new Date(ts)
    const now = new Date()
    const isToday = date.toDateString() === now.toDateString()

    if (isToday) {
      return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    }
    return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  }, [])

  return (
    <div className="ops-approvals-container">
      <div className="ops-approvals-note">
        {t('ops.approvals.note')}
      </div>

      <div className="ops-approvals-stats">
        <div className="ops-approvals-stat">
          <div className="ops-approvals-stat-value">{stats.total}</div>
          <div className="ops-approvals-stat-label">{t('ops.approvals.stats.total')}</div>
        </div>
        <div className="ops-approvals-stat">
          <div className="ops-approvals-stat-value">{stats.uniqueTools}</div>
          <div className="ops-approvals-stat-label">{t('ops.approvals.stats.uniqueTools')}</div>
        </div>
        <div className="ops-approvals-stat">
          <div className="ops-approvals-stat-value">{stats.mostRequested}</div>
          <div className="ops-approvals-stat-label">{t('ops.approvals.stats.mostRequested')}</div>
        </div>
        <div className="ops-approvals-stat">
          <div className="ops-approvals-stat-value">{stats.recentCount}</div>
          <div className="ops-approvals-stat-label">{t('ops.approvals.stats.lastHour')}</div>
        </div>
      </div>

      <div className="ops-approvals-tabs">
        <button
          className={viewMode === 'events' ? 'active' : ''}
          onClick={() => setViewMode('events')}
        >
          {t('ops.approvals.tabs.events')}
        </button>
        <button
          className={viewMode === 'by-tool' ? 'active' : ''}
          onClick={() => setViewMode('by-tool')}
        >
          {t('ops.approvals.tabs.byTool')}
        </button>
      </div>

      {viewMode === 'events' && (
        <div className="ops-approvals-list">
          {permissions.length === 0 && (
            <div className="ops-approvals-empty">
              {t('ops.approvals.empty')}
            </div>
          )}
          {permissions.map((perm, idx) => (
            <div key={idx} className="ops-approvals-event">
              <div className="ops-approvals-event-dept">
                <DeptIcon deptId={perm.deptId} size={14} />
                <span className="ops-approvals-event-dept-name">
                  {getDeptName(perm.deptId)}
                </span>
              </div>
              <div className="ops-approvals-tool-badge">
                {perm.toolName}
              </div>
              <div className="ops-approvals-event-time">
                {formatTimestamp(perm.timestamp)}
              </div>
            </div>
          ))}
        </div>
      )}

      {viewMode === 'by-tool' && (
        <div className="ops-approvals-by-tool">
          {toolAggregation.items.length === 0 && (
            <div className="ops-approvals-empty">
              {t('ops.approvals.empty')}
            </div>
          )}
          {toolAggregation.items.map(item => {
            const percentage = (item.count / toolAggregation.maxCount) * 100
            return (
              <div key={item.tool} className="ops-approvals-bar-row">
                <div className="ops-approvals-bar-label">{item.tool}</div>
                <div className="ops-approvals-bar-container">
                  <div
                    className="ops-approvals-bar"
                    style={{ width: `${percentage}%` }}
                  />
                </div>
                <div className="ops-approvals-bar-value">{item.count}</div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
