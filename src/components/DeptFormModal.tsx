import { useState, useEffect, useRef } from 'react'
import { ICON_MAP, type IconProps } from './Icons'
import { authedFetch } from '../utils/api'
import { useLocale } from '../i18n/index'
import './DeptFormModal.css'

interface DeptFormModalProps {
  open: boolean
  onClose: () => void
  editDept?: { id: string; name: string; agent?: string; icon: string; color: string; hue: number; telegramTopicId?: number; order: number; skills?: string[]; apiGroups?: string[] } | null
}

const CORE_API_GROUPS = ['dept-mgmt', 'search', 'bulletin', 'system']
const OPTIONAL_API_GROUPS = [
  { id: 'email', label: 'Email' },
  { id: 'drive', label: 'Google Drive' },
  { id: 'sheets', label: 'Google Sheets' },
  { id: 'subagents', label: 'Sub-agents' },
  { id: 'export', label: 'Export' },
  { id: 'cron', label: 'Cron Jobs' },
  { id: 'workflows', label: 'Workflows' },
  { id: 'files', label: 'Files' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'auto-backup', label: 'Auto Backup' },
  { id: 'skills-api', label: 'Skills API' },
  { id: 'external-tools', label: 'External Tools' },
]

interface SkillItem {
  slug: string
  name: string
  tags?: string[]
}

const PRESET_COLORS = [
  { color: '#fbbf24', hue: 45 },
  { color: '#00d4aa', hue: 160 },
  { color: '#60a5fa', hue: 220 },
  { color: '#a78bfa', hue: 260 },
  { color: '#f472b6', hue: 330 },
  { color: '#4ade80', hue: 140 },
  { color: '#f97316', hue: 25 },
  { color: '#94a3b8', hue: 200 },
]

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 30) || 'dept'
}

