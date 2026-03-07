import { useState } from 'react'
import { DeptIcon, SendIcon } from './Icons'
import { useToast } from './Toast'
import { useLocale } from '../i18n/index'
import { authedFetch } from '../utils/api'
import './BulletinTab.css'

interface BroadcastResponse {
  deptId: string
  name: string
  reply: string
}

interface BulletinTabProps {
  bulletin: string
}

export default function BulletinTab({ bulletin }: BulletinTabProps) {
  const [command, setCommand] = useState('')
  const [broadcasting, setBroadcasting] = useState(false)
  const [responses, setResponses] = useState<BroadcastResponse[]>([])
  const { showToast } = useToast()
  const { t } = useLocale()

  const broadcast = async () => {
    if (!command.trim() || broadcasting) return
    const cmd = command.trim()
    setCommand('')
    setBroadcasting(true)
    setResponses([])

    try {
      const res = await authedFetch('/cmd/api/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: cmd })
      })
      const data = await res.json()
      if (data.success && data.responses) {
        const hasErrors = data.responses.some((r: BroadcastResponse) => r.reply.startsWith('[Error]'))
        if (hasErrors) {
          showToast(t('bulletin.partial.error'))
        }
        setResponses(data.responses)
      } else {
        showToast(data.error || t('bulletin.send.failed'))
      }
    } catch {
      showToast(t('bulletin.network.error'))
    }
    setBroadcasting(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      broadcast()
    }
  }

  return (
    <div className="bulletin-tab">
      {/* Broadcast input */}
      <div className="broadcast-bar">
        <textarea
          className="broadcast-input"
          value={command}
          onChange={e => setCommand(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('bulletin.broadcast.placeholder')}
          rows={1}
          disabled={broadcasting}
        />
        <button
          className="broadcast-btn"
          onClick={broadcast}
          disabled={broadcasting || !command.trim()}
        >
          {broadcasting ? '...' : <SendIcon size={14} color="#ff6b35" />}
        </button>
      </div>

      {/* Broadcasting indicator */}
      {broadcasting && (
        <div className="broadcast-status">
          {t('bulletin.broadcasting')}
        </div>
      )}

      {/* Responses from all departments */}
      {responses.length > 0 && (
        <div className="broadcast-responses">
          <div className="broadcast-responses-title">{t('bulletin.responses.title', { count: responses.length })}</div>
          {responses.map((resp, i) => (
            <div key={i} className={`broadcast-response ${resp.reply.startsWith('[Error]') ? 'error' : ''}`}>
              <div className="broadcast-response-header">
                <DeptIcon deptId={resp.deptId} size={14} />
                <span className="broadcast-dept-name">{resp.name}</span>
              </div>
              <div className="broadcast-response-text">{resp.reply}</div>
            </div>
          ))}
        </div>
      )}

      {/* Bulletin content */}
      {!responses.length && !broadcasting && (
        <div className="bulletin-content">
          {bulletin ? (
            <pre className="markdown-content" style={{ whiteSpace: 'pre-wrap' }}>{bulletin}</pre>
          ) : (
            <div className="bulletin-empty">
              <p>{t('bulletin.empty.title')}</p>
              <p className="bulletin-hint">{t('bulletin.empty.hint')}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
