import type { Request } from '../hooks/useAgentState'
import { RequestIcon } from './Icons'
import { useLocale } from '../i18n/index'
import './RequestsTab.css'

interface RequestsTabProps {
  requests: Request[]
}

export default function RequestsTab({ requests }: RequestsTabProps) {
  const { t, locale } = useLocale()

  if (requests.length === 0) {
    return (
      <div className="requests-tab empty">
        <div className="empty-message">
          <div className="empty-icon"><RequestIcon size={32} color="#a0a0b0" /></div>
          <p>{t('requests.empty.title')}</p>
        </div>
      </div>
    )
  }

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    return date.toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <div className="requests-tab">
      {requests.map((request, index) => (
        <div key={index} className="request-card">
          <div className="request-header">
            <span className="request-date">{formatDate(request.date)}</span>
            <span className="badge active">{t('requests.badge.pending')}</span>
          </div>
          <div className="request-filename">{request.filename}</div>
          <div className="request-content">{request.content}</div>
        </div>
      ))}
    </div>
  )
}
