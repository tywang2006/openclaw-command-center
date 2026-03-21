import { useState } from 'react'
import type { Request } from '../hooks/useAgentState'
import { authedFetch } from '../utils/api'
import { RequestIcon } from './Icons'
import { useLocale } from '../i18n/index'
import './RequestsTab.css'

interface RequestsTabProps {
  requests: Request[]
  onRefresh?: () => void
}

export default function RequestsTab({ requests, onRefresh }: RequestsTabProps) {
  const { t, locale } = useLocale()
  const [processingFile, setProcessingFile] = useState<string | null>(null)

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

  const handleAction = async (filename: string, action: 'approve' | 'deny') => {
    setProcessingFile(filename)

    try {
      const response = await authedFetch(`/api/requests/${filename}/${action}`, {
        method: 'POST',
      })

      if (!response.ok) {
        throw new Error(`Failed to ${action} request`)
      }

      // Refresh the requests list
      if (onRefresh) {
        onRefresh()
      }
    } catch (error) {
      console.error(`Error ${action}ing request:`, error)
      alert(t('requests.action.failed'))
    } finally {
      setProcessingFile(null)
    }
  }

  return (
    <div className="requests-tab">
      <h2 className="sr-only">{t('app.tab.requests')}</h2>
      {requests.map((request, index) => {
        const isProcessing = processingFile === request.filename
        return (
          <div key={`req-${request.filename}-${request.date}-${index}`} className="request-card">
            <div className="request-header">
              <span className="request-date">{formatDate(request.date)}</span>
              <span className="badge active">{t('requests.badge.pending')}</span>
            </div>
            <div className="request-filename">{request.filename}</div>
            <div className="request-content">{request.content}</div>
            <div className="request-actions">
              <button
                className="request-btn approve"
                onClick={() => handleAction(request.filename, 'approve')}
                disabled={isProcessing}
              >
                {isProcessing ? t('requests.action.approving') : t('requests.action.approve')}
              </button>
              <button
                className="request-btn deny"
                onClick={() => handleAction(request.filename, 'deny')}
                disabled={isProcessing}
              >
                {isProcessing ? t('requests.action.denying') : t('requests.action.deny')}
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
