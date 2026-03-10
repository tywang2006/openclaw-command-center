import { useState, useEffect } from 'react'
import { ICON_MAP, type IconProps } from './Icons'
import { authedFetch } from '../utils/api'
import { useLocale } from '../i18n/index'
import './DeptFormModal.css'

interface DeptFormModalProps {
  open: boolean
  onClose: () => void
  editDept?: { id: string; name: string; agent?: string; icon: string; color: string; hue: number; telegramTopicId?: number; order: number } | null
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

  useEffect(() => {
    if (editDept) {
      setId(editDept.id)
      setName(editDept.name)
      setAgent(editDept.agent || '')
      setIcon(editDept.icon)
      setColor(editDept.color)
      setHue(editDept.hue)
      setTopicId(editDept.telegramTopicId !== undefined ? String(editDept.telegramTopicId) : '')
    } else {
      setId('')
      setName('')
      setAgent('')
      setIcon('bolt')
      setColor('#fbbf24')
      setHue(45)
      setTopicId('')
    }
    setError('')
  }, [editDept, open])

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

    setSaving(true)
    setError('')
    try {
      const body: any = { name, agent: agent || name, icon, color, hue }
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
    } catch (err: any) {
      setError(err.message || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return (
    <div className="dept-modal-overlay" onClick={onClose}>
      <div className="dept-modal" onClick={e => e.stopPropagation()}>
        <div className="dept-modal-header">
          <h3>{isEdit ? t('dept.edit') : t('dept.create')}</h3>
          <button className="dept-modal-close" onClick={onClose}>&times;</button>
        </div>

        <div className="dept-modal-body">
          {!isEdit && (
            <div className="dept-field">
              <label>{t('dept.field.id')}</label>
              <input value={id} onChange={e => setId(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))} placeholder="engineering" />
            </div>
          )}
          <div className="dept-field">
            <label>{t('dept.field.name')}</label>
            <input value={name} onChange={e => handleNameChange(e.target.value)} placeholder={t('dept.field.namePlaceholder')} />
          </div>
          <div className="dept-field">
            <label>{t('dept.field.agent')}</label>
            <input value={agent} onChange={e => setAgent(e.target.value)} placeholder={t('dept.field.agentPlaceholder')} />
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
            <input value={topicId} onChange={e => setTopicId(e.target.value.replace(/\D/g, ''))} placeholder={t('dept.field.topicIdPlaceholder')} />
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
