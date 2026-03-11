import { useState, useEffect, useCallback } from 'react'
import { useLocale } from '../i18n/index'
import { authedFetch } from '../utils/api'
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
  const [editingKeys, setEditingKeys] = useState<Record<string, string>>({})
  const [configStatus, setConfigStatus] = useState<Record<string, { type: 'ok' | 'err' | 'saving'; msg: string }>>({})

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
      const [capRes, gwRes, sessRes, devRes, modelsRes, skillsRes, tgRes] = await Promise.all([
        authedFetch('/api/system/capabilities'),
        authedFetch('/api/health').catch(() => null),
        authedFetch('/api/system/sessions').catch(() => null),
        authedFetch('/api/system/devices').catch(() => null),
        authedFetch('/api/system/config/models').catch(() => null),
        authedFetch('/api/system/config/skills').catch(() => null),
        authedFetch('/api/system/config/telegram').catch(() => null),
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
      }
      if (skillsRes?.ok) {
        const sd = await skillsRes.json()
        setSkills(sd.skills || [])
      }
      if (tgRes?.ok) {
        const td = await tgRes.json()
        setTelegram(td)
      }
    } catch (err) {
      console.error('Failed to fetch system data:', err)
    }
  }, [])

  useEffect(() => {
    fetchAll().then(() => setLoading(false))
    const interval = setInterval(fetchAll, 10000)
    return () => clearInterval(interval)
  }, [fetchAll])

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
      }
    } catch (err) {
      console.error('Failed to switch model:', err)
    }
    setSaving(false)
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

      {/* Model Switcher */}
      <div className="system-section">
        <button className="system-section-header" onClick={() => toggle('models')}>
          <span className="system-section-title">{t('system.models.title')}</span>
          <span className="system-chevron">{collapsed.models ? '▸' : '▾'}</span>
        </button>
        {!collapsed.models && (
          <div className="system-section-body">
            {models.map(m => (
              <button
                key={m.id}
                className={`system-model-card ${m.id === primary ? 'active' : ''}`}
                onClick={() => handleModelSwitch(m.id)}
                disabled={saving || m.id === primary}
              >
                <div className="system-model-name">
                  {m.name}
                  {m.id === primary && <span className="system-primary-badge">{t('cap.status.primary')}</span>}
                  {m.isFallback && <span className="system-fallback-badge">{t('cap.status.fallback')}</span>}
                </div>
                <div className="system-model-meta">
                  <span>{m.provider}</span>
                  <span>{m.contextWindowFormatted} ctx</span>
                  <span>{m.maxTokensFormatted} max</span>
                </div>
              </button>
            ))}
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
                <div key={i} className="system-plugin-row">
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
