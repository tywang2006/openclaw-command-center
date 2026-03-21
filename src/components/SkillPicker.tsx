import { useState, useEffect, useCallback } from 'react'
import { useLocale } from '../i18n/index'
import { authedFetch } from '../utils/api'
import './SkillPicker.css'

interface Skill {
  slug: string
  name: string
  summary: string | null
  description: string | null
  tags: string[]
  version: string | null
}

interface SkillPickerProps {
  open: boolean
  onClose: () => void
  selectedDeptId: string | null
  deptName: string
  onExecuted: (skillName: string, reply: string) => void
}

export default function SkillPicker({ open, onClose, selectedDeptId, deptName, onExecuted }: SkillPickerProps) {
  const [skills, setSkills] = useState<Skill[]>([])
  const [loading, setLoading] = useState(false)
  const [executing, setExecuting] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [expandedSlug, setExpandedSlug] = useState<string | null>(null)
  const [skillDetail, setSkillDetail] = useState<{ markdown: string } | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [lastError, setLastError] = useState<string | null>(null)
  const { t } = useLocale()

  useEffect(() => {
    if (!open) return
    setLoading(true)
    authedFetch('/api/skills')
      .then(r => r.json())
      .then(data => setSkills(data.skills || []))
      .catch(() => setSkills([]))
      .finally(() => setLoading(false))
  }, [open])

  useEffect(() => {
    if (!expandedSlug) {
      setSkillDetail(null)
      return
    }
    const abortController = new AbortController()
    setDetailLoading(true)
    authedFetch(`/api/skills/${expandedSlug}`, { signal: abortController.signal })
      .then(res => res.json())
      .then(data => setSkillDetail({ markdown: data.skill?.markdown || '' }))
      .catch(err => {
        if (err.name !== 'AbortError') {
          setSkillDetail({ markdown: '' })
        }
      })
      .finally(() => setDetailLoading(false))
    return () => abortController.abort()
  }, [expandedSlug])

  const handleExpand = useCallback((slug: string) => {
    if (expandedSlug === slug) {
      setExpandedSlug(null)
    } else {
      setExpandedSlug(slug)
    }
  }, [expandedSlug])

  const handleExecute = useCallback(async (skill: Skill) => {
    if (!selectedDeptId || executing) return
    setExecuting(skill.slug)
    setLastError(null)
    try {
      const res = await authedFetch(`/api/skills/${skill.slug}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deptId: selectedDeptId }),
      })
      const data = await res.json()
      if (data.success && data.reply) {
        onExecuted(skill.name, data.reply)
        onClose()
      } else {
        const errorMsg = `[${t('skill.exec.failed')}] ${data.error || ''}`
        setLastError(errorMsg)
        onExecuted(skill.name, errorMsg)
      }
    } catch {
      const errorMsg = `[${t('skill.exec.error')}]`
      setLastError(errorMsg)
      onExecuted(skill.name, errorMsg)
    }
    setExecuting(null)
  }, [selectedDeptId, executing, onExecuted, onClose, t])

  if (!open) return null

  const filtered = filter
    ? skills.filter(s =>
        s.name.toLowerCase().includes(filter.toLowerCase()) ||
        s.tags.some(tag => tag.toLowerCase().includes(filter.toLowerCase())) ||
        (s.summary && s.summary.toLowerCase().includes(filter.toLowerCase()))
      )
    : skills

  return (
    <div className="skill-picker-overlay" onClick={onClose}>
      <div className="skill-picker" onClick={e => e.stopPropagation()}>
        <div className="skill-picker-header">
          <h3>{t('skill.picker.title')}</h3>
          <span className="skill-picker-target">{deptName}</span>
          <button className="skill-picker-close" onClick={onClose}>&times;</button>
        </div>

        <div className="skill-picker-search">
          <input
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder={t('skill.picker.search')}
            autoFocus
          />
        </div>

        {lastError && (
          <div style={{ padding: '8px 12px', margin: '8px 12px', background: 'var(--danger-a8)', color: 'var(--text-primary)', borderRadius: '4px', fontSize: '12px' }}>
            {lastError}
          </div>
        )}

        <div className="skill-picker-list">
          {loading ? (
            <div className="skill-picker-empty">{t('skill.picker.loading')}</div>
          ) : filtered.length === 0 ? (
            <div className="skill-picker-empty">{t('skill.picker.empty')}</div>
          ) : (
            filtered.map(skill => (
              <div key={skill.slug} className={`skill-card ${expandedSlug === skill.slug ? 'expanded' : ''}`}>
                <div className="skill-card-header" onClick={() => handleExpand(skill.slug)}>
                  <div className="skill-card-info">
                    <span className="skill-card-name">{skill.name}</span>
                    {skill.version && <span className="skill-card-ver">v{skill.version}</span>}
                  </div>
                  {skill.summary && <p className="skill-card-summary">{skill.summary}</p>}
                  {skill.tags.length > 0 && (
                    <div className="skill-card-tags">
                      {skill.tags.map(tag => (
                        <span key={tag} className="skill-tag">{tag}</span>
                      ))}
                    </div>
                  )}
                </div>
                {expandedSlug === skill.slug && (
                  <div className="skill-card-detail">
                    {detailLoading ? (
                      <p className="skill-detail-loading">{t('skill.picker.loading')}</p>
                    ) : skillDetail?.markdown ? (
                      <pre className="skill-detail-body">{skillDetail.markdown}</pre>
                    ) : null}
                    <button
                      className="skill-exec-btn"
                      onClick={() => handleExecute(skill)}
                      disabled={!selectedDeptId || executing === skill.slug}
                    >
                      {executing === skill.slug
                        ? t('skill.exec.running')
                        : t('skill.exec.run', { dept: deptName })}
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
