import { useRef, useEffect, useCallback, useState } from 'react'
import type { Department, Activity } from '../hooks/useAgentState'
import { DeptIcon } from './Icons'
import { useLocale } from '../i18n/index'
import type { ReactElement } from 'react'

interface ChatMessagesProps {
  deptActivities: Activity[]
  departments: Department[]
  selectedDeptId: string | null
  sending: boolean
  streamingText: string | undefined
  onImageClick: (src: string) => void
}

export default function ChatMessages({
  deptActivities,
  departments,
  selectedDeptId,
  sending,
  streamingText,
  onImageClick,
}: ChatMessagesProps) {
  const messagesRef = useRef<HTMLDivElement>(null)
  const { t, locale } = useLocale()
  const [pullDistance, setPullDistance] = useState(0)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const pullStartY = useRef<number | null>(null)
  const PULL_THRESHOLD = 60

  // Per-message detail toggle for power users
  const [expandedMessages, setExpandedMessages] = useState<Set<number>>(new Set())

  const toggleMessageDetails = (index: number) => {
    setExpandedMessages(prev => {
      const next = new Set(prev)
      if (next.has(index)) {
        next.delete(index)
      } else {
        next.add(index)
      }
      return next
    })
  }

  // Smart auto-scroll: only scroll if user is near bottom
  useEffect(() => {
    if (messagesRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = messagesRef.current
      const isNearBottom = scrollHeight - scrollTop - clientHeight < 100
      if (isNearBottom) {
        messagesRef.current.scrollTop = scrollHeight
      }
    }
  }, [deptActivities.length])

  // Scroll to bottom when department changes
  useEffect(() => {
    if (selectedDeptId && messagesRef.current) {
      requestAnimationFrame(() => {
        if (messagesRef.current) {
          messagesRef.current.scrollTop = messagesRef.current.scrollHeight
        }
      })
    }
  }, [selectedDeptId])

  // Pull-to-refresh handlers
  const handlePullStart = useCallback((e: React.TouchEvent) => {
    if (messagesRef.current && messagesRef.current.scrollTop <= 0) {
      pullStartY.current = e.touches[0].clientY
    }
  }, [])

  const handlePullMove = useCallback((e: React.TouchEvent) => {
    if (pullStartY.current === null || isRefreshing) return
    const delta = e.touches[0].clientY - pullStartY.current
    if (delta > 0 && messagesRef.current && messagesRef.current.scrollTop <= 0) {
      setPullDistance(Math.min(delta * 0.5, 100))
    }
  }, [isRefreshing])

  const handlePullEnd = useCallback(() => {
    if (pullDistance >= PULL_THRESHOLD && selectedDeptId && !isRefreshing) {
      setIsRefreshing(true)
      // Trigger reload in parent via event or callback if needed
      setTimeout(() => {
        setIsRefreshing(false)
        setPullDistance(0)
      }, 1000)
    } else {
      setPullDistance(0)
    }
    pullStartY.current = null
  }, [pullDistance, selectedDeptId, isRefreshing])

  const formatTime = (ts: number) => {
    return new Date(ts).toLocaleTimeString(locale === 'zh' ? 'zh-CN' : 'en-US', {
      hour: '2-digit', minute: '2-digit', hour12: false
    })
  }

  const cleanMessageText = (text: string): string => {
    if (!text) return text
    return text
      .replace(/<department_context>[\s\S]*?<\/department_context>\s*/g, '')
      .replace(/<subagent_context>[\s\S]*?<\/subagent_context>\s*/g, '')
      .trim()
  }

  const highlightMentions = (text: string): ReactElement[] => {
    const parts: ReactElement[] = [];
    const mentionPattern = /@([\w\u4e00-\u9fff]+)/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = mentionPattern.exec(text)) !== null) {
      // Add text before mention
      if (match.index > lastIndex) {
        parts.push(<span key={`text-${lastIndex}`}>{text.substring(lastIndex, match.index)}</span>);
      }
      // Add highlighted mention
      parts.push(
        <span key={`mention-${match.index}`} className="chat-mention">
          {match[0]}
        </span>
      );
      lastIndex = match.index + match[0].length;
    }

    // Add remaining text
    if (lastIndex < text.length) {
      parts.push(<span key={`text-${lastIndex}`}>{text.substring(lastIndex)}</span>);
    }

    return parts.length > 0 ? parts : [<span key="text">{text}</span>];
  }

  const getFileIcon = (filename: string, size: number = 16) => {
    const ext = filename.split('.').pop()?.toLowerCase() || ''
    const colors: Record<string, string> = {
      pdf: '#ff4444', docx: '#4488ff', xlsx: '#22aa44', pptx: '#ff8800',
      txt: '#a0a0b0', csv: '#22aa44', json: '#ffaa00', md: '#a0a0b0',
    }
    const color = colors[ext] || '#a0a0b0'
    const label = ext.toUpperCase().substring(0, 4)
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
        <path d="M2 1.5h8l4 4v9.5H2V1.5z" stroke={color} strokeWidth="1.2" fill="none" />
        <path d="M10 1.5v4h4" stroke={color} strokeWidth="1.2" />
        <text x="8" y="12" textAnchor="middle" fill={color} fontSize="4" fontWeight="700" fontFamily="var(--font-mono)">{label}</text>
      </svg>
    )
  }

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  }

  const dept = departments.find(d => d.id === selectedDeptId)

  return (
    <div
      className="chat-messages"
      ref={messagesRef}
      onTouchStart={handlePullStart}
      onTouchMove={handlePullMove}
      onTouchEnd={handlePullEnd}
    >
      {/* Pull-to-refresh indicator */}
      {(pullDistance > 0 || isRefreshing) && (
        <div
          className="pull-refresh-indicator"
          style={{ height: isRefreshing ? PULL_THRESHOLD : pullDistance }}
        >
          {isRefreshing ? (
            <div className="pull-refresh-spinner" />
          ) : (
            <svg
              width="20" height="20" viewBox="0 0 20 20" fill="none"
              style={{
                transform: `rotate(${pullDistance >= PULL_THRESHOLD ? 180 : 0}deg)`,
                transition: 'transform 0.2s',
                opacity: Math.min(pullDistance / PULL_THRESHOLD, 1),
              }}
            >
              <path d="M10 4v10M6 10l4 4 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </div>
      )}
      {deptActivities.length === 0 ? (
        <div className="chat-empty">
          {selectedDeptId
            ? t('chat.message.send', { name: dept?.name || selectedDeptId })
            : t('chat.message.click')}
        </div>
      ) : (
        deptActivities.map((msg, i) => (
          <div key={`${msg.role}-${msg.timestamp}-${i}`} className={`chat-msg ${msg.role} chat-msg-touch`}>
            <div className="chat-msg-meta">
              {msg.role === 'user' ? (
                <>
                  <span className="chat-msg-sender you">
                    {msg.fromName || t('chat.message.you')}
                  </span>
                  {msg.source && msg.source !== 'app' && (
                    <span className={`chat-msg-source ${msg.source}`}>
                      {msg.source === 'telegram' ? t('chat.source.telegram') : msg.source === 'gateway' ? t('chat.source.gateway') : msg.source}
                    </span>
                  )}
                </>
              ) : (
                <>
                  <DeptIcon deptId={msg.deptId} size={12} />
                  <span className="chat-msg-sender bot">
                    {departments.find(d => d.id === msg.deptId)?.name || msg.deptId}
                  </span>
                  {msg.source && msg.source !== 'app' && (
                    <span className={`chat-msg-source ${msg.source}`}>
                      {msg.source === 'telegram' ? t('chat.source.telegram') : msg.source === 'gateway' ? t('chat.source.gateway') : msg.source}
                    </span>
                  )}
                </>
              )}
              <span className="chat-msg-time">{formatTime(msg.timestamp)}</span>
            </div>
            <div className="chat-msg-text">{highlightMentions(cleanMessageText(msg.text))}</div>
            {msg.images && msg.images.length > 0 && (
              <div className="chat-msg-images">
                {msg.images.map((imgSrc, j) => (
                  <img
                    key={j}
                    src={imgSrc}
                    className="chat-msg-img"
                    alt=""
                    onClick={() => onImageClick(imgSrc)}
                  />
                ))}
              </div>
            )}
            {msg.attachments && msg.attachments.length > 0 && (
              <div className="chat-msg-attachments">
                {msg.attachments.map((att, j) => (
                  <a key={j} href={att.url} download={att.name} className="chat-attachment">
                    <div className="attachment-icon-wrapper">
                      {getFileIcon(att.name, 16)}
                    </div>
                    <div className="attachment-info">
                      <span className="attachment-name">{att.name}</span>
                      <span className="attachment-size">{formatFileSize(att.size)}</span>
                    </div>
                    <svg className="attachment-download" width="14" height="14" viewBox="0 0 16 16" fill="none">
                      <path d="M8 2v9M4 8l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M2 13h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  </a>
                ))}
              </div>
            )}
          </div>
        ))
      )}
      {sending && (() => {
        return (
          <div className="chat-msg assistant chat-msg-touch">
            <div className="chat-msg-meta">
              <DeptIcon deptId={selectedDeptId || ''} size={12} />
              <span className="chat-msg-sender bot">{t('chat.message.thinking')}</span>
            </div>
            {streamingText ? (
              <div className="chat-stream-text">
                {streamingText}
                <span className="chat-stream-cursor">▊</span>
              </div>
            ) : (
              <div className="chat-typing">
                <span></span><span></span><span></span>
              </div>
            )}
          </div>
        )
      })()}
    </div>
  )
}
