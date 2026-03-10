import type { Department } from '../hooks/useAgentState'
import { DeptIcon } from './Icons'
import './MobileNav.css'

type RightTab = 'chat' | 'bulletin' | 'memory' | 'activity' | 'cron' | 'dashboard' | 'integrations'

interface MobileNavProps {
  activeTab: RightTab
  onTabChange: (tab: RightTab) => void
  departments: Department[]
  selectedDeptId: string | null
  onSelectDept: (deptId: string | null) => void
  showDeptPicker: boolean
  onToggleDeptPicker: () => void
}

const NAV_ITEMS: { id: RightTab; icon: (active: boolean) => JSX.Element }[] = [
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
    id: 'dashboard',
    icon: (active) => (
      <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
        <rect x="1" y="8" width="3" height="7" stroke={active ? '#00d4aa' : '#a0a0b0'} strokeWidth="1.3" fill="none" />
        <rect x="6" y="4" width="3" height="11" stroke={active ? '#00d4aa' : '#a0a0b0'} strokeWidth="1.3" fill="none" />
        <rect x="11" y="1" width="3" height="14" stroke={active ? '#00d4aa' : '#a0a0b0'} strokeWidth="1.3" fill="none" />
      </svg>
    ),
  },
  {
    id: 'cron',
    icon: (active) => (
      <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="6.5" stroke={active ? '#00d4aa' : '#a0a0b0'} strokeWidth="1.5" />
        <path d="M8 4v4l3 2" stroke={active ? '#00d4aa' : '#a0a0b0'} strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
]

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
      </nav>
    </>
  )
}
