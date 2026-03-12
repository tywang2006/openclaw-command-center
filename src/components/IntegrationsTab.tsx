import { useState, useEffect } from 'react'
import { useLocale } from '../i18n/index'
import { authedFetch, clearToken } from '../utils/api'
import './IntegrationsTab.css'

/* ---------- Types ---------- */

interface Channel {
  id: string
  name: string
  enabled: boolean
  running: boolean
  config: {
    groups?: number
    dmPolicy?: string | null
    streaming?: string | null
    groupPolicy?: string | null
    selfChatMode?: boolean
  }
}

interface Plugin {
  id: string
  name: string
  enabled: boolean
  description: string
  version: string | null
}

interface Skill {
  slug: string
  name: string
  summary: string | null
  description: string | null
  tags: string[]
  version: string | null
  hasAssets: boolean
  hasApiKey: boolean
}

interface SkillDetail extends Skill {
  markdown?: string
  ownerId?: string
  publishedAt?: number
}

interface Model {
  id: string
  name: string
  provider: string
  contextWindow: number
  contextWindowFormatted: string
  maxTokens: number
  maxTokensFormatted: string
  isPrimary: boolean
  isFallback: boolean
  input: string[]
}

interface Capabilities {
  channels: Channel[]
  plugins: Plugin[]
  skills: Skill[]
  models: Model[]
}

interface IntegrationsTabProps {
  onSwitchToChat?: (deptId: string, prefillMessage: string) => void
}

/* ---------- Helpers ---------- */

function getTagColor(tag: string): string {
  const t = tag.toLowerCase()
  if (t.includes('web') || t.includes('frontend')) return 'tag-web'
  if (t.includes('backend') || t.includes('server')) return 'tag-backend'
  if (t.includes('data') || t.includes('database')) return 'tag-data'
  if (t.includes('ai') || t.includes('ml')) return 'tag-ai'
  if (t.includes('devops') || t.includes('cloud')) return 'tag-devops'
  if (t.includes('mobile') || t.includes('ios') || t.includes('android')) return 'tag-mobile'
  if (t.includes('security')) return 'tag-security'
  if (t.includes('tool') || t.includes('utility')) return 'tag-tool'
  return 'tag-default'
}

/* ---------- Component ---------- */

