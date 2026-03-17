import { useState, useEffect, useCallback } from 'react'
import { useLocale } from '../i18n/index'
import { authedFetch } from '../utils/api'
import { useVisibilityInterval } from '../hooks/useVisibilityInterval'
import './SystemTab.css'

interface Model {
  id: string
  name: string
  provider: string
  contextWindowFormatted: string
  maxTokensFormatted: string
  isPrimary: boolean
  isFallback: boolean
}

interface NewProviderForm {
  id: string
  baseUrl: string
  apiKey: string
  api: string
  modelId: string
  modelName: string
}

interface NewModelForm {
  id: string
  name: string
}

interface Channel {
  id: string
  name: string
  enabled: boolean
  running: boolean
}

interface Plugin {
  id: string
  name: string
  enabled: boolean
  description: string
  version: string | null
}

interface GatewayStats {
  connected: boolean
  authenticated: boolean
  pendingRequests: number
  reconnectAttempt: number
  uptime: number
  streamBuffers: number
}

interface Session {
  id: string
  name: string
  lastModified: string
  size: number
}

interface Device {
  id: string
  name: string
  mode: string
  protocol: number
  tokenPreview?: string
}

interface ProviderConfig {
  id: string
  baseUrl: string
  api: string
  hasApiKey: boolean
  apiKeyPreview: string | null
  models: { id: string; name: string }[]
}

interface SkillConfig {
  slug: string
  hasApiKey: boolean
  apiKeyPreview: string | null
}

interface TelegramConfig {
  enabled: boolean
  hasBotToken: boolean
  botTokenPreview: string | null
}

interface GatewayConfig {
  url: string
  hasToken: boolean
  tokenPreview: string | null
  clientId: string
  clientMode: string
}

