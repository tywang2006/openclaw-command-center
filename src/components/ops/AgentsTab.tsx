import { useState, useEffect, useCallback } from 'react'
import type { Department } from '../../hooks/useAgentState'
import { DeptIcon } from '../Icons'
import { useLocale } from '../../i18n/index'
import { authedFetch } from '../../utils/api'
import { useVisibilityInterval } from '../../hooks/useVisibilityInterval'
import './AgentsTab.css'

interface Props {
  departments: Department[]
}

interface MetricsData {
  departments: Record<string, {
    messageCount: number
    errorCount: number
    avgResponseMs: number
    tokens: { input: number; output: number; total: number }
  }>
}

interface TrustScore {
  deptId: string
  score: number
  rank: number
}

export default function AgentsTab({ departments }: Props) {
  const { t } = useLocale()
  const [metrics, setMetrics] = useState<MetricsData | null>(null)
  const [trustScores, setTrustScores] = useState<TrustScore[]>([])
  const [selectedDeptId, setSelectedDeptId] = useState<string | null>(null)
  const [personaCache, setPersonaCache] = useState<Map<string, string>>(new Map())
  const [memoryCache, setMemoryCache] = useState<Map<string, string>>(new Map())
  const [loadingPersona, setLoadingPersona] = useState<Set<string>>(new Set())
  const [loadingMemory, setLoadingMemory] = useState<Set<string>>(new Set())

  const fetchMetrics = useCallback(async () => {
    try {
      const res = await authedFetch('/api/metrics')
      if (!res.ok) return
      const json = await res.json()
      if (json.success) {
        setMetrics({ departments: json.departments || {} })
      }
    } catch (err) {
      console.error('Failed to fetch metrics:', err)
    }
  }, [])

  const fetchTrustScores = useCallback(async () => {
    try {
      const res = await authedFetch('/api/metrics/trust-scores')
      if (!res.ok) return
      const json = await res.json()
      if (json.leaderboard) {
        setTrustScores(json.leaderboard)
      }
    } catch (err) {
      console.error('Failed to fetch trust scores:', err)
    }
  }, [])

  useEffect(() => {
    fetchMetrics()
    fetchTrustScores()
  }, [fetchMetrics, fetchTrustScores])

  useVisibilityInterval(fetchMetrics, 15000)
  useVisibilityInterval(fetchTrustScores, 15000)

  const fetchPersona = useCallback(async (deptId: string) => {
    if (personaCache.has(deptId) || loadingPersona.has(deptId)) return

    setLoadingPersona(prev => new Set(prev).add(deptId))
    try {
      const res = await authedFetch(`/api/departments/${deptId}/persona`)
      const data = res.ok ? await res.json() : {}
      setPersonaCache(prev => new Map(prev).set(deptId, data.content || ''))
    } catch (err) {
      console.error(`Failed to fetch persona for ${deptId}:`, err)
      setPersonaCache(prev => new Map(prev).set(deptId, t('ops.agents.error.persona')))
    } finally {
      setLoadingPersona(prev => {
        const next = new Set(prev)
        next.delete(deptId)
        return next
      })
    }
  }, [personaCache, loadingPersona, t])

  const fetchMemory = useCallback(async (deptId: string) => {
    if (memoryCache.has(deptId) || loadingMemory.has(deptId)) return

    setLoadingMemory(prev => new Set(prev).add(deptId))
    try {
      const res = await authedFetch(`/api/departments/${deptId}/memory`)
      const data = res.ok ? await res.json() : {}
      setMemoryCache(prev => new Map(prev).set(deptId, data.content || ''))
    } catch (err) {
      console.error(`Failed to fetch memory for ${deptId}:`, err)
      setMemoryCache(prev => new Map(prev).set(deptId, t('ops.agents.error.memory')))
    } finally {
      setLoadingMemory(prev => {
        const next = new Set(prev)
        next.delete(deptId)
        return next
      })
    }
  }, [memoryCache, loadingMemory, t])

  const handleRowClick = useCallback((deptId: string) => {
    if (selectedDeptId === deptId) {
      setSelectedDeptId(null)
    } else {
      setSelectedDeptId(deptId)
      fetchPersona(deptId)
      fetchMemory(deptId)
    }
  }, [selectedDeptId, fetchPersona, fetchMemory])

  const getDepartmentStatus = (dept: Department): 'active' | 'idle' | 'offline' => {
    const deptMetrics = metrics?.departments[dept.id]
    if (!deptMetrics || !deptMetrics.messageCount) return 'offline'
    // Use dept.status from WebSocket state if available
    if (dept.status === 'active') return 'active'
    if (dept.status === 'idle') return 'idle'
    return deptMetrics.messageCount > 0 ? 'idle' : 'offline'
  }

  const getTrustScore = (deptId: string): number => {
    const score = trustScores.find(s => s.deptId === deptId)
    return score?.score ?? 50
  }

  const formatErrors = (count: number): string => {
    return count > 0 ? `${count}` : '-'
  }

  return (
    <div className="ops-agents-container">
      <div className="ops-agents-header">
        <h2>{t('ops.agents.title')}</h2>
        <div className="ops-agents-stats">
          <span>{t('ops.agents.total')}: {departments.length}</span>
        </div>
      </div>

      <div className="ops-agents-list">
        {departments.map(dept => {
          const status = getDepartmentStatus(dept)
          const trustScore = getTrustScore(dept.id)
          const deptMetrics = metrics?.departments[dept.id]
          const isSelected = selectedDeptId === dept.id

          return (
            <div key={dept.id}>
              <div
                className={`ops-agents-row ${isSelected ? 'selected' : ''}`}
                onClick={() => handleRowClick(dept.id)}
              >
                <div className="ops-agents-info">
                  <DeptIcon deptId={dept.id} size={16} />
                  <span className="ops-agents-name">{dept.name}</span>
                  <span className={`ops-agents-status ops-agents-status-${status}`}>
                    {t(`ops.agents.status.${status}`)}
                  </span>
                </div>

                <div className="ops-agents-metrics">
                  <div className="ops-agents-trust">
                    <span className="ops-agents-trust-label">{t('ops.agents.trust')}</span>
                    <div className="ops-agents-trust-bar">
                      <div
                        className="ops-agents-trust-fill"
                        style={{ width: `${trustScore}%` }}
                      />
                    </div>
                    <span className="ops-agents-trust-value">{trustScore}</span>
                  </div>

                  <div className="ops-agents-activity">
                    <span className="ops-agents-messages">
                      {t('ops.agents.messages')}: {deptMetrics?.messageCount ?? 0}
                    </span>
                    <span className="ops-agents-errors">
                      {t('ops.agents.errors')}: {formatErrors(deptMetrics?.errorCount ?? 0)}
                    </span>
                  </div>
                </div>
              </div>

              {isSelected && (
                <div className="ops-agents-detail">
                  <div className="ops-agents-detail-section">
                    <h3>{t('ops.agents.persona')}</h3>
                    <div className="ops-agents-persona-preview">
                      {loadingPersona.has(dept.id)
                        ? t('ops.agents.loading')
                        : personaCache.get(dept.id) || t('ops.agents.noData')}
                    </div>
                  </div>

                  <div className="ops-agents-detail-section">
                    <h3>{t('ops.agents.memory')}</h3>
                    <div className="ops-agents-memory-preview">
                      {loadingMemory.has(dept.id)
                        ? t('ops.agents.loading')
                        : memoryCache.get(dept.id) || t('ops.agents.noData')}
                    </div>
                  </div>

                  {deptMetrics && (
                    <div className="ops-agents-detail-section">
                      <h3>{t('ops.agents.performance')}</h3>
                      <div className="ops-agents-perf-grid">
                        <div className="ops-agents-perf-item">
                          <span className="ops-agents-perf-label">{t('ops.agents.avgResponse')}</span>
                          <span className="ops-agents-perf-value">
                            {deptMetrics.avgResponseMs ? `${deptMetrics.avgResponseMs.toFixed(0)}ms` : '-'}
                          </span>
                        </div>
                        <div className="ops-agents-perf-item">
                          <span className="ops-agents-perf-label">{t('ops.agents.errors')}</span>
                          <span className="ops-agents-perf-value">
                            {deptMetrics.errorCount || 0}
                          </span>
                        </div>
                        <div className="ops-agents-perf-item">
                          <span className="ops-agents-perf-label">{t('ops.agents.tokens.input')}</span>
                          <span className="ops-agents-perf-value">
                            {deptMetrics.tokens?.input?.toLocaleString() ?? 0}
                          </span>
                        </div>
                        <div className="ops-agents-perf-item">
                          <span className="ops-agents-perf-label">{t('ops.agents.tokensOutput')}</span>
                          <span className="ops-agents-perf-value">
                            {deptMetrics.tokens?.output?.toLocaleString() ?? 0}
                          </span>
                        </div>
                        <div className="ops-agents-perf-item">
                          <span className="ops-agents-perf-label">{t('ops.agents.totalTokens')}</span>
                          <span className="ops-agents-perf-value">
                            {deptMetrics.tokens?.total?.toLocaleString() ?? 0}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
