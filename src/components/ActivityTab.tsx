import { useEffect, useRef } from 'react'
import type { Activity, Department } from '../hooks/useAgentState'
import { DeptIcon } from './Icons'
import './ActivityTab.css'

interface ActivityTabProps {
  activities: Activity[]
  departments: Department[]
}

export default function ActivityTab({ activities, departments }: ActivityTabProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [activities])

  if (activities.length === 0) {
    return (
      <div className="activity-tab empty">
        <div className="empty-message">
          <ActivityIcon size={32} />
          <p>暂无活动记录</p>
          <p className="empty-hint">发送消息到 Telegram 频道后将在此显示</p>
        </div>
      </div>
    )
  }

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp)
    return date.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
  }

  const truncateText = (text: string, maxLength: number = 200) => {
    if (text.length <= maxLength) return text
    return text.substring(0, maxLength) + '...'
  }

  return (
    <div className="activity-tab" ref={scrollRef}>
      {activities.map((activity, index) => (
        <div key={index} className={`activity-item ${activity.role}`}>
          <div className="activity-meta">
            <DeptIcon deptId={activity.deptId} size={14} />
            <span className="activity-time">{formatTime(activity.timestamp)}</span>
            <span className={`badge ${activity.role === 'user' ? 'idle' : 'active'}`}>
              {activity.role === 'user' ? 'YOU' : 'BOT'}
            </span>
          </div>
          <div className="activity-text">{truncateText(activity.text)}</div>
        </div>
      ))}
    </div>
  )
}

function ActivityIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={{ opacity: 0.4 }}>
      <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 1v2M8 13v2M1 8h2M13 8h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}