export default function SystemTab() {
  const { t } = useLocale()
  const [gateway, setGateway] = useState<GatewayStats | null>(null)
  const [models, setModels] = useState<Model[]>([])
  const [channels, setChannels] = useState<Channel[]>([])
  const [plugins, setPlugins] = useState<Plugin[]>([])
  const [primary, setPrimary] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [sessions, setSessions] = useState<Session[]>([])
  const [devices, setDevices] = useState<Device[]>([])
  const [observerRunning, setObserverRunning] = useState(false)
  const [observerMsg, setObserverMsg] = useState<string | null>(null)
  const [shutdownConfirm, setShutdownConfirm] = useState(false)
  const [serverStopped, setServerStopped] = useState(false)

  // OpenClaw config state
  const [providers, setProviders] = useState<ProviderConfig[]>([])
  const [skills, setSkills] = useState<SkillConfig[]>([])
  const [telegram, setTelegram] = useState<TelegramConfig | null>(null)
  const [gwConfig, setGwConfig] = useState<GatewayConfig | null>(null)
  const [editingKeys, setEditingKeys] = useState<Record<string, string>>({})
  const [configStatus, setConfigStatus] = useState<Record<string, { type: 'ok' | 'err' | 'saving'; msg: string }>>({})
  const [fallbacks, setFallbacks] = useState<string[]>([])
  const [showAddProvider, setShowAddProvider] = useState(false)
  const [newProvider, setNewProvider] = useState<NewProviderForm>({ id: '', baseUrl: '', apiKey: '', api: 'openai-completions', modelId: '', modelName: '' })
  const [addModelFor, setAddModelFor] = useState<string | null>(null)
  const [newModel, setNewModel] = useState<NewModelForm>({ id: '', name: '' })
  const [modelStatus, setModelStatus] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [ocVersion, setOcVersion] = useState<{ current: string | null; latest: string | null; updateAvailable: boolean } | null>(null)
  const [updating, setUpdating] = useState(false)
  const [updateMsg, setUpdateMsg] = useState<string | null>(null)
  const [installing, setInstalling] = useState(false)

  const showConfigStatus = (key: string, type: 'ok' | 'err' | 'saving', msg: string) => {
    setConfigStatus(prev => ({ ...prev, [key]: { type, msg } }))
    if (type !== 'saving') {
      setTimeout(() => setConfigStatus(prev => {
        const next = { ...prev }
        delete next[key]
        return next
      }), 3000)
    }
  }

  const toggle = (section: string) => setCollapsed(prev => ({ ...prev, [section]: !prev[section] }))

  const fetchAll = useCallback(async () => {
    try {
      const [capRes, gwRes, sessRes, devRes, modelsRes, skillsRes, tgRes, gwCfgRes, ocVerRes] = await Promise.all([
        authedFetch('/api/system/capabilities'),
        authedFetch('/api/health').catch(() => null),
        authedFetch('/api/system/sessions').catch(() => null),
        authedFetch('/api/system/devices').catch(() => null),
        authedFetch('/api/system/config/models').catch(() => null),
        authedFetch('/api/system/config/skills').catch(() => null),
        authedFetch('/api/system/config/telegram').catch(() => null),
        authedFetch('/api/system/config/gateway').catch(() => null),
        authedFetch('/api/system/openclaw/version').catch(() => null),
      ])
      const cap = await capRes.json()
      const health = gwRes?.ok ? await gwRes.json() : {}

      setModels(cap.models || [])
      setChannels(cap.channels || [])
      setPlugins(cap.plugins || [])
      setPrimary(cap.models?.find((m: Model) => m.isPrimary)?.id || '')
      setGateway(health.gateway || null)

      if (sessRes?.ok) {
        const sessData = await sessRes.json()
        setSessions(sessData.sessions || [])
      }
      if (devRes?.ok) {
        const devData = await devRes.json()
        setDevices(devData.devices || [])
      }

      // OpenClaw config data
      if (modelsRes?.ok) {
        const md = await modelsRes.json()
        const provList: ProviderConfig[] = Object.entries(md.providers || {}).map(
          ([id, p]: [string, any]) => ({ id, ...p })
        )
        setProviders(provList)
        setFallbacks(md.fallbacks || [])
      }
      if (skillsRes?.ok) {
        const sd = await skillsRes.json()
        setSkills(sd.skills || [])
      }
      if (tgRes?.ok) {
        const td = await tgRes.json()
        setTelegram(td)
      }
      if (gwCfgRes?.ok) {
        const gc = await gwCfgRes.json()
        setGwConfig(gc)
      }
      if (ocVerRes?.ok) {
        const vd = await ocVerRes.json()
        setOcVersion(vd)
      }
    } catch (err) {
      console.error('Failed to fetch system data:', err)
    }
  }, [])

  useEffect(() => {
    fetchAll().then(() => setLoading(false))
  }, [fetchAll])

  useVisibilityInterval(fetchAll, 10000, [fetchAll])

  const handleModelSwitch = async (modelId: string) => {
    setSaving(true)
    try {
      const res = await authedFetch('/api/system/config/models', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ primary: modelId }),
      })
      if (res.ok) {
        setPrimary(modelId)
        setModels(prev => prev.map(m => ({ ...m, isPrimary: m.id === modelId })))
        showModelStatus('ok', t('system.models.saved'))
      }
    } catch (err) {
      console.error('Failed to switch model:', err)
    }
    setSaving(false)
  }

  const showModelStatus = (type: 'ok' | 'err', msg: string) => {
    setModelStatus({ type, msg })
    setTimeout(() => setModelStatus(null), 3000)
  }

  const handleToggleFallback = async (modelId: string) => {
    const isFb = fallbacks.includes(modelId)
    const newFallbacks = isFb ? fallbacks.filter(f => f !== modelId) : [...fallbacks, modelId]
    try {
      const res = await authedFetch('/api/system/config/models', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fallbacks: newFallbacks }),
      })
      if (res.ok) {
        setFallbacks(newFallbacks)
        setModels(prev => prev.map(m => ({ ...m, isFallback: newFallbacks.includes(m.id) })))
        showModelStatus('ok', t('system.models.saved'))
      }
    } catch (err) {
      console.error('Failed to toggle fallback:', err)
    }
  }

  const handleAddProvider = async () => {
    if (!newProvider.id || !newProvider.baseUrl || !newProvider.modelId) return
    try {
      const res = await authedFetch('/api/system/config/models/provider', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: newProvider.id,
          baseUrl: newProvider.baseUrl,
          apiKey: newProvider.apiKey,
          api: newProvider.api,
          model: { id: newProvider.modelId, name: newProvider.modelName || newProvider.modelId },
        }),
      })
      if (res.ok) {
        showModelStatus('ok', t('system.models.added'))
        setShowAddProvider(false)
        setNewProvider({ id: '', baseUrl: '', apiKey: '', api: 'openai-completions', modelId: '', modelName: '' })
        fetchAll()
      } else {
        const err = await res.json()
        showModelStatus('err', err.error || 'Error')
      }
    } catch {
      showModelStatus('err', 'Network error')
    }
  }

  const handleAddModel = async (providerId: string) => {
    if (!newModel.id) return
    try {
      const res = await authedFetch(`/api/system/config/models/provider/${providerId}/model`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: newModel.id, name: newModel.name || newModel.id }),
      })
      if (res.ok) {
        showModelStatus('ok', t('system.models.added'))
        setAddModelFor(null)
        setNewModel({ id: '', name: '' })
        fetchAll()
      } else {
        const err = await res.json()
        showModelStatus('err', err.error || 'Error')
      }
    } catch {
      showModelStatus('err', 'Network error')
    }
  }

  const handleDeleteProvider = async (providerId: string) => {
    if (!confirm(t('system.models.confirm.delete'))) return
    try {
      const res = await authedFetch(`/api/system/config/models/provider/${providerId}`, { method: 'DELETE' })
      if (res.ok) {
        showModelStatus('ok', t('system.models.deleted'))
        fetchAll()
      } else {
        const err = await res.json()
        showModelStatus('err', err.error || 'Error')
      }
    } catch {
      showModelStatus('err', 'Network error')
    }
  }

  const handleInstallOpenClaw = async () => {
    setInstalling(true)
    setUpdateMsg(t('system.openclaw.installing'))
    try {
      const res = await authedFetch('/api/setup/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const data = await res.json()
      if (res.ok) {
        setUpdateMsg(t('system.openclaw.installed'))
        fetchAll()
      } else {
        setUpdateMsg(data.error || 'Install failed')
      }
    } catch {
      setUpdateMsg('Network error')
    }
    setInstalling(false)
    setTimeout(() => setUpdateMsg(null), 5000)
  }

  const handleUpdateOpenClaw = async () => {
    setUpdating(true)
    setUpdateMsg(t('system.openclaw.updating'))
    try {
      const res = await authedFetch('/api/system/openclaw/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const data = await res.json()
      if (res.ok) {
        setUpdateMsg(`${t('system.openclaw.updated')} → ${data.version || '?'}`)
        fetchAll()
      } else {
        setUpdateMsg(data.error || 'Update failed')
      }
    } catch {
      setUpdateMsg('Network error')
    }
    setUpdating(false)
    setTimeout(() => setUpdateMsg(null), 5000)
  }

  const handleSyncModels = async () => {
    setSyncing(true)
    showModelStatus('ok', t('system.models.syncing'))
    try {
      const res = await authedFetch('/api/system/config/models/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      if (res.ok) {
        const data = await res.json()
        const summary = Object.entries(data.results || {})
          .map(([id, r]: [string, any]) => r.success ? `${id}: ${r.count}` : `${id}: ${r.error}`)
          .join(', ')
        showModelStatus('ok', `${t('system.models.synced')} (${summary})`)
        fetchAll()
      } else {
        const err = await res.json()
        showModelStatus('err', err.error || 'Sync failed')
      }
    } catch {
      showModelStatus('err', 'Network error')
    }
    setSyncing(false)
  }

  const handleRunObserver = async () => {
    setObserverRunning(true)
    setObserverMsg(null)
    try {
      const res = await authedFetch('/api/system/observer', { method: 'POST' })
      const data = await res.json()
      setObserverMsg(data.success ? t('system.observer.done') : t('system.observer.failed'))
    } catch {
      setObserverMsg(t('system.observer.failed'))
    }
    setObserverRunning(false)
    setTimeout(() => setObserverMsg(null), 3000)
  }

  const handlePluginToggle = async (pluginId: string, enabled: boolean) => {
    try {
      const res = await authedFetch(`/api/system/config/plugins/${pluginId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      })
      if (res.ok) {
        setPlugins(prev => prev.map(p => p.id === pluginId ? { ...p, enabled } : p))
      }
    } catch (err) {
      console.error('Failed to toggle plugin:', err)
    }
  }

  const handleShutdown = async () => {
    try {
      await authedFetch('/api/system/shutdown', { method: 'POST' })
    } catch {
      // Expected — server dies before response completes
    }
    setServerStopped(true)
  }

  // ---- OpenClaw Config handlers ----

  const handleSaveProviderKey = async (providerId: string) => {
    const key = editingKeys[`provider:${providerId}`]
    if (key === undefined) return
    showConfigStatus(`provider:${providerId}`, 'saving', t('system.config.saving'))
    try {
      const res = await authedFetch('/api/system/config/models', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providers: { [providerId]: { apiKey: key } } }),
      })
      if (res.ok) {
        showConfigStatus(`provider:${providerId}`, 'ok', t('system.config.saved'))
        setEditingKeys(prev => { const n = { ...prev }; delete n[`provider:${providerId}`]; return n })
        fetchAll()
      } else {
        const err = await res.json()
        showConfigStatus(`provider:${providerId}`, 'err', err.error || 'Error')
      }
    } catch {
      showConfigStatus(`provider:${providerId}`, 'err', 'Network error')
    }
  }

  const handleTestProvider = async (providerId: string) => {
    showConfigStatus(`provider:${providerId}`, 'saving', t('system.config.testing'))
    try {
      const res = await authedFetch('/api/system/config/models/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: providerId }),
      })
      const data = await res.json()
      if (res.ok) {
        showConfigStatus(`provider:${providerId}`, 'ok', data.message || t('system.config.test.ok'))
      } else {
        showConfigStatus(`provider:${providerId}`, 'err', data.error || t('system.config.test.fail'))
      }
    } catch {
      showConfigStatus(`provider:${providerId}`, 'err', 'Network error')
    }
  }

  const handleSaveSkillKey = async (slug: string) => {
    const key = editingKeys[`skill:${slug}`]
    if (key === undefined) return
    showConfigStatus(`skill:${slug}`, 'saving', t('system.config.saving'))
    try {
      const res = await authedFetch(`/api/system/config/skills/${slug}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: key || null }),
      })
      if (res.ok) {
        showConfigStatus(`skill:${slug}`, 'ok', t('system.config.saved'))
        setEditingKeys(prev => { const n = { ...prev }; delete n[`skill:${slug}`]; return n })
        fetchAll()
      } else {
        const err = await res.json()
        showConfigStatus(`skill:${slug}`, 'err', err.error || 'Error')
      }
    } catch {
      showConfigStatus(`skill:${slug}`, 'err', 'Network error')
    }
  }

  const handleTestSkill = async (slug: string) => {
    showConfigStatus(`skill:${slug}`, 'saving', t('system.config.testing'))
    try {
      const res = await authedFetch(`/api/system/config/skills/${slug}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await res.json()
      if (res.ok) {
        showConfigStatus(`skill:${slug}`, 'ok', data.message || t('system.config.test.ok'))
      } else {
        showConfigStatus(`skill:${slug}`, 'err', data.error || t('system.config.test.fail'))
      }
    } catch {
      showConfigStatus(`skill:${slug}`, 'err', 'Network error')
    }
  }

  const handleSaveTelegramToken = async () => {
    const key = editingKeys['telegram:token']
    if (key === undefined) return
    showConfigStatus('telegram:token', 'saving', t('system.config.saving'))
    try {
      const res = await authedFetch('/api/system/config/telegram', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botToken: key }),
      })
      if (res.ok) {
        showConfigStatus('telegram:token', 'ok', t('system.config.saved'))
        setEditingKeys(prev => { const n = { ...prev }; delete n['telegram:token']; return n })
        fetchAll()
      } else {
        const err = await res.json()
        showConfigStatus('telegram:token', 'err', err.error || 'Error')
      }
    } catch {
      showConfigStatus('telegram:token', 'err', 'Network error')
    }
  }

  const handleTestTelegram = async () => {
    showConfigStatus('telegram:token', 'saving', t('system.config.testing'))
    try {
      const res = await authedFetch('/api/system/config/telegram/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await res.json()
      if (res.ok) {
        showConfigStatus('telegram:token', 'ok', data.message || t('system.config.test.ok'))
      } else {
        showConfigStatus('telegram:token', 'err', data.error || t('system.config.test.fail'))
      }
    } catch {
      showConfigStatus('telegram:token', 'err', 'Network error')
    }
  }

  const formatUptime = (ms: number) => {
    if (ms < 60000) return `${Math.floor(ms / 1000)}s`
    if (ms < 3600000) return `${Math.floor(ms / 60000)}m`
    return `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`
  }

  if (loading) {
    return <div className="system-tab"><div className="system-loading">{t('system.loading')}</div></div>
  }

  return (
    <div className="system-tab">
      {/* OpenClaw Version / Install */}
      <div className="system-section">
        <button className="system-section-header" onClick={() => toggle('openclaw')}>
          <span className="system-section-title">OpenClaw</span>
          <span className="system-chevron">{collapsed.openclaw ? '▸' : '▾'}</span>
        </button>
        {!collapsed.openclaw && (
          <div className="system-section-body">
            {updateMsg && (
              <div className={`system-config-status ${(installing || updating) ? 'ok' : updateMsg.includes('fail') || updateMsg.includes('error') || updateMsg.includes('Error') ? 'err' : 'ok'}`}>{updateMsg}</div>
            )}
            {!ocVersion || !ocVersion.current ? (
              <>
                <div className="system-row">
                  <span className="system-label">{t('system.openclaw.status')}</span>
                  <span className="system-badge err">{t('system.openclaw.notinstalled')}</span>
                </div>
                <button
                  className="system-action-btn"
                  style={{ width: '100%', marginTop: 6 }}
                  onClick={handleInstallOpenClaw}
                  disabled={installing}
                >
                  {installing ? t('system.openclaw.installing') : t('system.openclaw.install')}
                </button>
              </>
            ) : (
              <>
                <div className="system-row">
                  <span className="system-label">{t('system.openclaw.current')}</span>
                  <span className="system-value">{ocVersion.current}</span>
                </div>
                <div className="system-row">
                  <span className="system-label">{t('system.openclaw.latest')}</span>
                  <span className="system-value">
                    {ocVersion.latest || '?'}
                    {ocVersion.updateAvailable && <span className="system-badge warn" style={{ marginLeft: 6 }}>{t('system.openclaw.new')}</span>}
                  </span>
                </div>
                {ocVersion.updateAvailable && (
                  <button
                    className="system-action-btn"
                    style={{ width: '100%', marginTop: 6 }}
                    onClick={handleUpdateOpenClaw}
                    disabled={updating}
                  >
                    {updating ? t('system.openclaw.updating') : t('system.openclaw.update')}
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Gateway Status */}
      <div className="system-section">
        <button className="system-section-header" onClick={() => toggle('gateway')}>
          <span className="system-section-title">{t('system.gateway.title')}</span>
          <span className="system-chevron">{collapsed.gateway ? '▸' : '▾'}</span>
        </button>
        {!collapsed.gateway && gateway && (
          <div className="system-section-body">
            <div className="system-row">
              <span className="system-label">{t('system.gateway.status')}</span>
              <span className={`system-badge ${gateway.connected ? 'ok' : 'err'}`}>
                {gateway.connected ? t('system.gateway.connected') : t('system.gateway.disconnected')}
              </span>
            </div>
            <div className="system-row">
              <span className="system-label">{t('system.gateway.auth')}</span>
              <span className={`system-badge ${gateway.authenticated ? 'ok' : 'warn'}`}>
                {gateway.authenticated ? t('cron.status.ok') : t('system.disabled')}
              </span>
            </div>
            <div className="system-row">
              <span className="system-label">{t('system.gateway.uptime')}</span>
              <span className="system-value">{formatUptime(gateway.uptime)}</span>
            </div>
            <div className="system-row">
              <span className="system-label">{t('system.gateway.pending')}</span>
              <span className="system-value">{gateway.pendingRequests}</span>
            </div>
            <div className="system-row">
              <span className="system-label">{t('system.gateway.streams')}</span>
              <span className="system-value">{gateway.streamBuffers}</span>
            </div>

            {/* Gateway Config */}
            {gwConfig && (
              <div className="system-subsection">
                <div className="system-sublabel">{t('system.gateway.config')}</div>
                <div className="system-row">
                  <span className="system-label">URL</span>
                  <span className="system-value" style={{ fontSize: 11 }}>{gwConfig.url}</span>
                </div>
                <div className="system-row">
                  <span className="system-label">Token</span>
                  {editingKeys['gw-token'] !== undefined ? (
                    <span className="system-inline-edit">
                      <input
                        type="password"
                        value={editingKeys['gw-token']}
                        onChange={e => setEditingKeys(p => ({ ...p, 'gw-token': e.target.value }))}
                        placeholder="Gateway auth token"
                        className="system-input"
                      />
                      <button className="system-btn-sm ok" onClick={async () => {
                        showConfigStatus('gw', 'saving', '...')
                        const body: Record<string, string> = { token: editingKeys['gw-token'] }
                        if (editingKeys['gw-url']) body.url = editingKeys['gw-url']
                        const r = await authedFetch('/api/system/config/gateway', {
                          method: 'PUT', headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify(body),
                        })
                        if (r.ok) {
                          showConfigStatus('gw', 'ok', t('system.gateway.saved'))
                          setEditingKeys(p => { const n = { ...p }; delete n['gw-token']; delete n['gw-url']; return n })
                          fetchAll()
                        } else {
                          showConfigStatus('gw', 'err', 'Failed')
                        }
                      }}>Save</button>
                      <button className="system-btn-sm" onClick={() => setEditingKeys(p => { const n = { ...p }; delete n['gw-token']; delete n['gw-url']; return n })}>Cancel</button>
                    </span>
                  ) : (
                    <span className="system-value">
                      {gwConfig.hasToken ? gwConfig.tokenPreview : <em style={{ color: '#f44' }}>Not set</em>}
                      {' '}
                      <button className="system-btn-sm" onClick={() => setEditingKeys(p => ({ ...p, 'gw-token': '', 'gw-url': gwConfig.url }))}>
                        {t('system.edit')}
                      </button>
                    </span>
                  )}
                </div>
                {editingKeys['gw-url'] !== undefined && (
                  <div className="system-row">
                    <span className="system-label">URL</span>
                    <input
                      type="text"
                      value={editingKeys['gw-url']}
                      onChange={e => setEditingKeys(p => ({ ...p, 'gw-url': e.target.value }))}
                      placeholder="ws://127.0.0.1:18789"
                      className="system-input"
                    />
                  </div>
                )}
                {configStatus['gw'] && (
                  <div className={`system-config-status ${configStatus['gw'].type}`}>{configStatus['gw'].msg}</div>
                )}
                <div className="system-row" style={{ marginTop: 4 }}>
                  <button className="system-btn-sm" onClick={async () => {
                    const r = await authedFetch('/api/system/config/gateway/test', { method: 'POST' })
                    const d = await r.json()
                    showConfigStatus('gw', d.success ? 'ok' : 'err', d.message || d.error)
                  }}>{t('system.gateway.test')}</button>
                </div>
              </div>
            )}

            {/* Channels */}
            {channels.length > 0 && (
              <div className="system-subsection">
                <div className="system-sublabel">{t('system.channels')}</div>
                {channels.map(ch => (
                  <div key={ch.id} className="system-row">
                    <span className="system-label">{ch.name}</span>
                    <span className={`system-badge ${ch.running ? 'ok' : ch.enabled ? 'warn' : 'off'}`}>
                      {ch.running ? t('system.running') : ch.enabled ? t('system.stopped') : t('system.disabled')}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Model Management */}
      <div className="system-section">
        <button className="system-section-header" onClick={() => toggle('models')}>
          <span className="system-section-title">{t('system.models.title')}</span>
          <span className="system-chevron">{collapsed.models ? '▸' : '▾'}</span>
        </button>
        {!collapsed.models && (
          <div className="system-section-body">
            {modelStatus && (
              <div className={`system-config-status ${modelStatus.type}`}>{modelStatus.msg}</div>
            )}
            <button
              className="system-action-btn"
              style={{ width: '100%', marginBottom: 8 }}
              onClick={handleSyncModels}
              disabled={syncing || providers.length === 0}
            >
              {syncing ? t('system.models.syncing') : t('system.models.sync')}
            </button>

            {/* Group by provider */}
            {providers.map(prov => {
              const provModels = models.filter(m => m.provider === prov.id)
              return (
                <div key={prov.id} className="system-subsection">
                  <div className="system-provider-header">
                    <span className="system-provider-name">{prov.id} <span style={{ opacity: 0.5, fontSize: 10 }}>({prov.api})</span></span>
                    <span className="system-provider-actions">
                      <button className="system-btn-xs" onClick={() => { setAddModelFor(addModelFor === prov.id ? null : prov.id); setNewModel({ id: '', name: '' }) }}>+</button>
                      <button className="system-btn-xs del" onClick={() => handleDeleteProvider(prov.id)}>x</button>
                    </span>
                  </div>

                  {provModels.map(m => (
                    <div key={m.id} className={`system-model-row ${m.id === primary ? 'active' : ''}`}>
                      <div className="system-model-info">
                        <span className="system-model-name-text">
                          {m.name}
                          {m.id === primary && <span className="system-primary-badge">{t('system.models.primary')}</span>}
                          {m.isFallback && <span className="system-fallback-badge">{t('system.models.fallback')}</span>}
                        </span>
                        <span className="system-model-meta">{m.contextWindowFormatted} · {m.maxTokensFormatted}</span>
                      </div>
                      {m.id !== primary && (
                        <div className="system-model-actions">
                          <button className="system-btn-xs" onClick={() => handleModelSwitch(m.id)} disabled={saving} title={t('system.models.setprimary')}>&#9733;</button>
                          <button className={`system-btn-xs ${m.isFallback ? 'active' : ''}`} onClick={() => handleToggleFallback(m.id)} title={m.isFallback ? t('system.models.removefallback') : t('system.models.setfallback')}>F</button>
                        </div>
                      )}
                    </div>
                  ))}

                  {/* Add model form */}
                  {addModelFor === prov.id && (
                    <div className="system-add-form">
                      <input
                        className="system-config-input"
                        placeholder={t('system.models.model.id') + ' (e.g. gpt-4o)'}
                        value={newModel.id}
                        onChange={e => setNewModel(prev => ({ ...prev, id: e.target.value }))}
                      />
                      <input
                        className="system-config-input"
                        placeholder={t('system.models.model.name') + ' (e.g. GPT-4o)'}
                        value={newModel.name}
                        onChange={e => setNewModel(prev => ({ ...prev, name: e.target.value }))}
                      />
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button className="system-action-btn" onClick={() => handleAddModel(prov.id)} disabled={!newModel.id}>
                          {t('system.models.add')}
                        </button>
                        <button className="system-btn-sm" onClick={() => setAddModelFor(null)}>
                          {t('system.models.cancel')}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}

            {/* Add Provider button/form */}
            {!showAddProvider ? (
              <button className="system-action-btn" style={{ width: '100%', marginTop: 8 }} onClick={() => setShowAddProvider(true)}>
                + {t('system.models.addprovider')}
              </button>
            ) : (
              <div className="system-subsection system-add-form">
                <div className="system-sublabel">{t('system.models.addprovider')}</div>
                <input
                  className="system-config-input"
                  placeholder={t('system.models.provider.id') + ' (e.g. openai)'}
                  value={newProvider.id}
                  onChange={e => setNewProvider(prev => ({ ...prev, id: e.target.value }))}
                />
                <input
                  className="system-config-input"
                  placeholder={t('system.models.provider.baseurl') + ' (e.g. https://api.openai.com/v1)'}
                  value={newProvider.baseUrl}
                  onChange={e => setNewProvider(prev => ({ ...prev, baseUrl: e.target.value }))}
                />
                <input
                  type="password"
                  className="system-config-input"
                  placeholder={t('system.models.provider.apikey')}
                  value={newProvider.apiKey}
                  onChange={e => setNewProvider(prev => ({ ...prev, apiKey: e.target.value }))}
                />
                <select
                  className="system-config-input"
                  value={newProvider.api}
                  onChange={e => setNewProvider(prev => ({ ...prev, api: e.target.value }))}
                >
                  <option value="openai-completions">OpenAI Completions</option>
                  <option value="google-generative-ai">Google Generative AI</option>
                  <option value="anthropic">Anthropic</option>
                </select>
                <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 6, marginTop: 4 }}>
                  <div className="system-sublabel" style={{ fontSize: 10 }}>{t('system.models.model.id')}</div>
                </div>
                <input
                  className="system-config-input"
                  placeholder={t('system.models.model.id') + ' (e.g. gpt-4o)'}
                  value={newProvider.modelId}
                  onChange={e => setNewProvider(prev => ({ ...prev, modelId: e.target.value }))}
                />
                <input
                  className="system-config-input"
                  placeholder={t('system.models.model.name') + ' (e.g. GPT-4o)'}
                  value={newProvider.modelName}
                  onChange={e => setNewProvider(prev => ({ ...prev, modelName: e.target.value }))}
                />
                <div style={{ display: 'flex', gap: 4 }}>
                  <button
                    className="system-action-btn"
                    onClick={handleAddProvider}
                    disabled={!newProvider.id || !newProvider.baseUrl || !newProvider.modelId}
                  >
                    {t('system.models.add')}
                  </button>
                  <button className="system-btn-sm" onClick={() => setShowAddProvider(false)}>
                    {t('system.models.cancel')}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Plugin Manager */}
      {plugins.length > 0 && (
        <div className="system-section">
          <button className="system-section-header" onClick={() => toggle('plugins')}>
            <span className="system-section-title">{t('system.plugins.title')}</span>
            <span className="system-chevron">{collapsed.plugins ? '▸' : '▾'}</span>
          </button>
          {!collapsed.plugins && (
            <div className="system-section-body">
              {plugins.map(p => (
                <div key={p.id} className="system-plugin-row">
                  <div className="system-plugin-info">
                    <span className="system-plugin-name">{p.name}</span>
                    {p.version && <span className="system-plugin-ver">v{p.version}</span>}
                  </div>
                  <label className="system-toggle">
                    <input
                      type="checkbox"
                      checked={p.enabled}
                      onChange={e => handlePluginToggle(p.id, e.target.checked)}
                    />
                    <span className="system-toggle-slider" />
                  </label>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {/* Memory Observer */}
      <div className="system-section">
        <button className="system-section-header" onClick={() => toggle('observer')}>
          <span className="system-section-title">{t('system.observer.title')}</span>
          <span className="system-chevron">{collapsed.observer ? '▸' : '▾'}</span>
        </button>
        {!collapsed.observer && (
          <div className="system-section-body">
            <div className="system-row">
              <span className="system-label">{t('system.observer.desc')}</span>
              <button
                className="system-action-btn"
                onClick={handleRunObserver}
                disabled={observerRunning}
              >
                {observerRunning ? '...' : t('system.observer.run')}
              </button>
            </div>
            {observerMsg && (
              <div className="system-row">
                <span className="system-value" style={{ color: 'var(--accent-color)' }}>{observerMsg}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Sessions */}
      <div className="system-section">
        <button className="system-section-header" onClick={() => toggle('sessions')}>
          <span className="system-section-title">{t('system.sessions.title')}</span>
          <span className="system-chevron">{collapsed.sessions ? '▸' : '▾'}</span>
        </button>
        {!collapsed.sessions && (
          <div className="system-section-body">
            {sessions.length === 0 ? (
              <div className="system-row"><span className="system-label">{t('system.sessions.empty')}</span></div>
            ) : (
              sessions.map(s => (
                <div key={s.id} className="system-row">
                  <span className="system-label" title={s.id}>{s.name || s.id}</span>
                  <span className="system-value">{new Date(s.lastModified).toLocaleString()}</span>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Paired Devices */}
      <div className="system-section">
        <button className="system-section-header" onClick={() => toggle('devices')}>
          <span className="system-section-title">{t('system.devices.title')}</span>
          <span className="system-chevron">{collapsed.devices ? '▸' : '▾'}</span>
        </button>
        {!collapsed.devices && (
          <div className="system-section-body">
            {devices.length === 0 ? (
              <div className="system-row"><span className="system-label">{t('system.devices.empty')}</span></div>
            ) : (
              devices.map((d, i) => (
                <div key={`device-${d.id}-${i}`} className="system-plugin-row">
                  <div className="system-plugin-info">
                    <span className="system-plugin-name">{d.name || d.id}</span>
                    <span className="system-plugin-ver">{d.mode}</span>
                  </div>
                  <span className={`system-badge ok`}>P{d.protocol}</span>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* OpenClaw Config */}
      <div className="system-section">
        <button className="system-section-header" onClick={() => toggle('config')}>
          <span className="system-section-title">{t('system.config.title')}</span>
          <span className="system-chevron">{collapsed.config ? '▸' : '▾'}</span>
        </button>
        {!collapsed.config && (
          <div className="system-section-body">
            {/* Providers */}
            <div className="system-subsection">
              <div className="system-sublabel">{t('system.config.providers')}</div>
              {providers.map(prov => {
                const statusKey = `provider:${prov.id}`
                const status = configStatus[statusKey]
                const isEditing = statusKey in editingKeys
                return (
                  <div key={prov.id} className="system-config-item">
                    <div className="system-config-item-header">
                      <span className="system-plugin-name">{prov.id}</span>
                      <span className={`system-badge ${prov.hasApiKey ? 'ok' : 'warn'}`}>
                        {prov.hasApiKey ? t('system.config.configured') : t('system.config.nokey')}
                      </span>
                    </div>
                    {prov.hasApiKey && !isEditing && (
                      <div className="system-config-preview">
                        <code>{prov.apiKeyPreview}</code>
                      </div>
                    )}
                    <div className="system-config-input-row">
                      <input
                        type="password"
                        className="system-config-input"
                        placeholder={t('system.config.apikey.placeholder')}
                        value={editingKeys[statusKey] ?? ''}
                        onChange={e => setEditingKeys(prev => ({ ...prev, [statusKey]: e.target.value }))}
                      />
                      <button
                        className="system-action-btn"
                        onClick={() => handleSaveProviderKey(prov.id)}
                        disabled={!editingKeys[statusKey] || status?.type === 'saving'}
                      >
                        {t('system.config.save')}
                      </button>
                      <button
                        className="system-action-btn"
                        onClick={() => handleTestProvider(prov.id)}
                        disabled={status?.type === 'saving'}
                      >
                        {t('system.config.test')}
                      </button>
                    </div>
                    {status && (
                      <div className={`system-config-status ${status.type}`}>{status.msg}</div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Skills */}
            {skills.length > 0 && (
              <div className="system-subsection">
                <div className="system-sublabel">{t('system.config.skills')}</div>
                {skills.map(skill => {
                  const statusKey = `skill:${skill.slug}`
                  const status = configStatus[statusKey]
                  const isEditing = statusKey in editingKeys
                  return (
                    <div key={skill.slug} className="system-config-item">
                      <div className="system-config-item-header">
                        <span className="system-plugin-name">{skill.slug}</span>
                        <span className={`system-badge ${skill.hasApiKey ? 'ok' : 'warn'}`}>
                          {skill.hasApiKey ? t('system.config.configured') : t('system.config.nokey')}
                        </span>
                      </div>
                      {skill.hasApiKey && !isEditing && (
                        <div className="system-config-preview">
                          <code>{skill.apiKeyPreview}</code>
                        </div>
                      )}
                      <div className="system-config-input-row">
                        <input
                          type="password"
                          className="system-config-input"
                          placeholder={t('system.config.apikey.placeholder')}
                          value={editingKeys[statusKey] ?? ''}
                          onChange={e => setEditingKeys(prev => ({ ...prev, [statusKey]: e.target.value }))}
                        />
                        <button
                          className="system-action-btn"
                          onClick={() => handleSaveSkillKey(skill.slug)}
                          disabled={!editingKeys[statusKey] || status?.type === 'saving'}
                        >
                          {t('system.config.save')}
                        </button>
                        <button
                          className="system-action-btn"
                          onClick={() => handleTestSkill(skill.slug)}
                          disabled={status?.type === 'saving'}
                        >
                          {t('system.config.test')}
                        </button>
                      </div>
                      {status && (
                        <div className={`system-config-status ${status.type}`}>{status.msg}</div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {/* Telegram */}
            {telegram && (
              <div className="system-subsection">
                <div className="system-sublabel">{t('system.config.telegram')}</div>
                <div className="system-config-item">
                  <div className="system-config-item-header">
                    <span className="system-plugin-name">{t('system.config.bottoken')}</span>
                    <span className={`system-badge ${telegram.hasBotToken ? 'ok' : 'warn'}`}>
                      {telegram.hasBotToken ? t('system.config.configured') : t('system.config.nokey')}
                    </span>
                  </div>
                  {telegram.hasBotToken && !('telegram:token' in editingKeys) && (
                    <div className="system-config-preview">
                      <code>{telegram.botTokenPreview}</code>
                    </div>
                  )}
                  <div className="system-config-input-row">
                    <input
                      type="password"
                      className="system-config-input"
                      placeholder={t('system.config.bottoken.placeholder')}
                      value={editingKeys['telegram:token'] ?? ''}
                      onChange={e => setEditingKeys(prev => ({ ...prev, 'telegram:token': e.target.value }))}
                    />
                    <button
                      className="system-action-btn"
                      onClick={handleSaveTelegramToken}
                      disabled={!editingKeys['telegram:token'] || configStatus['telegram:token']?.type === 'saving'}
                    >
                      {t('system.config.save')}
                    </button>
                    <button
                      className="system-action-btn"
                      onClick={handleTestTelegram}
                      disabled={configStatus['telegram:token']?.type === 'saving'}
                    >
                      {t('system.config.test')}
                    </button>
                  </div>
                  {configStatus['telegram:token'] && (
                    <div className={`system-config-status ${configStatus['telegram:token'].type}`}>
                      {configStatus['telegram:token'].msg}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Server Shutdown */}
      <div className="system-section system-shutdown-section">
        <button className="system-section-header" onClick={() => toggle('shutdown')}>
          <span className="system-section-title">{t('system.shutdown.title')}</span>
          <span className="system-chevron">{collapsed.shutdown ? '▸' : '▾'}</span>
        </button>
        {!collapsed.shutdown && (
          <div className="system-section-body">
            {!shutdownConfirm ? (
              <button
                className="system-shutdown-btn"
                onClick={() => setShutdownConfirm(true)}
              >
                {t('system.shutdown.btn')}
              </button>
            ) : (
              <div className="system-shutdown-confirm">
                <p>{t('system.shutdown.confirm')}</p>
                <div className="system-shutdown-actions">
                  <button className="system-shutdown-btn danger" onClick={handleShutdown}>
                    {t('system.shutdown.btn')}
                  </button>
                  <button className="system-action-btn" onClick={() => setShutdownConfirm(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Shutdown overlay */}
      {serverStopped && (
        <div className="system-shutdown-overlay">
          <div className="system-shutdown-message">
            <div className="system-shutdown-icon">&#x23FB;</div>
            <p>{t('system.shutdown.done')}</p>
          </div>
        </div>
      )}
    </div>
  )
}
