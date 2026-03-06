import type { Department } from '../hooks/useAgentState'
import { DeptIcon } from './Icons'
import './StatusBar.css'

interface StatusBarProps {
  departments: Department[]
  selectedDeptId: string | null
  onSelectDept: (deptId: string | null) => void
}

export default function StatusBar({ departments, selectedDeptId, onSelectDept }: StatusBarProps) {
  const handleCardClick = (deptId: string) => {
    if (selectedDeptId === deptId) {
      onSelectDept(null)
    } else {
      onSelectDept(deptId)
    }
  }

  const truncateTask = (task: string | undefined, maxLength: number = 30) => {
    if (!task) return ''
    if (task.length <= maxLength) return task
    return task.substring(0, maxLength) + '...'
  }

  return (
    <div className="status-bar">
      {departments.map(dept => (
        <div
          key={dept.id}
          className={`dept-card ${selectedDeptId === dept.id ? 'selected' : ''}`}
          onClick={() => handleCardClick(dept.id)}
        >
          <div className="dept-card-header">
            <DeptIcon deptId={dept.id} size={18} />
            <span className={`status-dot ${dept.status}`}></span>
          </div>
          <div className="dept-name">{dept.name}</div>
          {dept.currentTask && (
            <div className="dept-task">{truncateTask(dept.currentTask)}</div>
          )}
        </div>
      ))}
    </div>
  )
}