export default function IntegrationsTab({ onSwitchToChat }: IntegrationsTabProps) {
  const { t } = useLocale()
  const [cap, setCap] = useState<Capabilities | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedSkill, setSelectedSkill] = useState<SkillDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  // Integration config states
  const [integConfig, setIntegConfig] = useState<Record<string, any> | null>(null)
  const [configModal, setConfigModal] = useState<string | null>(null)
  const [configForm, setConfigForm] = useState<Record<string, any>>({})
  const [configSaving, setConfigSaving] = useState(false)
  const [configTesting, setConfigTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)

  // System settings modal states
  const [sysModal, setSysModal] = useState<string | null>(null)
  const [sysForm, setSysForm] = useState<Record<string, any>>({})
  const [sysSaving, setSysSaving] = useState(false)
  const [sysTesting, setSysTesting] = useState(false)
  const [sysTestResult, setSysTestResult] = useState<{ ok: boolean; msg: string } | null>(null)

  // System config data
  const [modelConfig, setModelConfig] = useState<any>(null)
  const [telegramConfig, setTelegramConfig] = useState<any>(null)
  const [skillsConfig, setSkillsConfig] = useState<any[]>([])
  const [autoBackupConfig, setAutoBackupConfig] = useState<any>(null)

  // Skill API key editing states
  const [skillKeyEdits, setSkillKeyEdits] = useState<Record<string, string>>({})
  const [skillTesting, setSkillTesting] = useState<string | null>(null)
  const [skillSaving, setSkillSaving] = useState<string | null>(null)

  // OAuth authorize flow states
  const [oauthUrl, setOauthUrl] = useState<string | null>(null)
  const [oauthRedirectUri, setOauthRedirectUri] = useState<string | null>(null)
  const [oauthCode, setOauthCode] = useState('')
  const [oauthLoading, setOauthLoading] = useState(false)

  useEffect(() => {
    authedFetch('/api/system/capabilities')
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(d => setCap(d))
      .catch(err => setError(err instanceof Error ? err.message : t('cap.error')))
      .finally(() => setLoading(false))
  }, [])

  // Fetch integration config
  useEffect(() => {
    authedFetch('/api/integrations/config')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setIntegConfig(d) })
      .catch(() => {})
  }, [])

  // Fetch system configs
  useEffect(() => {
    authedFetch('/api/system/config/models').then(r => r.ok ? r.json() : null).then(d => { if (d) setModelConfig(d) }).catch(() => {})
    authedFetch('/api/system/config/telegram').then(r => r.ok ? r.json() : null).then(d => { if (d) setTelegramConfig(d) }).catch(() => {})
    authedFetch('/api/system/config/skills').then(r => r.ok ? r.json() : null).then(d => { if (d) setSkillsConfig(d.skills || []) }).catch(() => {})
    authedFetch('/api/integrations/autobackup').then(r => r.ok ? r.json() : null).then(d => { if (d) setAutoBackupConfig(d) }).catch(() => {})
  }, [])

  const toggle = (section: string) =>
    setCollapsed(prev => ({ ...prev, [section]: !prev[section] }))

  const handleSkillClick = async (slug: string) => {
    setDetailLoading(true)
    try {
      const res = await authedFetch(`/api/skills/${slug}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setSelectedSkill(data.skill || data)
    } catch {
      setSelectedSkill(null)
    } finally {
      setDetailLoading(false)
    }
  }

  const handleConfigureService = (serviceId: string) => {
    setConfigModal(serviceId)
    setConfigForm(integConfig?.[serviceId] || {})
    setTestResult(null)
  }

  // Strip frontend-only mask fields before sending to backend
  const cleanFormForSave = (form: Record<string, any>) => {
    const clean = { ...form }
    delete clean.hasAppPassword
    delete clean.hasServiceAccountKey
    delete clean.hasApiKeyOverride
    delete clean.hasUrl
    delete clean.urlPreview
    delete clean.hasClientCredentials
    return clean
  }

  const handleSaveConfig = async (serviceId: string) => {
    setConfigSaving(true)
    setTestResult(null)
    try {
      const body = cleanFormForSave(configForm)
      console.log('[IntegConfig] Saving', serviceId, Object.keys(body), 'serviceAccountKey type:', typeof body.serviceAccountKey)
      const res = await authedFetch(`/api/integrations/config/${serviceId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (data.success) {
        const r2 = await authedFetch('/api/integrations/config')
        const d2 = await r2.json()
        setIntegConfig(d2)
        setConfigModal(null)
        setConfigForm({})
      } else {
        setTestResult({ ok: false, msg: data.error || t('integ.save.failed') })
      }
    } catch {}
    setConfigSaving(false)
  }

  const handleTestConfig = async (serviceId: string) => {
    setConfigTesting(true)
    setTestResult(null)
    try {
      // Auto-save before testing so backend has the latest config
      const body = cleanFormForSave(configForm)
      const saveRes = await authedFetch(`/api/integrations/config/${serviceId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const saveData = await saveRes.json()
      if (!saveData.success) {
        setTestResult({ ok: false, msg: saveData.error || t('integ.save.failed') })
        setConfigTesting(false)
        return
      }
      const res = await authedFetch(`/api/integrations/config/${serviceId}/test`, {
        method: 'POST',
      })
      const data = await res.json()
      setTestResult({ ok: data.success, msg: data.success ? t('integ.test.success') : t('integ.test.failed', { error: data.error || '' }) })
    } catch (err) {
      setTestResult({ ok: false, msg: t('integ.test.failed', { error: t('common.networkError') }) })
    }
    setConfigTesting(false)
  }

  const handleResetConfig = async (serviceId: string) => {
    if (!confirm(t('integ.reset.confirm'))) return
    try {
      await authedFetch(`/api/integrations/config/${serviceId}`, { method: 'DELETE' })
      const r2 = await authedFetch('/api/integrations/config')
      const d2 = await r2.json()
      setIntegConfig(d2)
      setConfigModal(null)
      setConfigForm({})
    } catch {}
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, _serviceId: string) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result as string)
        setConfigForm(prev => ({ ...prev, serviceAccountKey: parsed }))
      } catch {
        setConfigForm(prev => ({ ...prev, serviceAccountKey: reader.result as string }))
      }
    }
    reader.readAsText(file)
  }

  // ---- System Settings Handlers ----

  const openSysModal = (id: string) => {
    setSysModal(id)
    setSysForm({})
    setSysTestResult(null)

    if (id === 'models' && modelConfig) {
      setSysForm({
        primary: modelConfig.primary || '',
        fallbacks: (modelConfig.fallbacks || []).join(', '),
        providers: modelConfig.providers || {},
        _providerKeys: {} as Record<string, string>,
      })
    } else if (id === 'telegram' && telegramConfig) {
      setSysForm({
        enabled: telegramConfig.enabled,
        botToken: '',
        dmPolicy: telegramConfig.dmPolicy || 'allowlist',
        allowFrom: (telegramConfig.allowFrom || []).join(', '),
        streaming: telegramConfig.streaming || 'partial',
        groupPolicy: telegramConfig.groupPolicy || 'allowlist',
      })
    } else if (id === 'password') {
      setSysForm({ currentPassword: '', newPassword: '', confirmPassword: '' })
    } else if (id === 'backup') {
      setSysForm({
        enabled: autoBackupConfig?.enabled || false,
        schedule: autoBackupConfig?.schedule || 'daily',
        time: autoBackupConfig?.time || '03:00',
      })
    }
  }

  const handlePasswordChange = async () => {
    const { currentPassword, newPassword, confirmPassword } = sysForm
    if (newPassword !== confirmPassword) {
      setSysTestResult({ ok: false, msg: t('sys.password.mismatch') })
      return
    }
    if (newPassword.length < 6) {
      setSysTestResult({ ok: false, msg: t('sys.password.tooShort') })
      return
    }
    setSysSaving(true)
    setSysTestResult(null)
    try {
      const res = await authedFetch('/api/auth/password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      })
      const data = await res.json()
      if (data.success) {
        setSysTestResult({ ok: true, msg: t('sys.password.success') })
        setTimeout(() => {
          clearToken()
          window.location.reload()
        }, 1500)
      } else {
        setSysTestResult({ ok: false, msg: data.error === 'Current password is incorrect' ? t('sys.password.wrong') : t('sys.password.failed') })
      }
    } catch {
      setSysTestResult({ ok: false, msg: t('sys.password.failed') })
    }
    setSysSaving(false)
  }

  const handleModelsSave = async () => {
    setSysSaving(true)
    setSysTestResult(null)
    try {
      const body: any = {
        primary: sysForm.primary,
        fallbacks: sysForm.fallbacks.split(',').map((s: string) => s.trim()).filter(Boolean),
      }
      // Include provider key updates if any
      const provKeys = sysForm._providerKeys || {}
      if (Object.keys(provKeys).length > 0) {
        body.providers = {}
        for (const [id, key] of Object.entries(provKeys)) {
          if (key) body.providers[id] = { apiKey: key }
        }
      }
      const res = await authedFetch('/api/system/config/models', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (data.success) {
        setSysTestResult({ ok: true, msg: t('sys.models.saved') })
        // Refresh
        const r2 = await authedFetch('/api/system/config/models')
        const d2 = await r2.json()
        if (d2) setModelConfig(d2)
      }
    } catch {
      setSysTestResult({ ok: false, msg: t('sys.models.test.failed', { error: t('common.networkError') }) })
    }
    setSysSaving(false)
  }

  const handleModelsTest = async (provider: string) => {
    setSysTesting(true)
    setSysTestResult(null)
    try {
      const res = await authedFetch('/api/system/config/models/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider }),
      })
      const data = await res.json()
      setSysTestResult({ ok: data.success, msg: data.success ? t('sys.models.test.success') : t('sys.models.test.failed', { error: data.error || '' }) })
    } catch {
      setSysTestResult({ ok: false, msg: t('sys.models.test.failed', { error: t('common.networkError') }) })
    }
    setSysTesting(false)
  }

  const handleTelegramSave = async () => {
    setSysSaving(true)
    setSysTestResult(null)
    try {
      const body: any = {
        enabled: sysForm.enabled,
        dmPolicy: sysForm.dmPolicy,
        allowFrom: sysForm.allowFrom,
        streaming: sysForm.streaming,
        groupPolicy: sysForm.groupPolicy,
      }
      if (sysForm.botToken) body.botToken = sysForm.botToken
      const res = await authedFetch('/api/system/config/telegram', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (data.success) {
        setSysTestResult({ ok: true, msg: t('integ.saved') })
        const r2 = await authedFetch('/api/system/config/telegram')
        const d2 = await r2.json()
        if (d2) setTelegramConfig(d2)
      }
    } catch {
      setSysTestResult({ ok: false, msg: t('integ.save.failed') })
    }
    setSysSaving(false)
  }

  const handleTelegramTest = async () => {
    setSysTesting(true)
    setSysTestResult(null)
    try {
      const res = await authedFetch('/api/system/config/telegram/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botToken: sysForm.botToken || undefined }),
      })
      const data = await res.json()
      setSysTestResult({ ok: data.success, msg: data.success ? t('sys.telegram.test.success', { name: data.message || '' }) : t('sys.telegram.test.failed', { error: data.error || '' }) })
    } catch {
      setSysTestResult({ ok: false, msg: t('sys.telegram.test.failed', { error: t('common.networkError') }) })
    }
    setSysTesting(false)
  }

  // Skill API key handlers
  const handleSkillKeySave = async (slug: string) => {
    setSkillSaving(slug)
    try {
      const apiKey = skillKeyEdits[slug] ?? ''
      const res = await authedFetch(`/api/system/config/skills/${slug}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: apiKey || null }),
      })
      const data = await res.json()
      if (data.success) {
        const r2 = await authedFetch('/api/system/config/skills')
        const d2 = await r2.json()
        if (d2) setSkillsConfig(d2.skills || [])
        setSkillKeyEdits(prev => { const n = { ...prev }; delete n[slug]; return n })
      }
    } catch {}
    setSkillSaving(null)
  }

  const handleSkillKeyTest = async (slug: string) => {
    setSkillTesting(slug)
    setSysTestResult(null)
    try {
      const res = await authedFetch(`/api/system/config/skills/${slug}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: skillKeyEdits[slug] || undefined }),
      })
      const data = await res.json()
      setSysTestResult({ ok: data.success, msg: data.success ? t('sys.skills.test.success') : t('sys.skills.test.failed', { error: data.error || '' }) })
    } catch {
      setSysTestResult({ ok: false, msg: t('sys.skills.test.failed', { error: t('common.networkError') }) })
    }
    setSkillTesting(null)
  }

  // Auto backup handlers
  const handleBackupSave = async () => {
    setSysSaving(true)
    setSysTestResult(null)
    try {
      const res = await authedFetch('/api/integrations/autobackup', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sysForm),
      })
      const data = await res.json()
      if (data.success) {
        setSysTestResult({ ok: true, msg: t('integ.backup.saved') })
        const r2 = await authedFetch('/api/integrations/autobackup')
        const d2 = await r2.json()
        if (d2) setAutoBackupConfig(d2)
      }
    } catch {
      setSysTestResult({ ok: false, msg: t('integ.save.failed') })
    }
    setSysSaving(false)
  }

  const [backupRunning, setBackupRunning] = useState(false)
  const handleBackupRunNow = async () => {
    setBackupRunning(true)
    setSysTestResult(null)
    try {
      const res = await authedFetch('/api/integrations/autobackup/run', { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        setSysTestResult({ ok: true, msg: t('integ.backup.result', { count: data.files?.length || 0 }) })
        const r2 = await authedFetch('/api/integrations/autobackup')
        const d2 = await r2.json()
        if (d2) setAutoBackupConfig(d2)
      } else {
        setSysTestResult({ ok: false, msg: data.error || t('integ.backup.failed') })
      }
    } catch {
      setSysTestResult({ ok: false, msg: t('common.networkError') })
    }
    setBackupRunning(false)
  }

  if (loading) {
    return <div className="cap-tab"><div className="cap-loading">{t('cap.loading')}</div></div>
  }
  if (error || !cap) {
    return <div className="cap-tab"><div className="cap-loading">{t('cap.error')}: {error}</div></div>
  }

  const filteredSkills = cap.skills.filter(s => {
    if (!searchQuery) return true
    const q = searchQuery.toLowerCase()
    return s.name.toLowerCase().includes(q)
      || (s.summary || '').toLowerCase().includes(q)
      || s.tags.some(tag => tag.toLowerCase().includes(q))
  })

  const skillsWithKey = skillsConfig.filter(s => s.hasApiKey).length
  const driveConfigured = integConfig?.drive?.enabled && (integConfig?.drive?.hasServiceAccountKey || integConfig?.drive?.serviceAccountKey)

  // Build model options list from modelConfig providers
  const modelOptions: string[] = []
  if (modelConfig?.providers) {
    for (const [provId, prov] of Object.entries(modelConfig.providers) as any[]) {
      for (const m of prov.models || []) {
        modelOptions.push(`${provId}/${m.id}`)
      }
    }
  }

  return (
    <div className="cap-tab">
      {/* Header */}
      <div className="cap-header">
        <span className="cap-title">{t('cap.title')}</span>
      </div>

      {/* Sections */}
      <div className="cap-sections">

        {/* ---- System Settings (NEW) ---- */}
        <div className="cap-section">
          <div className="cap-section-title" onClick={() => toggle('system')}>
            <span className="cap-section-arrow">{collapsed.system ? '>' : 'v'}</span>
            <span>{t('sys.section.title')}</span>
            <span className="cap-section-count">4</span>
          </div>
          {!collapsed.system && (
            <>
              {/* Security */}
              <div className="cap-sys-card">
                <div className="cap-sys-icon">S</div>
                <div className="cap-sys-info">
                  <div className="cap-sys-name">{t('sys.password.title')}</div>
                  <div className="cap-sys-status">{t('sys.password.change')}</div>
                </div>
                <button className="cap-configure-btn" onClick={() => openSysModal('password')}>
                  {t('sys.password.change')}
                </button>
              </div>

              {/* AI Models */}
              <div className="cap-sys-card">
                <div className="cap-sys-icon">M</div>
                <div className="cap-sys-info">
                  <div className="cap-sys-name">{t('sys.models.title')}</div>
                  <div className="cap-sys-status">{modelConfig?.primary || '...'}</div>
                </div>
                <button className="cap-configure-btn" onClick={() => openSysModal('models')}>
                  {t('integ.configure')}
                </button>
              </div>

              {/* Telegram */}
              <div className="cap-sys-card">
                <div className="cap-sys-icon">T</div>
                <div className="cap-sys-info">
                  <div className="cap-sys-name">{t('sys.telegram.title')}</div>
                  <div className="cap-sys-status">
                    {telegramConfig?.enabled ? t('integ.enabled') : t('integ.disabled')}
                  </div>
                </div>
                <button className="cap-configure-btn" onClick={() => openSysModal('telegram')}>
                  {t('integ.configure')}
                </button>
              </div>

              {/* Skill API Keys */}
              <div className="cap-sys-card">
                <div className="cap-sys-icon">K</div>
                <div className="cap-sys-info">
                  <div className="cap-sys-name">{t('sys.skills.title')}</div>
                  <div className="cap-sys-status">{t('sys.skills.configured', { count: skillsWithKey })}</div>
                </div>
                <button className="cap-configure-btn" onClick={() => openSysModal('skills')}>
                  {t('integ.configure')}
                </button>
              </div>
            </>
          )}
        </div>

        {/* ---- Services ---- */}
        <div className="cap-section">
          <div className="cap-section-title" onClick={() => toggle('services')}>
            <span className="cap-section-arrow">{collapsed.services ? '>' : 'v'}</span>
            <span>{t('integ.section.title')}</span>
            <span className="cap-section-count">{5 + 1 + (driveConfigured ? 1 : 0)}</span>
          </div>
          {!collapsed.services && (
            <>
              {[
                { id: 'gmail', titleKey: 'integ.gmail.title', icon: 'M' },
                { id: 'drive', titleKey: 'integ.drive.title', icon: 'D' },
                { id: 'voice', titleKey: 'integ.voice.title', icon: 'V' },
                { id: 'webhook', titleKey: 'integ.webhook.title', icon: 'W' },
                { id: 'gogcli', titleKey: 'integ.gogcli.title', icon: 'G' },
                { id: 'google-sheets', titleKey: 'integ.sheets.title', icon: 'S' },
              ].map(service => {
                const cfg = integConfig?.[service.id]
                const isConfigured = cfg && (
                  service.id === 'gmail' ? (cfg.email || cfg.hasAppPassword) :
                  service.id === 'drive' ? (cfg.serviceAccountKey || cfg.hasServiceAccountKey) :
                  service.id === 'voice' ? (cfg.apiKeyOverride || cfg.hasApiKeyOverride) :
                  service.id === 'webhook' ? (cfg.url || cfg.hasUrl) :
                  service.id === 'gogcli' ? (cfg.account || cfg.hasClientCredentials) :
                  service.id === 'google-sheets' ? (cfg.hasServiceAccountKey || cfg.serviceAccountKey) :
                  false
                )
                const isEnabled = cfg?.enabled
                const statusDot = isEnabled && isConfigured ? 'green' : isConfigured ? 'amber' : 'gray'
                return (
                  <div key={service.id} className={`cap-service-card ${isConfigured ? 'configured' : ''}`}>
                    <div className="cap-service-icon">{service.icon}</div>
                    <div className="cap-service-info">
                      <div className="cap-service-name">{t(service.titleKey)}</div>
                      <div className="cap-service-status">
                        {isConfigured ? t('integ.status.configured') : t('integ.status.notConfigured')}
                      </div>
                    </div>
                    <span className={`cap-dot ${statusDot}`} />
                    <button className="cap-configure-btn" onClick={() => handleConfigureService(service.id)}>
                      {t('integ.configure')}
                    </button>
                  </div>
                )
              })}

              {/* Auto Backup (only show when Drive is configured) */}
              {driveConfigured && (
                <div className={`cap-service-card ${autoBackupConfig?.enabled ? 'configured' : ''}`}>
                  <div className="cap-service-icon">B</div>
                  <div className="cap-service-info">
                    <div className="cap-service-name">{t('integ.backup.title')}</div>
                    <div className="cap-service-status">
                      {autoBackupConfig?.enabled
                        ? `${autoBackupConfig.schedule} @ ${autoBackupConfig.time}`
                        : t('integ.disabled')}
                    </div>
                  </div>
                  <span className={`cap-dot ${autoBackupConfig?.enabled ? 'green' : 'gray'}`} />
                  <button className="cap-configure-btn" onClick={() => openSysModal('backup')}>
                    {t('integ.configure')}
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* ---- Channels ---- */}
        <div className="cap-section">
          <div className="cap-section-title" onClick={() => toggle('channels')}>
            <span className="cap-section-arrow">{collapsed.channels ? '>' : 'v'}</span>
            <span>{t('cap.section.channels')}</span>
            <span className="cap-section-count">{cap.channels.length}</span>
          </div>
          {!collapsed.channels && cap.channels.map(ch => (
            <div key={ch.id} className={`cap-card ${ch.running ? 'active' : 'inactive'}`}>
              <div className="cap-card-header">
                <span className={`cap-dot ${ch.running ? 'green' : ch.enabled ? 'amber' : 'gray'}`} />
                <span className="cap-card-name">{ch.name}</span>
                <span className={`cap-badge ${ch.running ? 'running' : ch.enabled ? 'stopped' : 'disabled'}`}>
                  {ch.running ? t('cap.status.running') : ch.enabled ? t('cap.status.stopped') : t('cap.status.disabled')}
                </span>
              </div>
              <div className="cap-card-meta">
                {ch.config.groups ? <span>{t('cap.channel.groups', { count: ch.config.groups })}</span> : null}
                {ch.config.streaming ? <span>{t('cap.channel.streaming', { mode: ch.config.streaming })}</span> : null}
                {ch.config.dmPolicy ? <span>{t('cap.channel.dmPolicy', { policy: ch.config.dmPolicy })}</span> : null}
              </div>
            </div>
          ))}
        </div>

        {/* ---- Plugins ---- */}
        <div className="cap-section">
          <div className="cap-section-title" onClick={() => toggle('plugins')}>
            <span className="cap-section-arrow">{collapsed.plugins ? '>' : 'v'}</span>
            <span>{t('cap.section.plugins')}</span>
            <span className="cap-section-count">{cap.plugins.length}</span>
          </div>
          {!collapsed.plugins && cap.plugins.map(pl => (
            <div key={pl.id} className={`cap-card ${pl.enabled ? 'active' : 'inactive'}`}>
              <div className="cap-card-header">
                <span className={`cap-dot ${pl.enabled ? 'green' : 'gray'}`} />
                <span className="cap-card-name">{pl.name}</span>
                {pl.version && <span className="cap-card-version">v{pl.version}</span>}
                <span className={`cap-badge ${pl.enabled ? 'enabled' : 'disabled'}`}>
                  {pl.enabled ? t('cap.status.enabled') : t('cap.status.disabled')}
                </span>
              </div>
              {pl.description && <div className="cap-card-desc">{pl.description}</div>}
            </div>
          ))}
        </div>

        {/* ---- Skills ---- */}
        <div className="cap-section">
          <div className="cap-section-title" onClick={() => toggle('skills')}>
            <span className="cap-section-arrow">{collapsed.skills ? '>' : 'v'}</span>
            <span>{t('cap.section.skills')}</span>
            <span className="cap-section-count">{cap.skills.length}</span>
          </div>
          {!collapsed.skills && (
            <>
              <div className="cap-skills-search">
                <input
                  type="text"
                  placeholder={t('cap.skills.search')}
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                />
                {searchQuery && (
                  <button className="cap-search-clear" onClick={() => setSearchQuery('')}>x</button>
                )}
              </div>
              <div className="cap-skills-count">
                {t('cap.skills.count', { count: filteredSkills.length })}
              </div>
              {filteredSkills.length === 0 ? (
                <div className="cap-skills-empty">{t('cap.skills.empty')}</div>
              ) : (
                filteredSkills.map(sk => (
                  <div key={sk.slug} className="cap-card skill-card" onClick={() => handleSkillClick(sk.slug)}>
                    <div className="cap-card-header">
                      <span className={`cap-dot ${sk.hasApiKey ? 'green' : 'blue'}`} />
                      <span className="cap-card-name">{sk.name}</span>
                      {sk.version && <span className="cap-card-version">{t('cap.skills.version', { version: sk.version })}</span>}
                      {sk.hasApiKey && <span className="cap-badge configured">{t('cap.status.configured')}</span>}
                      {sk.hasAssets && <span className="cap-badge assets">{t('cap.skills.assets')}</span>}
                    </div>
                    {sk.summary && <div className="cap-card-desc">{sk.summary}</div>}
                    {sk.tags.length > 0 && (
                      <div className="cap-card-tags">
                        {sk.tags.slice(0, 5).map((tag, i) => (
                          <span key={i} className={`cap-tag ${getTagColor(tag)}`}>{tag}</span>
                        ))}
                        {sk.tags.length > 5 && <span className="cap-tag tag-more">+{sk.tags.length - 5}</span>}
                      </div>
                    )}
                  </div>
                ))
              )}
            </>
          )}
        </div>

        {/* ---- Models ---- */}
        <div className="cap-section">
          <div className="cap-section-title" onClick={() => toggle('models')}>
            <span className="cap-section-arrow">{collapsed.models ? '>' : 'v'}</span>
            <span>{t('cap.section.models')}</span>
            <span className="cap-section-count">{cap.models.length}</span>
          </div>
          {!collapsed.models && cap.models.map(m => (
            <div key={m.id} className={`cap-card ${m.isPrimary ? 'active' : ''}`}>
              <div className="cap-card-header">
                <span className={`cap-dot ${m.isPrimary ? 'blue' : 'gray'}`} />
                <span className="cap-card-name">{m.name}</span>
                <span className={`cap-badge ${m.isPrimary ? 'primary' : 'fallback'}`}>
                  {m.isPrimary ? t('cap.status.primary') : t('cap.status.fallback')}
                </span>
              </div>
              <div className="cap-card-meta">
                <span>{m.provider}</span>
                <span>{t('cap.model.context', { size: m.contextWindowFormatted })}</span>
                <span>{t('cap.model.output', { size: m.maxTokensFormatted })}</span>
                {m.input.includes('image') && <span>{t('cap.model.image')}</span>}
              </div>
            </div>
          ))}
        </div>

        {/* ---- Configure in chat CTA ---- */}
        {onSwitchToChat && (
          <button
            className="cap-chat-cta"
            onClick={() => onSwitchToChat('coo', t('cap.configure.chat.prefill'))}
          >
            {t('cap.configure.chat')}
          </button>
        )}
      </div>

      {/* ---- Skill Detail Modal ---- */}
      {selectedSkill && (
        <div className="cap-modal-overlay" onClick={() => setSelectedSkill(null)}>
          <div className="cap-modal" onClick={e => e.stopPropagation()}>
            <div className="cap-modal-header">
              <div className="cap-modal-title">
                <h2>{selectedSkill.name}</h2>
                {selectedSkill.version && <span className="cap-card-version">{t('cap.skills.version', { version: selectedSkill.version })}</span>}
              </div>
              <button className="cap-modal-close" onClick={() => setSelectedSkill(null)}>x</button>
            </div>
            {detailLoading ? (
              <div className="cap-modal-loading">{t('cap.skills.detail.loading')}</div>
            ) : (
              <div className="cap-modal-body">
                {selectedSkill.summary && (
                  <div className="cap-modal-section">
                    <h3>{t('cap.skills.detail.summary')}</h3>
                    <p>{selectedSkill.summary}</p>
                  </div>
                )}
                {selectedSkill.tags.length > 0 && (
                  <div className="cap-modal-section">
                    <h3>{t('cap.skills.detail.tags')}</h3>
                    <div className="cap-card-tags">
                      {selectedSkill.tags.map((tag, i) => (
                        <span key={i} className={`cap-tag ${getTagColor(tag)}`}>{tag}</span>
                      ))}
                    </div>
                  </div>
                )}
                {selectedSkill.description && (
                  <div className="cap-modal-section">
                    <h3>{t('cap.skills.detail.description')}</h3>
                    <p>{selectedSkill.description}</p>
                  </div>
                )}
                {selectedSkill.markdown && (
                  <div className="cap-modal-section">
                    <h3>{t('cap.skills.detail.content')}</h3>
                    <pre className="cap-modal-markdown">{selectedSkill.markdown}</pre>
                  </div>
                )}
                <div className="cap-modal-section cap-modal-hint">
                  <h3>{t('cap.skills.detail.usage')}</h3>
                  <p>{t('cap.skills.detail.usage.hint')}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ---- Config Modal (gmail/drive/voice/webhook) ---- */}
      {configModal && (
        <div className="cap-modal-overlay" onClick={() => { setConfigModal(null); setConfigForm({}); setTestResult(null); setOauthUrl(null); setOauthCode(''); setOauthRedirectUri(null) }}>
          <div className="cap-modal" onClick={e => e.stopPropagation()}>
            <div className="cap-modal-header">
              <div className="cap-modal-title">
                <h2>{t(`integ.${configModal}.title`)}</h2>
              </div>
              <button className="cap-modal-close" onClick={() => { setConfigModal(null); setConfigForm({}); setTestResult(null); setOauthUrl(null); setOauthCode(''); setOauthRedirectUri(null) }}>x</button>
            </div>
            <div className="cap-modal-body">
              <div className="cap-config-form">
                <div className="cap-config-toggle">
                  <span className="cap-toggle-label">{t('integ.enableService')}</span>
                  <button
                    type="button"
                    className={`cap-toggle-btn ${configForm.enabled ? 'on' : 'off'}`}
                    onClick={() => setConfigForm({ ...configForm, enabled: !configForm.enabled })}
                  >
                    {configForm.enabled ? t('integ.enabled') : t('integ.disabled')}
                  </button>
                </div>
                {configModal === 'gmail' && (
                  <>
                    <div className="cap-config-guide">{t('integ.gmail.guide')}</div>
                    <div className="cap-config-field">
                      <label className="cap-config-label">{t('integ.gmail.email')}</label>
                      <input
                        type="email"
                        className="cap-config-input"
                        value={configForm.email || ''}
                        onChange={e => setConfigForm({ ...configForm, email: e.target.value })}
                        placeholder="your-email@gmail.com"
                      />
                    </div>
                    <div className="cap-config-field">
                      <label className="cap-config-label">{t('integ.gmail.appPassword')}</label>
                      <input
                        type="password"
                        className="cap-config-input"
                        value={configForm.appPassword || ''}
                        onChange={e => setConfigForm({ ...configForm, appPassword: e.target.value })}
                        placeholder="16-character app password"
                      />
                      <span className="cap-config-hint">{t('integ.gmail.hint')}</span>
                    </div>
                  </>
                )}
                {configModal === 'drive' && (
                  <div className="cap-config-field">
                    <div className="cap-config-guide">{t('integ.drive.guide')}</div>
                    <label className="cap-config-label">{t('integ.drive.serviceAccount')}</label>
                    <div className="cap-file-upload">
                      <input
                        type="file"
                        accept=".json"
                        onChange={e => handleFileUpload(e, configModal)}
                        style={{ display: 'none' }}
                        id="drive-key-upload"
                      />
                      <label htmlFor="drive-key-upload" className="cap-file-upload-btn">
                        {t('integ.drive.upload')}
                      </label>
                      {configForm.serviceAccountKey && (
                        <span className="cap-file-upload-status">{t('integ.drive.hasKey')}</span>
                      )}
                    </div>
                  </div>
                )}
                {configModal === 'voice' && (
                  <div className="cap-config-field">
                    <div className="cap-config-guide">{t('integ.voice.guide')}</div>
                    <label className="cap-config-label">{t('integ.voice.apiKey')}</label>
                    <input
                      type="password"
                      className="cap-config-input"
                      value={configForm.apiKeyOverride || ''}
                      onChange={e => setConfigForm({ ...configForm, apiKeyOverride: e.target.value })}
                      placeholder="sk-..."
                    />
                    <span className="cap-config-hint">{t('integ.voice.fromOpenclaw')}</span>
                  </div>
                )}
                {configModal === 'webhook' && (
                  <>
                    <div className="cap-config-guide">{t('integ.webhook.guide')}</div>
                    <div className="cap-config-field">
                      <label className="cap-config-label">{t('integ.webhook.url')}</label>
                      <input
                        type="url"
                        className="cap-config-input"
                        value={configForm.url || ''}
                        onChange={e => setConfigForm({ ...configForm, url: e.target.value })}
                        placeholder="https://discord.com/api/webhooks/..."
                      />
                    </div>
                    <div className="cap-config-field">
                      <label className="cap-config-label">{t('integ.webhook.platform')}</label>
                      <select
                        className="cap-config-select"
                        value={configForm.platform || 'custom'}
                        onChange={e => setConfigForm({ ...configForm, platform: e.target.value })}
                      >
                        <option value="discord">Discord</option>
                        <option value="slack">Slack</option>
                        <option value="feishu">Feishu</option>
                        <option value="custom">Custom</option>
                      </select>
                    </div>
                    <div className="cap-config-field">
                      <label className="cap-config-label">{t('integ.webhook.events')}</label>
                      <div className="cap-events-list">
                        {['error', 'backup', 'cron_fail'].map(ev => (
                          <label key={ev}>
                            <input
                              type="checkbox"
                              checked={(configForm.events || []).includes(ev)}
                              onChange={e => {
                                const events = configForm.events || []
                                setConfigForm({
                                  ...configForm,
                                  events: e.target.checked
                                    ? [...events, ev]
                                    : events.filter((x: string) => x !== ev)
                                })
                              }}
                            />
                            {t(`integ.webhook.events.${ev === 'cron_fail' ? 'cron' : ev}`)}
                          </label>
                        ))}
                      </div>
                    </div>
                  </>
                )}
                {configModal === 'gogcli' && (
                  <>
                    {/* Step 1: Upload credentials */}
                    <div className="cap-config-field">
                      <label className="cap-config-label">{t('integ.gogcli.step1')}</label>
                      <div className="cap-file-upload">
                        <input
                          type="file"
                          accept=".json"
                          onChange={e => {
                            const file = e.target.files?.[0]
                            if (!file) return
                            const reader = new FileReader()
                            reader.onload = () => {
                              try {
                                const parsed = JSON.parse(reader.result as string)
                                setConfigForm(prev => ({ ...prev, clientCredentials: parsed }))
                              } catch {
                                setConfigForm(prev => ({ ...prev, clientCredentials: reader.result as string }))
                              }
                            }
                            reader.readAsText(file)
                          }}
                          style={{ display: 'none' }}
                          id="gogcli-cred-upload"
                        />
                        <label htmlFor="gogcli-cred-upload" className="cap-file-upload-btn">
                          {t('integ.gogcli.upload')}
                        </label>
                        {(configForm.clientCredentials || configForm.hasClientCredentials) && (
                          <span className="cap-file-upload-status">{t('integ.gogcli.hasKey')}</span>
                        )}
                      </div>
                      <span className="cap-config-hint">{t('integ.gogcli.hint')}</span>
                    </div>

                    {/* Step 2: Authorize — only show after credentials saved */}
                    {(configForm.hasClientCredentials || configForm.clientCredentials) && (
                      <div className="cap-config-field">
                        <label className="cap-config-label">{t('integ.gogcli.step2')}</label>
                        {!oauthUrl ? (
                          <button
                            className="cap-file-upload-btn"
                            disabled={oauthLoading}
                            onClick={async () => {
                              setOauthLoading(true)
                              setTestResult(null)
                              // Save credentials first if not saved yet
                              if (configForm.clientCredentials && !configForm.hasClientCredentials) {
                                await authedFetch('/api/integrations/config/gogcli', {
                                  method: 'PUT',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify(configForm),
                                })
                              }
                              try {
                                const res = await authedFetch('/api/integrations/config/gogcli/authorize', { method: 'POST' })
                                const data = await res.json()
                                if (data.authUrl) {
                                  setOauthUrl(data.authUrl)
                                  setOauthRedirectUri(data.redirectUri)
                                } else {
                                  setTestResult({ ok: false, msg: data.error || 'Failed' })
                                }
                              } catch {
                                setTestResult({ ok: false, msg: t('common.networkError') })
                              }
                              setOauthLoading(false)
                            }}
                          >
                            {oauthLoading ? '...' : t('integ.gogcli.authorize')}
                          </button>
                        ) : (
                          <div className="cap-oauth-guide">
                            <p>{t('integ.gogcli.step2.desc')}</p>
                            {oauthRedirectUri && (
                              <div className="cap-config-guide" style={{ marginTop: '8px', fontSize: '10px', wordBreak: 'break-all' }}>
                                {t('integ.gogcli.redirectNote')}<br/>
                                <code>{oauthRedirectUri}</code>
                              </div>
                            )}
                            <a href={oauthUrl} target="_blank" rel="noopener noreferrer" className="cap-oauth-link">
                              {t('integ.gogcli.openLink')}
                            </a>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Show account if authorized */}
                    {configForm.account && (
                      <div className="cap-config-field">
                        <label className="cap-config-label">{t('integ.gogcli.account')}</label>
                        <input
                          type="email"
                          className="cap-config-input"
                          value={configForm.account || ''}
                          disabled
                        />
                      </div>
                    )}
                  </>
                )}
                {configModal === 'google-sheets' && (
                  <>
                    <div className="cap-config-guide">{t('integ.sheets.guide')}</div>
                    <div className="cap-config-field">
                      <label className="cap-config-label">{t('integ.sheets.serviceAccount')}</label>
                      <div className="cap-file-upload">
                        <input
                          type="file"
                          accept=".json"
                          onChange={e => handleFileUpload(e, 'google-sheets')}
                          style={{ display: 'none' }}
                          id="sheets-key-upload"
                        />
                        <label htmlFor="sheets-key-upload" className="cap-file-upload-btn">
                          {t('integ.sheets.upload')}
                        </label>
                        {(configForm.serviceAccountKey || configForm.hasServiceAccountKey) && (
                          <span className="cap-file-upload-status">{t('integ.sheets.hasKey')}</span>
                        )}
                      </div>
                    </div>
                    <div className="cap-config-field">
                      <label className="cap-config-label">{t('integ.sheets.spreadsheetId')}</label>
                      <input
                        type="text"
                        className="cap-config-input"
                        value={configForm.defaultSpreadsheetId || ''}
                        onChange={e => setConfigForm({ ...configForm, defaultSpreadsheetId: e.target.value })}
                        placeholder="1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms"
                      />
                      <span className="cap-config-hint">{t('integ.sheets.hint')}</span>
                    </div>
                  </>
                )}
                {testResult && (
                  <div className={`cap-test-result ${testResult.ok ? 'success' : 'error'}`}>
                    {testResult.msg}
                  </div>
                )}
              </div>
              <div className="cap-config-actions">
                <button onClick={() => handleTestConfig(configModal)} disabled={configTesting}>
                  {configTesting ? t('integ.testing') : t('integ.test')}
                </button>
                <button className="primary" onClick={() => handleSaveConfig(configModal)} disabled={configSaving}>
                  {configSaving ? '...' : t('integ.save')}
                </button>
                <button onClick={() => { setConfigModal(null); setConfigForm({}); setTestResult(null); setOauthUrl(null); setOauthCode(''); setOauthRedirectUri(null) }}>
                  {t('integ.cancel')}
                </button>
                <button className="danger" onClick={() => handleResetConfig(configModal)}>
                  {t('integ.reset')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---- System Settings Modals ---- */}
      {sysModal && (
        <div className="cap-modal-overlay" onClick={() => { setSysModal(null); setSysForm({}); setSysTestResult(null) }}>
          <div className="cap-modal" onClick={e => e.stopPropagation()}>
            <div className="cap-modal-header">
              <div className="cap-modal-title">
                <h2>{
                  sysModal === 'password' ? t('sys.password.title') :
                  sysModal === 'models' ? t('sys.models.title') :
                  sysModal === 'telegram' ? t('sys.telegram.title') :
                  sysModal === 'skills' ? t('sys.skills.title') :
                  sysModal === 'backup' ? t('integ.backup.title') :
                  ''
                }</h2>
              </div>
              <button className="cap-modal-close" onClick={() => { setSysModal(null); setSysForm({}); setSysTestResult(null) }}>x</button>
            </div>
            <div className="cap-modal-body">

              {/* Password Modal */}
              {sysModal === 'password' && (
                <div className="cap-password-form">
                  <div className="cap-config-field">
                    <label className="cap-config-label">{t('sys.password.current')}</label>
                    <input type="password" className="cap-config-input"
                      value={sysForm.currentPassword || ''}
                      onChange={e => setSysForm({ ...sysForm, currentPassword: e.target.value })}
                    />
                  </div>
                  <div className="cap-config-field">
                    <label className="cap-config-label">{t('sys.password.new')}</label>
                    <input type="password" className="cap-config-input"
                      value={sysForm.newPassword || ''}
                      onChange={e => setSysForm({ ...sysForm, newPassword: e.target.value })}
                    />
                  </div>
                  <div className="cap-config-field">
                    <label className="cap-config-label">{t('sys.password.confirm')}</label>
                    <input type="password" className="cap-config-input"
                      value={sysForm.confirmPassword || ''}
                      onChange={e => setSysForm({ ...sysForm, confirmPassword: e.target.value })}
                    />
                  </div>
                  {sysTestResult && (
                    <div className={`cap-test-result ${sysTestResult.ok ? 'success' : 'error'}`}>{sysTestResult.msg}</div>
                  )}
                  <div className="cap-config-actions">
                    <button className="primary" onClick={handlePasswordChange} disabled={sysSaving}>
                      {sysSaving ? '...' : t('sys.password.change')}
                    </button>
                    <button onClick={() => { setSysModal(null); setSysForm({}); setSysTestResult(null) }}>
                      {t('integ.cancel')}
                    </button>
                  </div>
                </div>
              )}

              {/* Models Modal */}
              {sysModal === 'models' && (
                <div className="cap-config-form">
                  <div className="cap-restart-warn">{t('sys.models.restart.warn')}</div>
                  <div className="cap-config-field">
                    <label className="cap-config-label">{t('sys.models.primary')}</label>
                    <select className="cap-config-select"
                      value={sysForm.primary || ''}
                      onChange={e => setSysForm({ ...sysForm, primary: e.target.value })}
                    >
                      {modelOptions.map(opt => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  </div>
                  <div className="cap-config-field">
                    <label className="cap-config-label">{t('sys.models.fallbacks')}</label>
                    <input className="cap-config-input"
                      value={sysForm.fallbacks || ''}
                      onChange={e => setSysForm({ ...sysForm, fallbacks: e.target.value })}
                      placeholder="provider/model, provider/model"
                    />
                  </div>
                  {/* Provider API Keys */}
                  {modelConfig?.providers && Object.entries(modelConfig.providers).map(([provId, prov]: [string, any]) => (
                    <div key={provId} className="cap-config-field">
                      <label className="cap-config-label">{provId} {t('sys.models.provider.apiKey')}</label>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <input type="password" className="cap-config-input"
                          placeholder={prov.apiKeyPreview || 'API Key'}
                          value={(sysForm._providerKeys || {})[provId] || ''}
                          onChange={e => setSysForm({
                            ...sysForm,
                            _providerKeys: { ...(sysForm._providerKeys || {}), [provId]: e.target.value }
                          })}
                        />
                        <button className="cap-skill-row-btn" onClick={() => handleModelsTest(provId)} disabled={sysTesting}>
                          {t('integ.test')}
                        </button>
                      </div>
                    </div>
                  ))}
                  {sysTestResult && (
                    <div className={`cap-test-result ${sysTestResult.ok ? 'success' : 'error'}`}>{sysTestResult.msg}</div>
                  )}
                  <div className="cap-config-actions">
                    <button className="primary" onClick={handleModelsSave} disabled={sysSaving}>
                      {sysSaving ? '...' : t('integ.save')}
                    </button>
                    <button onClick={() => { setSysModal(null); setSysForm({}); setSysTestResult(null) }}>
                      {t('integ.cancel')}
                    </button>
                  </div>
                </div>
              )}

              {/* Telegram Modal */}
              {sysModal === 'telegram' && (
                <div className="cap-config-form">
                  <div className="cap-restart-warn">{t('sys.telegram.restart.warn')}</div>
                  <div className="cap-config-toggle">
                    <label>
                      <input type="checkbox" checked={sysForm.enabled || false}
                        onChange={e => setSysForm({ ...sysForm, enabled: e.target.checked })}
                      />
                      {sysForm.enabled ? t('integ.enabled') : t('integ.disabled')}
                    </label>
                  </div>
                  <div className="cap-config-field">
                    <label className="cap-config-label">{t('sys.telegram.botToken')}</label>
                    <input type="password" className="cap-config-input"
                      value={sysForm.botToken || ''}
                      onChange={e => setSysForm({ ...sysForm, botToken: e.target.value })}
                      placeholder={telegramConfig?.botTokenPreview || 'Bot token'}
                    />
                  </div>
                  <div className="cap-config-field">
                    <label className="cap-config-label">{t('sys.telegram.dmPolicy')}</label>
                    <select className="cap-config-select"
                      value={sysForm.dmPolicy || 'allowlist'}
                      onChange={e => setSysForm({ ...sysForm, dmPolicy: e.target.value })}
                    >
                      <option value="allowlist">Allowlist</option>
                      <option value="open">Open</option>
                      <option value="deny">Deny</option>
                    </select>
                  </div>
                  <div className="cap-config-field">
                    <label className="cap-config-label">{t('sys.telegram.allowFrom')}</label>
                    <input className="cap-config-input"
                      value={sysForm.allowFrom || ''}
                      onChange={e => setSysForm({ ...sysForm, allowFrom: e.target.value })}
                      placeholder="123456789, 987654321"
                    />
                    <span className="cap-config-hint">{t('sys.telegram.allowFrom.hint')}</span>
                  </div>
                  <div className="cap-config-field">
                    <label className="cap-config-label">{t('sys.telegram.streaming')}</label>
                    <select className="cap-config-select"
                      value={sysForm.streaming || 'partial'}
                      onChange={e => setSysForm({ ...sysForm, streaming: e.target.value })}
                    >
                      <option value="partial">Partial</option>
                      <option value="full">Full</option>
                      <option value="off">Off</option>
                    </select>
                  </div>
                  <div className="cap-config-field">
                    <label className="cap-config-label">{t('sys.telegram.groupPolicy')}</label>
                    <select className="cap-config-select"
                      value={sysForm.groupPolicy || 'allowlist'}
                      onChange={e => setSysForm({ ...sysForm, groupPolicy: e.target.value })}
                    >
                      <option value="allowlist">Allowlist</option>
                      <option value="open">Open</option>
                      <option value="deny">Deny</option>
                    </select>
                  </div>
                  {sysTestResult && (
                    <div className={`cap-test-result ${sysTestResult.ok ? 'success' : 'error'}`}>{sysTestResult.msg}</div>
                  )}
                  <div className="cap-config-actions">
                    <button onClick={handleTelegramTest} disabled={sysTesting}>
                      {sysTesting ? t('integ.testing') : t('integ.test')}
                    </button>
                    <button className="primary" onClick={handleTelegramSave} disabled={sysSaving}>
                      {sysSaving ? '...' : t('integ.save')}
                    </button>
                    <button onClick={() => { setSysModal(null); setSysForm({}); setSysTestResult(null) }}>
                      {t('integ.cancel')}
                    </button>
                  </div>
                </div>
              )}

              {/* Skills Modal */}
              {sysModal === 'skills' && (
                <div className="cap-config-form">
                  {skillsConfig.map(sk => (
                    <div key={sk.slug} className="cap-skill-row">
                      <span className={`cap-dot ${sk.hasApiKey ? 'green' : 'gray'}`} />
                      <span className="cap-skill-row-name">{sk.slug}</span>
                      <input
                        type="password"
                        className="cap-skill-row-input"
                        placeholder={sk.apiKeyPreview || (sk.hasApiKey ? t('sys.skills.hasKey') : t('sys.skills.noKey'))}
                        value={skillKeyEdits[sk.slug] ?? ''}
                        onChange={e => setSkillKeyEdits({ ...skillKeyEdits, [sk.slug]: e.target.value })}
                      />
                      <button className="cap-skill-row-btn"
                        onClick={() => handleSkillKeyTest(sk.slug)}
                        disabled={skillTesting === sk.slug}
                      >
                        {t('integ.test')}
                      </button>
                      <button className="cap-skill-row-btn"
                        onClick={() => handleSkillKeySave(sk.slug)}
                        disabled={skillSaving === sk.slug}
                      >
                        {skillSaving === sk.slug ? '...' : t('sys.skills.update')}
                      </button>
                    </div>
                  ))}
                  {sysTestResult && (
                    <div className={`cap-test-result ${sysTestResult.ok ? 'success' : 'error'}`}>{sysTestResult.msg}</div>
                  )}
                  <div className="cap-config-actions">
                    <button onClick={() => { setSysModal(null); setSysForm({}); setSysTestResult(null); setSkillKeyEdits({}) }}>
                      {t('common.close')}
                    </button>
                  </div>
                </div>
              )}

              {/* Auto Backup Modal */}
              {sysModal === 'backup' && (
                <div className="cap-config-form">
                  {!driveConfigured && (
                    <div className="cap-restart-warn">{t('integ.backup.requireDrive')}</div>
                  )}
                  <div className="cap-config-toggle">
                    <label>
                      <input type="checkbox" checked={sysForm.enabled || false}
                        onChange={e => setSysForm({ ...sysForm, enabled: e.target.checked })}
                        disabled={!driveConfigured}
                      />
                      {sysForm.enabled ? t('integ.enabled') : t('integ.disabled')}
                    </label>
                  </div>
                  <div className="cap-config-field">
                    <label className="cap-config-label">{t('integ.backup.schedule')}</label>
                    <select className="cap-config-select"
                      value={sysForm.schedule || 'daily'}
                      onChange={e => setSysForm({ ...sysForm, schedule: e.target.value })}
                    >
                      <option value="daily">{t('integ.backup.schedule.daily')}</option>
                      <option value="weekly">{t('integ.backup.schedule.weekly')}</option>
                    </select>
                  </div>
                  <div className="cap-config-field">
                    <label className="cap-config-label">{t('integ.backup.time')}</label>
                    <input type="time" className="cap-config-input"
                      value={sysForm.time || '03:00'}
                      onChange={e => setSysForm({ ...sysForm, time: e.target.value })}
                    />
                  </div>
                  <div className="cap-config-field">
                    <label className="cap-config-label">{t('integ.backup.lastRun')}</label>
                    <span className="cap-config-hint" style={{ fontStyle: 'normal' }}>
                      {autoBackupConfig?.lastRun ? new Date(autoBackupConfig.lastRun).toLocaleString() : t('integ.backup.never')}
                    </span>
                  </div>
                  {sysTestResult && (
                    <div className={`cap-test-result ${sysTestResult.ok ? 'success' : 'error'}`}>{sysTestResult.msg}</div>
                  )}
                  <div className="cap-config-actions">
                    <button onClick={handleBackupRunNow} disabled={backupRunning || !driveConfigured}>
                      {backupRunning ? t('integ.backup.running') : t('integ.backup.runNow')}
                    </button>
                    <button className="primary" onClick={handleBackupSave} disabled={sysSaving}>
                      {sysSaving ? '...' : t('integ.save')}
                    </button>
                    <button onClick={() => { setSysModal(null); setSysForm({}); setSysTestResult(null) }}>
                      {t('integ.cancel')}
                    </button>
                  </div>
                </div>
              )}

            </div>
          </div>
        </div>
      )}
    </div>
  )
}
