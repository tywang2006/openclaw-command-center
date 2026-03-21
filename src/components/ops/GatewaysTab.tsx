import { useState, useCallback } from 'react'
import { useLocale } from '../../i18n/index'
import { authedFetch } from '../../utils/api'
import { useVisibilityInterval } from '../../hooks/useVisibilityInterval'
import './GatewaysTab.css'

interface GatewayStats {
  connected: boolean
  latencyMs: number
  pendingRequests: number
  uptime: number
  streamBuffers: number
  reconnectCount: number
  protocol: number
}

interface Device {
  id: string
  name: string
  mode: string
  protocol: number
  tokenPreview?: string
}

interface GatewayStatsResponse {
  success: boolean
  gateway: GatewayStats
}

interface DevicesResponse {
  devices: Device[]
}

interface MetricsResponse {
  global?: {
    gatewayReconnects?: number
  }
  [key: string]: unknown
}

const formatUptime = (ms: number): string => {
  const hours = Math.floor(ms / 3600000)
  const minutes = Math.floor((ms % 3600000) / 60000)
  if (hours === 0) return `${minutes}m`
  return `${hours}h ${minutes}m`
}

const maskToken = (token: string): string => {
  if (!token) return '****'
  if (token.length <= 4) return '****'
  return `${token.slice(0, 4)}****`
}

export default function GatewaysTab() {
  const { t } = useLocale()
  const [gatewayStats, setGatewayStats] = useState<GatewayStats | null>(null)
  const [devices, setDevices] = useState<Device[]>([])
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    try {
      const [statsResponse, devicesResponse, metricsResponse] = await Promise.all([
        authedFetch('/api/gateway/stats'),
        authedFetch('/api/system/devices'),
        authedFetch('/api/metrics')
      ])

      const statsJson = statsResponse.ok ? await statsResponse.json() as { success?: boolean; gateway?: GatewayStats } : null
      const devicesJson = devicesResponse.ok ? await devicesResponse.json() as DevicesResponse : null
      const metricsJson = metricsResponse.ok ? await metricsResponse.json() as MetricsResponse : null

      if (statsJson?.success && statsJson.gateway) {
        const stats = { ...statsJson.gateway }

        // Merge reconnect count from metrics if available
        const reconnects = metricsJson?.global?.gatewayReconnects
        if (reconnects !== undefined) {
          stats.reconnectCount = reconnects
        }

        setGatewayStats(stats)
      }

      if (devicesJson?.devices) {
        setDevices(devicesJson.devices)
      }
    } catch (error) {
      console.error('Failed to fetch gateway data:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useVisibilityInterval(fetchData, 10000)

  if (loading && !gatewayStats) {
    return (
      <div className="ops-gw-container">
        <div className="ops-gw-loading">{t('ops.gw.loading')}</div>
      </div>
    )
  }

  return (
    <div className="ops-gw-container">
      <div className="ops-gw-hero">
        <div className="ops-gw-status-wrapper">
          <div
            className={`ops-gw-indicator ${gatewayStats?.connected ? 'ops-gw-indicator-connected' : 'ops-gw-indicator-disconnected'}`}
          />
          <div className="ops-gw-status-text">
            {gatewayStats?.connected ? t('ops.gw.connected') : t('ops.gw.disconnected')}
          </div>
        </div>
        {gatewayStats?.connected && (
          <div className="ops-gw-hero-stats">
            <div className="ops-gw-hero-stat">
              <span className="ops-gw-hero-value">{gatewayStats.latencyMs}ms</span>
              <span className="ops-gw-hero-label">{t('ops.gw.latency')}</span>
            </div>
            <div className="ops-gw-hero-divider" />
            <div className="ops-gw-hero-stat">
              <span className="ops-gw-hero-value">{formatUptime(gatewayStats.uptime)}</span>
              <span className="ops-gw-hero-label">{t('ops.gw.uptime')}</span>
            </div>
          </div>
        )}
      </div>

      <div className="ops-gw-section">
        <div className="ops-gw-section-title">{t('ops.gw.statsTitle')}</div>
        <div className="ops-gw-stats-grid">
          <div className="ops-gw-stat-card">
            <div className="ops-gw-stat-value">{gatewayStats?.pendingRequests ?? 0}</div>
            <div className="ops-gw-stat-label">{t('ops.gw.pendingRequests')}</div>
          </div>
          <div className="ops-gw-stat-card">
            <div className="ops-gw-stat-value">{gatewayStats?.streamBuffers ?? 0}</div>
            <div className="ops-gw-stat-label">{t('ops.gw.streamBuffers')}</div>
          </div>
          <div className="ops-gw-stat-card">
            <div className="ops-gw-stat-value">{gatewayStats?.reconnectCount ?? 0}</div>
            <div className="ops-gw-stat-label">{t('ops.gw.reconnectCount')}</div>
          </div>
          <div className="ops-gw-stat-card">
            <div className="ops-gw-stat-value">v{gatewayStats?.protocol ?? 3}</div>
            <div className="ops-gw-stat-label">{t('ops.gw.protocol')}</div>
          </div>
        </div>
      </div>

      <div className="ops-gw-section">
        <div className="ops-gw-section-title">{t('ops.gw.devicesTitle')}</div>
        {devices.length === 0 ? (
          <div className="ops-gw-empty">{t('ops.gw.noDevices')}</div>
        ) : (
          <div className="ops-gw-devices">
            {devices.map((device) => (
              <div key={device.id} className="ops-gw-device-row">
                <div className="ops-gw-device-main">
                  <div className="ops-gw-device-name">{device.name}</div>
                  <div className="ops-gw-device-id">{device.id}</div>
                </div>
                <div className="ops-gw-device-info">
                  <span className="ops-gw-mode-badge">{device.mode}</span>
                  <span className="ops-gw-device-protocol">P{device.protocol}</span>
                  <span className="ops-gw-device-token">{device.tokenPreview || '****'}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="ops-gw-note">{t('ops.gw.editNote')}</div>
    </div>
  )
}
