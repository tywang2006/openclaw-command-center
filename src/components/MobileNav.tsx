import React from 'react'
import { useNavigate } from 'react-router-dom'
import type { Department } from '../hooks/useAgentState'
import { DeptIcon } from './Icons'
import './MobileNav.css'

type RightTab = 'chat' | 'bulletin' | 'memory' | 'activity' | 'requests' | 'meeting' | 'integrations' | 'skills' | 'guide'

interface MobileNavProps {
  activeTab: RightTab
  onTabChange: (tab: RightTab) => void
  departments: Department[]
  selectedDeptId: string | null
  onSelectDept: (deptId: string | null) => void
  showDeptPicker: boolean
  onToggleDeptPicker: () => void
}

const NAV_ITEMS: { id: RightTab; icon: (active: boolean) => React.JSX.Element }[] = [
  {
    id: 'chat',
    icon: (active) => (
      <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
        <path d="M2 2h12v9H5l-3 3V2z" stroke={active ? '#00d4aa' : '#a0a0b0'} strokeWidth="1.5" fill="none" />
      </svg>
    ),
  },
  {
    id: 'activity',
    icon: (active) => (
      <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
        <path d="M1 8h3l2-5 2 10 2-5h3" stroke={active ? '#00d4aa' : '#a0a0b0'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    id: 'meeting',
    icon: (active) => (
      <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
        <rect x="1" y="4" width="14" height="10" rx="1" stroke={active ? '#00d4aa' : '#a0a0b0'} strokeWidth="1.3" />
        <circle cx="5" cy="9" r="1.5" fill={active ? '#00d4aa' : '#a0a0b0'} />
        <circle cx="8" cy="9" r="1.5" fill={active ? '#00d4aa' : '#a0a0b0'} />
        <circle cx="11" cy="9" r="1.5" fill={active ? '#00d4aa' : '#a0a0b0'} />
        <path d="M3 4v-2h10v2" stroke={active ? '#00d4aa' : '#a0a0b0'} strokeWidth="1.3" />
      </svg>
    ),
  },
]

// Ops console button is a special nav item — navigates to /ops route
function OpsNavButton() {
  const navigate = useNavigate()
  return (
    <button
      className="mobile-nav-item"
      onClick={() => navigate('/ops')}
    >
      <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
        <rect x="1" y="1" width="14" height="14" rx="1" stroke="#a0a0b0" strokeWidth="1.3" fill="none" />
        <path d="M1 5h14M5 5v10" stroke="#a0a0b0" strokeWidth="1.3" />
      </svg>
    </button>
  )
}

export default function MobileNav({
  activeTab,
  onTabChange,
  departments,
  selectedDeptId,
  onSelectDept,
  showDeptPicker,
  onToggleDeptPicker,
}: MobileNavProps) {
  return (
    <>
      {/* Department picker overlay */}
      {showDeptPicker && (
        <div className="mobile-dept-overlay" onClick={onToggleDeptPicker}>
          <div className="mobile-dept-picker" onClick={(e) => e.stopPropagation()}>
            <div className="mobile-dept-list">
              {departments.map(dept => (
                <button
                  key={dept.id}
                  className={`mobile-dept-item ${selectedDeptId === dept.id ? 'active' : ''}`}
                  onClick={() => {
                    onSelectDept(selectedDeptId === dept.id ? null : dept.id)
                    onToggleDeptPicker()
                  }}
                >
                  <DeptIcon deptId={dept.id} size={24} />
                  <span className="mobile-dept-name">{dept.name}</span>
                  <span className={`status-dot ${dept.status}`} />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Bottom nav bar */}
      <nav className="mobile-nav">
        {/* Department selector button */}
        <button
          className={`mobile-nav-item dept-selector ${showDeptPicker ? 'active' : ''}`}
          onClick={onToggleDeptPicker}
        >
          {selectedDeptId ? (
            <DeptIcon deptId={selectedDeptId} size={20} />
          ) : (
            <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
              <rect x="1" y="2" width="6" height="5" rx="1" stroke={showDeptPicker ? '#00d4aa' : '#a0a0b0'} strokeWidth="1.3" fill="none" />
              <rect x="9" y="2" width="6" height="5" rx="1" stroke={showDeptPicker ? '#00d4aa' : '#a0a0b0'} strokeWidth="1.3" fill="none" />
              <rect x="1" y="9" width="6" height="5" rx="1" stroke={showDeptPicker ? '#00d4aa' : '#a0a0b0'} strokeWidth="1.3" fill="none" />
              <rect x="9" y="9" width="6" height="5" rx="1" stroke={showDeptPicker ? '#00d4aa' : '#a0a0b0'} strokeWidth="1.3" fill="none" />
            </svg>
          )}
        </button>

        {/* Tab buttons */}
        {NAV_ITEMS.map(item => (
          <button
            key={item.id}
            className={`mobile-nav-item ${activeTab === item.id ? 'active' : ''}`}
            onClick={() => onTabChange(item.id)}
          >
            {item.icon(activeTab === item.id)}
          </button>
        ))}

        {/* Ops console */}
        <OpsNavButton />
      </nav>
    </>
  )
}
