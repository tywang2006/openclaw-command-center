import { useState } from 'react'
import type { AgentState, Activity } from '../hooks/useAgentState'
import { useLocale } from '../i18n/index'
import { BulletinIcon, MemoryIcon, RequestIcon, ActivityIcon } from './Icons'
import BulletinTab from './BulletinTab'
import MemoryTab from './MemoryTab'
import RequestsTab from './RequestsTab'
import ActivityTab from './ActivityTab'
import CommandPanel from './CommandPanel'
import './SidePanel.css'

interface SidePanelProps {
  agentState: AgentState & {
    setSelectedDeptId: (id: string | null) => void
    addActivity: (a: Activity) => void
  }
}

type TabId = 'bulletin' | 'memory' | 'requests' | 'activity'

export default function SidePanel({ agentState }: SidePanelProps) {
  const { t } = useLocale()
  const [activeTab, setActiveTab] = useState<TabId>('bulletin')

  const TABS: { id: TabId; label: string; Icon: React.FC<{ size?: number; color?: string }> }[] = [
    { id: 'bulletin', label: t('app.tab.bulletin'), Icon: BulletinIcon },
    { id: 'memory', label: t('app.tab.memory'), Icon: MemoryIcon },
    { id: 'requests', label: t('app.tab.requests'), Icon: RequestIcon },
    { id: 'activity', label: t('app.tab.activity'), Icon: ActivityIcon },
  ]

  return (
    <div className="side-panel panel">
      <div className="side-tab-header">
        {TABS.map(tab => (
          <button
            key={tab.id}
            className={`side-tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            <tab.Icon size={14} color={activeTab === tab.id ? '#00d4aa' : '#a0a0b0'} />
            <span>{tab.label}</span>
          </button>
        ))}
      </div>
      <div className="side-tab-content">
        {activeTab === 'bulletin' && <BulletinTab bulletin={agentState.bulletin} />}
        {activeTab === 'memory' && (
          <MemoryTab
            selectedDeptId={agentState.selectedDeptId}
            memories={agentState.memories}
            departments={agentState.departments}
          />
        )}
        {activeTab === 'requests' && <RequestsTab requests={agentState.requests} />}
        {activeTab === 'activity' && <ActivityTab activities={agentState.activities} departments={agentState.departments} />}
      </div>
      <CommandPanel
        selectedDeptId={agentState.selectedDeptId}
        departments={agentState.departments}
        addActivity={agentState.addActivity}
      />
    </div>
  )
}