export default function DeptFormModal({ open, onClose, editDept }: DeptFormModalProps) {
  const { t } = useLocale()
  const isEdit = !!editDept

  const [id, setId] = useState('')
  const [name, setName] = useState('')
  const [agent, setAgent] = useState('')
  const [icon, setIcon] = useState('bolt')
  const [color, setColor] = useState('#fbbf24')
  const [hue, setHue] = useState(45)
  const [topicId, setTopicId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Skills & API groups
  const [skills, setSkills] = useState<string[]>(['*'])
  const [apiGroups, setApiGroups] = useState<string[]>(['*'])
  const [availableSkills, setAvailableSkills] = useState<SkillItem[]>([])
  const [skillsLoading, setSkillsLoading] = useState(false)
  const [skillSearch, setSkillSearch] = useState('')
  const [showApiSection, setShowApiSection] = useState(false)
  const [showSkillSection, setShowSkillSection] = useState(false)

  const dialogRef = useRef<HTMLDivElement>(null)
  const previousActiveElement = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (editDept) {
      setId(editDept.id)
      setName(editDept.name)
      setAgent(editDept.agent || '')
      setIcon(editDept.icon)
      setColor(editDept.color)
      setHue(editDept.hue)
      setTopicId(editDept.telegramTopicId !== undefined ? String(editDept.telegramTopicId) : '')
      setSkills(editDept.skills || ['*'])
      setApiGroups(editDept.apiGroups || ['*'])
    } else {
      setId('')
      setName('')
      setAgent('')
      setIcon('bolt')
      setColor('#fbbf24')
      setHue(45)
      setTopicId('')
      setSkills(['*'])
      setApiGroups(['*'])
    }
    setError('')
    setShowApiSection(false)
    setShowSkillSection(false)
  }, [editDept, open])

  // Load available skills when skill section is opened
  useEffect(() => {
    if (showSkillSection && availableSkills.length === 0 && !skillsLoading) {
      setSkillsLoading(true)
      interface RawSkill {
        slug: string
        name?: string
        tags?: string[]
      }
      authedFetch('/api/skills')
        .then(r => r.json())
        .then(data => {
          if (Array.isArray(data.skills)) {
            setAvailableSkills((data.skills as RawSkill[]).map((s) => ({ slug: s.slug, name: s.name || s.slug, tags: s.tags || [] })))
          }
        })
        .catch((err) => {
          if (import.meta.env.DEV) console.warn('Fetch skills failed:', err);
        })
        .finally(() => setSkillsLoading(false))
    }
  }, [showSkillSection])

  // Focus trap and Escape key handler
  useEffect(() => {
    if (!open) return

    // Save previous focus
    previousActiveElement.current = document.activeElement as HTMLElement

    // Focus first input
    const timer = setTimeout(() => {
      const firstInput = dialogRef.current?.querySelector<HTMLElement>('input, button, select, textarea')
      firstInput?.focus()
    }, 50)

    // Escape key handler
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleEscape)

    // Restore focus on unmount
    return () => {
      clearTimeout(timer)
      document.removeEventListener('keydown', handleEscape)
      previousActiveElement.current?.focus()
    }
  }, [open, onClose])

  const handleNameChange = (v: string) => {
    setName(v)
    if (!isEdit) setId(slugify(v))
  }

  const handleColorSelect = (c: { color: string; hue: number }) => {
    setColor(c.color)
    setHue(c.hue)
  }

  const handleSubmit = async () => {
    if (!name.trim()) { setError(t('dept.error.nameRequired')); return }
    if (!isEdit && !id.trim()) { setError(t('dept.error.idRequired')); return }

    interface DeptRequestBody {
      id?: string
      name: string
      agent: string
      icon: string
      color: string
      hue: number
      skills: string[]
      apiGroups: string[]
      telegramTopicId?: number
    }
    setSaving(true)
    setError('')
    try {
      const body: DeptRequestBody = { name, agent: agent || name, icon, color, hue, skills, apiGroups }
      if (topicId) body.telegramTopicId = parseInt(topicId, 10)

      let res
      if (isEdit) {
        res = await authedFetch(`/api/departments/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      } else {
        body.id = id
        res = await authedFetch('/api/departments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      }

      const data = await res.json()
      if (!data.success) throw new Error(data.error || 'Failed')
      onClose()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return (
    <div className="dept-modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="dept-modal-title">
      <div className="dept-modal" onClick={e => e.stopPropagation()} ref={dialogRef}>
        <div className="dept-modal-header">
          <h3 id="dept-modal-title">{isEdit ? t('dept.edit') : t('dept.create')}</h3>
          <button className="dept-modal-close" onClick={onClose} aria-label="Close">&times;</button>
        </div>

        <div className="dept-modal-body">
          {!isEdit && (
            <div className="dept-field">
              <label>{t('dept.field.id')}</label>
              <input value={id} onChange={e => setId(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))} placeholder="engineering" aria-label="部门ID" />
            </div>
          )}
          <div className="dept-field">
            <label>{t('dept.field.name')}</label>
            <input value={name} onChange={e => handleNameChange(e.target.value)} placeholder={t('dept.field.namePlaceholder')} aria-label="部门名称" />
          </div>
          <div className="dept-field">
            <label>{t('dept.field.agent')}</label>
            <input value={agent} onChange={e => setAgent(e.target.value)} placeholder={t('dept.field.agentPlaceholder')} aria-label="代理名称" />
          </div>

          <div className="dept-field">
            <label>{t('dept.field.icon')}</label>
            <div className="icon-grid">
              {Object.keys(ICON_MAP).map(iconName => {
                const IconComponent = ICON_MAP[iconName]
                return (
                  <button
                    key={iconName}
                    className={`icon-option ${icon === iconName ? 'selected' : ''}`}
                    onClick={() => setIcon(iconName)}
                    title={iconName}
                  >
                    <IconComponent size={20} color={icon === iconName ? color : '#a0a0b0'} />
                  </button>
                )
              })}
            </div>
          </div>

          <div className="dept-field">
            <label>{t('dept.field.color')}</label>
            <div className="color-grid">
              {PRESET_COLORS.map(c => (
                <button
                  key={c.color}
                  className={`color-option ${color === c.color ? 'selected' : ''}`}
                  style={{ backgroundColor: c.color }}
                  onClick={() => handleColorSelect(c)}
                />
              ))}
            </div>
          </div>

          <div className="dept-field">
            <label>{t('dept.field.topicId')}</label>
            <input value={topicId} onChange={e => setTopicId(e.target.value.replace(/\D/g, ''))} placeholder={t('dept.field.topicIdPlaceholder')} aria-label="Telegram话题ID" />
          </div>

          {/* API Groups Section (collapsible) */}
          <div className="dept-section">
            <button className="dept-section-toggle" onClick={() => setShowApiSection(!showApiSection)}>
              <span className="dept-section-arrow">{showApiSection ? '▾' : '▸'}</span>
              <span>{t('dept.field.apiGroups')}</span>
              <span className="dept-section-badge">
                {apiGroups[0] === '*' ? 'ALL' : apiGroups.length}
              </span>
            </button>
            {showApiSection && (
              <div className="dept-section-content">
                <div className="dept-tags-row">
                  {CORE_API_GROUPS.map(g => (
                    <span key={g} className="dept-tag core">{g}</span>
                  ))}
                  <span className="dept-tag-hint">{t('dept.field.apiGroups.core')}</span>
                </div>
                <div className="dept-check-row">
                  <label className="dept-check">
                    <input
                      type="checkbox"
                      checked={apiGroups[0] === '*'}
                      onChange={e => {
                        if (e.target.checked) {
                          setApiGroups(['*'])
                        } else {
                          setApiGroups([])
                        }
                      }}
                    />
                    <span>{t('dept.field.apiGroups.selectAll')}</span>
                  </label>
                </div>
                {apiGroups[0] !== '*' && (
                  <div className="dept-check-grid">
                    {OPTIONAL_API_GROUPS.map(g => (
                      <label key={g.id} className="dept-check">
                        <input
                          type="checkbox"
                          checked={apiGroups.includes(g.id)}
                          onChange={e => {
                            if (e.target.checked) {
                              setApiGroups(prev => [...prev, g.id])
                            } else {
                              setApiGroups(prev => prev.filter(x => x !== g.id))
                            }
                          }}
                        />
                        <span>{g.label}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Skills Section (collapsible) */}
          <div className="dept-section">
            <button className="dept-section-toggle" onClick={() => setShowSkillSection(!showSkillSection)}>
              <span className="dept-section-arrow">{showSkillSection ? '▾' : '▸'}</span>
              <span>{t('dept.field.skills')}</span>
              <span className="dept-section-badge">
                {skills[0] === '*' ? 'ALL' : skills.length}
              </span>
            </button>
            {showSkillSection && (
              <div className="dept-section-content">
                <label className="dept-check">
                  <input
                    type="checkbox"
                    checked={skills[0] === '*'}
                    onChange={e => {
                      if (e.target.checked) {
                        setSkills(['*'])
                      } else {
                        setSkills([])
                      }
                    }}
                  />
                  <span>{t('dept.field.skills.all')}</span>
                </label>
                {skills[0] !== '*' && (
                  <>
                    <input
                      className="dept-skill-search"
                      value={skillSearch}
                      onChange={e => setSkillSearch(e.target.value)}
                      placeholder={t('dept.field.skills.search')}
                      aria-label="搜索技能"
                    />
                    <div className="dept-skill-list">
                      {skillsLoading ? (
                        <div className="dept-skill-loading">{t('dept.field.skills.loading')}</div>
                      ) : (
                        (() => {
                          const filtered = availableSkills.filter(s =>
                            !skillSearch || s.slug.includes(skillSearch.toLowerCase()) || s.name.toLowerCase().includes(skillSearch.toLowerCase())
                          )
                          return filtered.length === 0 ? (
                            <div className="dept-skill-loading">{t('dept.field.skills.empty')}</div>
                          ) : (
                            filtered.map(s => (
                              <label key={s.slug} className="dept-check dept-skill-item">
                                <input
                                  type="checkbox"
                                  checked={skills.includes(s.slug)}
                                  onChange={e => {
                                    if (e.target.checked) {
                                      setSkills(prev => [...prev, s.slug])
                                    } else {
                                      setSkills(prev => prev.filter(x => x !== s.slug))
                                    }
                                  }}
                                />
                                <span className="dept-skill-name">{s.name}</span>
                                {s.tags?.[0] && <span className="dept-skill-tag">{s.tags[0]}</span>}
                              </label>
                            ))
                          )
                        })()
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {error && <div className="dept-error">{error}</div>}
        </div>

        <div className="dept-modal-footer">
          <button className="dept-btn-cancel" onClick={onClose}>{t('common.cancel')}</button>
          <button className="dept-btn-save" onClick={handleSubmit} disabled={saving}>
            {saving ? t('common.saving') : (isEdit ? t('common.save') : t('dept.create'))}
          </button>
        </div>
      </div>
    </div>
  )
}
