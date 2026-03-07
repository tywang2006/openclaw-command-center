import { useEffect, useState } from 'react'
import { useAgentState } from './hooks/useAgentState'
import OfficeCanvas from './components/OfficeCanvas'
import ChatPanel, { type SubAgent } from './components/ChatPanel'
import BulletinTab from './components/BulletinTab'
import MemoryTab from './components/MemoryTab'
import ActivityTab from './components/ActivityTab'
import CronTab from './components/CronTab'
import SkillsTab from './components/SkillsTab'
import StatusBar from './components/StatusBar'
import { BulletinIcon, MemoryIcon, ActivityIcon } from './components/Icons'
import './App.css'

type RightTab = 'chat' | 'bulletin' | 'memory' | 'activity' | 'cron' | 'skills'

const RIGHT_TABS: { id: RightTab; label: string; Icon: React.FC<{ size?: number; color?: string }> }[] = [
  { id: 'chat', label: '对话', Icon: ({ size = 14, color = '#a0a0b0' }) => (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path d="M2 2h12v9H5l-3 3V2z" stroke={color} strokeWidth="1.5" fill="none" />
    </svg>
  )},
  { id: 'bulletin', label: '公告', Icon: BulletinIcon },
  { id: 'memory', label: '记忆', Icon: MemoryIcon },
  { id: 'activity', label: '活动', Icon: ActivityIcon },
  { id: 'cron', label: '定时', Icon: ({ size = 14, color = '#a0a0b0' }: { size?: number; color?: string }) => (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="6.5" stroke={color} strokeWidth="1.5" />
      <path d="M8 4v4l3 2" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )},
  { id: 'skills', label: '技能', Icon: ({ size = 14, color = '#a0a0b0' }: { size?: number; color?: string }) => (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path d="M8 1l2 4h4l-3 3 1 4-4-2-4 2 1-4-3-3h4z" stroke={color} strokeWidth="1.3" fill="none" />
    </svg>
  )},
]

export default function App() {
  const agentState = useAgentState()
  const [currentTime, setCurrentTime] = useState(new Date())
  const [rightTab, setRightTab] = useState<RightTab>('chat')
  const [subAgentsByDept, setSubAgentsByDept] = useState<Record<string, SubAgent[]>>({})

  const handleSubAgentsChange = (deptId: string, subs: SubAgent[]) => {
    setSubAgentsByDept(prev => ({ ...prev, [deptId]: subs }))
  }

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('zh-CN', {
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    })
  }

  return (
    <div className="app">
      <header className="header">
        <div className="header-title">
          <h1>超哥办公室</h1>
        </div>
        <div className="header-status">
          <div className="connection-status">
            <span className={`status-dot ${agentState.connected ? 'connected' : 'disconnected'}`}></span>
            <span>{agentState.connected ? 'Online' : 'Offline'}</span>
          </div>
          <div className="current-time">{formatTime(currentTime)}</div>
        </div>
      </header>

      <div className="main-content">
        <div className="left-panel">
          <OfficeCanvas
            departments={agentState.departments}
            selectedDeptId={agentState.selectedDeptId}
            onSelectDept={agentState.setSelectedDeptId}
            subAgents={subAgentsByDept}
          />
        </div>
        <div className="right-panel">
          <div className="right-tab-header">
            {RIGHT_TABS.map(tab => (
              <button
                key={tab.id}
                className={`right-tab ${rightTab === tab.id ? 'active' : ''}`}
                onClick={() => setRightTab(tab.id)}
              >
                <tab.Icon size={14} color={rightTab === tab.id ? '#00d4aa' : '#a0a0b0'} />
                <span>{tab.label}</span>
              </button>
            ))}
          </div>
          <div className="right-tab-content">
            {rightTab === 'chat' && (
              <ChatPanel
                selectedDeptId={agentState.selectedDeptId}
                departments={agentState.departments}
                activities={agentState.activities}
                addActivity={agentState.addActivity}
                onSubAgentsChange={handleSubAgentsChange}
              />
            )}
            {rightTab === 'bulletin' && (
              <BulletinTab bulletin={agentState.bulletin} />
            )}
            {rightTab === 'memory' && (
              <MemoryTab
                selectedDeptId={agentState.selectedDeptId}
                memories={agentState.memories}
                departments={agentState.departments}
              />
            )}
            {rightTab === 'activity' && (
              <ActivityTab
                activities={agentState.activities}
                departments={agentState.departments}
              />
            )}
            {rightTab === 'cron' && <CronTab departments={agentState.departments} selectedDeptId={agentState.selectedDeptId} />}
            {rightTab === 'skills' && <SkillsTab />}
          </div>
        </div>
      </div>

      <StatusBar
        departments={agentState.departments}
        selectedDeptId={agentState.selectedDeptId}
        onSelectDept={agentState.setSelectedDeptId}
      />
    </div>
  )
}
