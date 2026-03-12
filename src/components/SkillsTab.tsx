import { useState, useEffect, useCallback } from 'react'
import { useLocale } from '../i18n/index'
import { authedFetch } from '../utils/api'
import './SkillsTab.css'

interface SkillSummary {
  slug: string
  name: string
  summary: string | null
  description: string | null
  tags: string[]
  version: string | null
  hasAssets: boolean
  ownerId: string | null
  publishedAt: string | null
}

interface SkillDetail extends SkillSummary {
  markdown: string | null
  meta: Record<string, unknown>
}

export default function SkillsTab() {
  const { t } = useLocale()
  const [skills, setSkills] = useState<SkillSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail] = useState<SkillDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editFields, setEditFields] = useState({ name: '', summary: '', tags: '', content: '' })
  const [status, setStatus] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [showInstall, setShowInstall] = useState(false)

  // Fetch skills list
  const fetchSkills = useCallback(async () => {
    try {
      setLoading(true)
      const res = await authedFetch('/api/skills')
      const data = await res.json()
      setSkills(data.skills || [])
    } catch {
      setStatus({ type: 'error', text: t('skills.error.fetch') })
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => { fetchSkills() }, [fetchSkills])

  // Fetch detail when selected
  useEffect(() => {
    if (!selected) { setDetail(null); setEditing(false); return }
    let cancelled = false
    setDetailLoading(true)
    authedFetch(`/api/skills/${selected}`)
      .then(r => r.json())
      .then(data => {
        if (!cancelled && data.skill) {
          setDetail(data.skill)
          setEditFields({
            name: data.skill.name || '',
            summary: data.skill.summary || '',
            tags: (data.skill.tags || []).join(', '),
            content: data.skill.markdown || '',
          })
        }
      })
      .catch(() => { if (!cancelled) setStatus({ type: 'error', text: t('skills.error.detail') }) })
      .finally(() => { if (!cancelled) setDetailLoading(false) })
    return () => { cancelled = true }
  }, [selected, t])

  // Filter skills
  const filtered = skills.filter(s => {
    if (!search) return true
    const q = search.toLowerCase()
    return s.name.toLowerCase().includes(q) ||
      s.slug.toLowerCase().includes(q) ||
      (s.summary || '').toLowerCase().includes(q) ||
      s.tags.some(tag => tag.toLowerCase().includes(q))
  })

  // Save edit
  const handleSave = async () => {
    if (!selected) return
    try {
      const res = await authedFetch(`/api/skills/${selected}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editFields.name,
          summary: editFields.summary,
          tags: editFields.tags,
          content: editFields.content,
        }),
      })
      const data = await res.json()
      if (data.success) {
        setStatus({ type: 'success', text: t('skills.save.success') })
        setEditing(false)
        fetchSkills()
        // Refresh detail
        setSelected(null)
        setTimeout(() => setSelected(selected), 50)
      } else {
        setStatus({ type: 'error', text: data.error || 'Error' })
      }
    } catch {
      setStatus({ type: 'error', text: t('common.networkError') })
    }
  }

  // Delete
  const handleDelete = async () => {
    if (!selected || !detail) return
    if (selected === 'cmd-center') {
      setStatus({ type: 'error', text: t('skills.delete.protected') })
      return
    }
    if (!confirm(t('skills.delete.confirm', { name: detail.name }))) return
    try {
      const res = await authedFetch(`/api/skills/${selected}`, { method: 'DELETE' })
      const data = await res.json()
      if (data.success) {
        setSelected(null)
        setDetail(null)
        fetchSkills()
      } else {
        setStatus({ type: 'error', text: data.error || 'Error' })
      }
    } catch {
      setStatus({ type: 'error', text: t('common.networkError') })
    }
  }

  // Clear status after 3s
  useEffect(() => {
    if (!status) return
    const t = setTimeout(() => setStatus(null), 3000)
    return () => clearTimeout(t)
  }, [status])

  return (
    <div className="skills-tab">
      <div className="skills-header">
        <span className="skills-header-title">{t('app.tab.skills')}</span>
        <div className="skills-header-actions">
          <button className="skills-header-btn" onClick={() => setShowInstall(true)}>
            {t('skills.install')}
          </button>
          <button className="skills-header-btn" onClick={() => setShowCreate(true)}>
            {t('skills.create')}
          </button>
        </div>
      </div>

      <div className="skills-search">
        <input
          type="text"
          placeholder={t('skills.search.placeholder')}
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {status && (
        <div className={`skills-status ${status.type}`}>{status.text}</div>
      )}

      <div className="skills-count">{t('skills.count', { count: filtered.length })}</div>

      {loading ? (
        <div className="skills-loading">{t('skills.loading')}</div>
      ) : filtered.length === 0 ? (
        <div className="skills-empty">{t('skills.empty')}</div>
      ) : (
        <div className="skills-body">
          <div className="skills-grid">
            {filtered.map(skill => (
              <div
                key={skill.slug}
                className={`skill-card ${selected === skill.slug ? 'selected' : ''}`}
                onClick={() => setSelected(selected === skill.slug ? null : skill.slug)}
              >
                <div className="skill-card-name">{skill.name}</div>
                {skill.summary && <div className="skill-card-summary">{skill.summary}</div>}
                <div className="skill-card-meta">
                  {skill.tags.slice(0, 2).map(tag => (
                    <span key={tag} className="skill-card-tag">{tag}</span>
                  ))}
                  {skill.version && (
                    <span className="skill-card-version">v{skill.version}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Detail Panel */}
      {selected && (
        <div className="skills-detail">
          {detailLoading ? (
            <div className="skills-loading">{t('skills.detail.loading')}</div>
          ) : detail ? (
            <>
              <div className="skills-detail-header">
                <span className="skills-detail-name">{detail.name}</span>
                <div className="skills-detail-actions">
                  {!editing && (
                    <button className="skills-btn" onClick={() => setEditing(true)}>
                      {t('skills.edit')}
                    </button>
                  )}
                  <button className="skills-btn" onClick={() => { setSelected(null); setEditing(false) }}>
                    {t('skills.detail.close')}
                  </button>
                </div>
              </div>

              {editing ? (
                <>
                  <div className="skills-detail-field">
                    <label>{t('skills.field.name')}</label>
                    <input value={editFields.name} onChange={e => setEditFields(f => ({ ...f, name: e.target.value }))} />
                  </div>
                  <div className="skills-detail-field">
                    <label>{t('skills.field.summary')}</label>
                    <input value={editFields.summary} onChange={e => setEditFields(f => ({ ...f, summary: e.target.value }))} />
                  </div>
                  <div className="skills-detail-field">
                    <label>{t('skills.field.tags')}</label>
                    <input value={editFields.tags} onChange={e => setEditFields(f => ({ ...f, tags: e.target.value }))} />
                  </div>
                  <div className="skills-detail-field">
                    <label>{t('skills.field.content')}</label>
                    <textarea
                      value={editFields.content}
                      onChange={e => setEditFields(f => ({ ...f, content: e.target.value }))}
                    />
                  </div>
                  <div className="skills-detail-footer">
                    <button className="skills-btn danger" onClick={handleDelete}>
                      {t('skills.delete')}
                    </button>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="skills-btn" onClick={() => setEditing(false)}>
                        {t('common.cancel')}
                      </button>
                      <button className="skills-btn primary" onClick={handleSave}>
                        {t('skills.save')}
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  {detail.summary && (
                    <div className="skills-detail-field">
                      <label>{t('skills.detail.summary')}</label>
                      <div className="field-value">{detail.summary}</div>
                    </div>
                  )}
                  {detail.description && (
                    <div className="skills-detail-field">
                      <label>{t('skills.detail.description')}</label>
                      <div className="field-value">{detail.description}</div>
                    </div>
                  )}
                  {detail.tags.length > 0 && (
                    <div className="skills-detail-field">
                      <label>{t('skills.detail.tags')}</label>
                      <div className="skills-detail-tags">
                        {detail.tags.map(tag => (
                          <span key={tag} className="skill-card-tag">{tag}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {detail.markdown && (
                    <div className="skills-detail-field">
                      <label>{t('skills.detail.content')}</label>
                      <pre style={{ fontSize: 11, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', margin: 0 }}>
                        {detail.markdown}
                      </pre>
                    </div>
                  )}
                  <div className="skills-detail-footer">
                    <button className="skills-btn danger" onClick={handleDelete}>
                      {t('skills.delete')}
                    </button>
                    <button className="skills-btn" onClick={() => setEditing(true)}>
                      {t('skills.edit')}
                    </button>
                  </div>
                </>
              )}
            </>
          ) : null}
        </div>
      )}

      {/* Create Modal */}
      {showCreate && <CreateModal t={t} onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); fetchSkills() }} />}

      {/* Install Modal */}
      {showInstall && <InstallModal t={t} onClose={() => setShowInstall(false)} onInstalled={() => { setShowInstall(false); fetchSkills() }} />}
    </div>
  )
}

/* ---- Create Skill Modal ---- */
function CreateModal({ t, onClose, onCreated }: {
  t: (key: string, params?: Record<string, string | number>) => string
  onClose: () => void
  onCreated: () => void
}) {
  const [slug, setSlug] = useState('')
  const [name, setName] = useState('')
  const [summary, setSummary] = useState('')
  const [tags, setTags] = useState('')
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleCreate = async () => {
    if (!slug || !name) return
    setSaving(true)
    setError('')
    try {
      const res = await authedFetch('/api/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, name, summary, tags, content }),
      })
      const data = await res.json()
      if (data.success) {
        onCreated()
      } else {
        setError(data.error || 'Error')
      }
    } catch {
      setError(t('common.networkError'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="skills-modal-overlay" onClick={onClose}>
      <div className="skills-modal" onClick={e => e.stopPropagation()}>
        <div className="skills-modal-header">
          <h3>{t('skills.create')}</h3>
          <button className="skills-modal-close" onClick={onClose}>&times;</button>
        </div>
        <div className="skills-modal-body">
          <div className="skills-modal-field">
            <label>{t('skills.create.slug')}</label>
            <input
              value={slug}
              onChange={e => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
              placeholder={t('skills.create.slug.placeholder')}
            />
          </div>
          <div className="skills-modal-field">
            <label>{t('skills.field.name')}</label>
            <input value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div className="skills-modal-field">
            <label>{t('skills.field.summary')}</label>
            <input value={summary} onChange={e => setSummary(e.target.value)} />
          </div>
          <div className="skills-modal-field">
            <label>{t('skills.field.tags')}</label>
            <input value={tags} onChange={e => setTags(e.target.value)} />
          </div>
          <div className="skills-modal-field">
            <label>{t('skills.field.content')}</label>
            <textarea value={content} onChange={e => setContent(e.target.value)} />
          </div>
          {error && <div className="skills-status error">{error}</div>}
        </div>
        <div className="skills-modal-footer">
          <button className="skills-btn" onClick={onClose}>{t('common.cancel')}</button>
          <button className="skills-btn primary" onClick={handleCreate} disabled={saving || !slug || !name}>
            {saving ? '...' : t('common.create')}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ---- Install Skill Modal ---- */
function InstallModal({ t, onClose, onInstalled }: {
  t: (key: string, params?: Record<string, string | number>) => string
  onClose: () => void
  onInstalled: () => void
}) {
  const [url, setUrl] = useState('')
  const [installing, setInstalling] = useState(false)
  const [error, setError] = useState('')

  const handleInstall = async () => {
    if (!url) return
    setInstalling(true)
    setError('')
    try {
      const res = await authedFetch('/api/skills/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      const data = await res.json()
      if (data.success) {
        onInstalled()
      } else {
        setError(data.error || t('skills.install.error'))
      }
    } catch {
      setError(t('common.networkError'))
    } finally {
      setInstalling(false)
    }
  }

  return (
    <div className="skills-modal-overlay" onClick={onClose}>
      <div className="skills-modal" onClick={e => e.stopPropagation()} style={{ width: 380 }}>
        <div className="skills-modal-header">
          <h3>{t('skills.install')}</h3>
          <button className="skills-modal-close" onClick={onClose}>&times;</button>
        </div>
        <div className="skills-modal-body">
          <div className="skills-modal-field">
            <label>URL</label>
            <input
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder={t('skills.install.url.placeholder')}
            />
          </div>
          {error && <div className="skills-status error">{error}</div>}
        </div>
        <div className="skills-modal-footer">
          <button className="skills-btn" onClick={onClose}>{t('common.cancel')}</button>
          <button className="skills-btn primary" onClick={handleInstall} disabled={installing || !url}>
            {installing ? t('skills.install.loading') : t('skills.install')}
          </button>
        </div>
      </div>
    </div>
  )
}
