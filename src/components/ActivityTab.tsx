import { useEffect, useRef, useState, useCallback } from 'react'
import type { Activity, Department } from '../hooks/useAgentState'
import { DeptIcon } from './Icons'
import { useLocale } from '../i18n/index'
import { authedFetch } from '../utils/api'
import { useVisibilityInterval } from '../hooks/useVisibilityInterval'
import './ActivityTab.css'

interface ActivityTabProps {
  activities: Activity[]
  departments: Department[]
  addActivity?: (activity: Activity) => void
}

export default function ActivityTab({ activities, departments, addActivity }: ActivityTabProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const { t, locale } = useLocale()

  // Replay state
  const [isRecording, setIsRecording] = useState(false)
  const [recordingStatus, setRecordingStatus] = useState<{ eventCount: number } | null>(null)
  const [replays, setReplays] = useState<Array<{ id: string; name: string; durationMs: number; eventCount: number }>>([])
  const [showReplayList, setShowReplayList] = useState(false)
  const [playbackState, setPlaybackState] = useState<{ playing: boolean; current: number; total: number; speed: number } | null>(null)
  const playbackRef = useRef<number | null>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [activities])

  // Poll recording status while recording — pauses when tab hidden
  const pollRecordingStatus = useCallback(async () => {
    if (!isRecording) return
    try {
      const res = await authedFetch('/api/replay/status')
      if (res.ok) {
        const data = await res.json()
        setRecordingStatus(data)
      }
    } catch (err) {
      console.error('Failed to poll recording status:', err)
    }
  }, [isRecording])

  useEffect(() => {
    if (!isRecording) { setRecordingStatus(null) }
  }, [isRecording])

  useVisibilityInterval(pollRecordingStatus, 2000, [pollRecordingStatus])

  // Replay API functions
  const startRecording = async () => {
    try {
      const res = await authedFetch('/api/replay/start', { method: 'POST' })
      if (res.ok) {
        setIsRecording(true)
      }
    } catch (err) {
      console.error('Failed to start recording:', err)
    }
  }

  const stopRecording = async () => {
    try {
      const res = await authedFetch('/api/replay/stop', { method: 'POST' })
      if (res.ok) {
        setIsRecording(false)
        loadReplays()
      }
    } catch (err) {
      console.error('Failed to stop recording:', err)
    }
  }

  const loadReplays = async () => {
    try {
      const res = await authedFetch('/api/replay/list')
      if (res.ok) {
        const data = await res.json()
        setReplays(data)
      }
    } catch (err) {
      console.error('Failed to load replays:', err)
    }
  }

  const deleteReplay = async (id: string) => {
    try {
      const res = await authedFetch(`/api/replay/${id}`, { method: 'DELETE' })
      if (res.ok) {
        loadReplays()
      }
    } catch (err) {
      console.error('Failed to delete replay:', err)
    }
  }

  const stopPlayback = () => {
    if (playbackRef.current !== null) {
      clearTimeout(playbackRef.current)
      playbackRef.current = null
    }
    setPlaybackState(null)
  }

  const playReplay = async (id: string) => {
    if (!addActivity) return

    try {
      const res = await authedFetch(`/api/replay/${id}`)
      if (!res.ok) return

      const data = await res.json()
      const events = data.events || []

      if (events.length === 0) return

      // Stop any existing playback
      stopPlayback()

      // Initialize playback state
      const speed = 4
      setPlaybackState({ playing: true, current: 0, total: events.length, speed })

      // Play events
      let currentIndex = 0
      const playNext = () => {
        if (currentIndex >= events.length) {
          setPlaybackState(null)
          return
        }

        const event = events[currentIndex]

        // Inject activity if it's an activity:new event
        if (event.event === 'activity:new' && event.data) {
          addActivity(event.data)
        }

        currentIndex++
        setPlaybackState({ playing: true, current: currentIndex, total: events.length, speed })

        // Schedule next event
        if (currentIndex < events.length) {
          const delay = currentIndex > 0
            ? (events[currentIndex].replayTs - events[currentIndex - 1].replayTs) / speed
            : 0
          playbackRef.current = window.setTimeout(playNext, delay)
        } else {
          setPlaybackState(null)
        }
      }

      playNext()
    } catch (err) {
      console.error('Failed to play replay:', err)
      setPlaybackState(null)
    }
  }

  const renderReplayToolbar = () => (
    <div className="replay-toolbar">
      {/* Record/Stop button */}
      <button
        className={`replay-btn ${isRecording ? 'recording' : ''}`}
        onClick={isRecording ? stopRecording : startRecording}
      >
        {isRecording ? t('replay.stop') : t('replay.record')}
      </button>

      {/* Recording indicator */}
      {isRecording && recordingStatus && (
        <span className="recording-indicator">
          {t('replay.recording', { count: recordingStatus.eventCount })}
        </span>
      )}

      {/* Replay list toggle */}
      <button
        className="replay-btn"
        onClick={() => {
          setShowReplayList(!showReplayList)
          if (!showReplayList) loadReplays()
        }}
      >
        {t('replay.title')} ({replays.length})
      </button>

      {/* Playback controls */}
      {playbackState?.playing && (
        <>
          <span className="playback-indicator">
            {t('replay.playing', { current: playbackState.current, total: playbackState.total })}
          </span>
          <button className="replay-btn" onClick={stopPlayback}>
            {t('replay.stop.playback')}
          </button>
        </>
      )}
    </div>
  )

  const renderReplayList = () => {
    if (!showReplayList) return null

    return (
      <div className="replay-list">
        {replays.length === 0 ? (
          <div className="replay-list-empty">{t('replay.list.empty')}</div>
        ) : (
          replays.map((r) => (
            <div key={r.id} className="replay-item">
              <span className="replay-name">{r.name}</span>
              <span className="replay-meta">
                {t('replay.events', { count: r.eventCount })} / {t('replay.duration', { seconds: Math.round(r.durationMs / 1000) })}
              </span>
              <div className="replay-actions">
                <button onClick={() => playReplay(r.id)}>{t('replay.play')}</button>
                <button onClick={() => deleteReplay(r.id)}>{t('replay.delete')}</button>
              </div>
            </div>
          ))
        )}
      </div>
    )
  }

  if (activities.length === 0) {
    return (
      <div className="activity-tab-container">
        {renderReplayToolbar()}
        {renderReplayList()}
        <div className="activity-tab empty">
          <div className="empty-message">
            <ActivityIcon size={32} />
            <p>{t('activity.empty.title')}</p>
            <p className="empty-hint">{t('activity.empty.hint')}</p>
          </div>
        </div>
      </div>
    )
  }

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp)
    return date.toLocaleTimeString(locale === 'zh' ? 'zh-CN' : 'en-US', {
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
    <div className="activity-tab-container">
      {renderReplayToolbar()}
      {renderReplayList()}
      <div className="activity-tab" ref={scrollRef}>
        {activities.map((activity, index) => (
          <div key={`${activity.deptId}-${activity.timestamp}-${index}`} className={`activity-item ${activity.role}`}>
            <div className="activity-meta">
              <DeptIcon deptId={activity.deptId} size={14} />
              <span className="activity-time">{formatTime(activity.timestamp)}</span>
              <span className={`badge ${activity.role === 'user' ? 'idle' : 'active'}`}>
                {activity.role === 'user' ? t('activity.badge.you') : t('activity.badge.bot')}
              </span>
            </div>
            <div className="activity-text">{truncateText(activity.text)}</div>
          </div>
        ))}
      </div>
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
