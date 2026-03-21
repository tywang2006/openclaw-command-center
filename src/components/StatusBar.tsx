import React, { useState, useRef, useEffect, useCallback } from 'react'
import type { Department } from '../hooks/useAgentState'
import { useLocale } from '../i18n/index'
import { DeptIcon } from './Icons'
import './StatusBar.css'

interface StatusBarProps {
  departments: Department[]
  selectedDeptId: string | null
  onSelectDept: (deptId: string | null) => void
  onAddDept?: () => void
  onEditDept?: (dept: Department) => void
  onDeleteDept?: (deptId: string) => void
}

function StatusBar({ departments, selectedDeptId, onSelectDept, onAddDept, onEditDept, onDeleteDept }: StatusBarProps) {
  const { t } = useLocale()
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; dept: Department } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleCardClick = (deptId: string) => {
    if (selectedDeptId === deptId) {
      onSelectDept(null)
    } else {
      onSelectDept(deptId)
    }
  }

  const handleContextMenu = useCallback((e: React.MouseEvent, dept: Department) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, dept })
  }, [])

  const handleTouchStart = useCallback((dept: Department) => {
    longPressTimer.current = setTimeout(() => {
      setContextMenu({ x: window.innerWidth / 2, y: window.innerHeight - 120, dept })
    }, 500)
  }, [])

  const handleTouchEnd = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }, [])

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [contextMenu])

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
          role="button"
          tabIndex={0}
          onClick={() => handleCardClick(dept.id)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleCardClick(dept.id) } }}
          onContextMenu={(e) => handleContextMenu(e, dept)}
          onTouchStart={() => handleTouchStart(dept)}
          onTouchEnd={handleTouchEnd}
        >
          <div className="dept-card-header">
            <DeptIcon deptId={dept.id} icon={dept.icon} color={dept.color} size={18} />
            <span className={`status-dot ${dept.status}`}></span>
          </div>
          <div className="dept-name">{dept.name}</div>
          {dept.currentTask && (
            <div className="dept-task">{truncateTask(dept.currentTask)}</div>
          )}
        </div>
      ))}
      {onAddDept && (
        <div
          className="dept-card add-dept-card"
          role="button"
          tabIndex={0}
          onClick={onAddDept}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onAddDept() } }}
        >
          <div className="add-dept-icon">+</div>
        </div>
      )}

      {contextMenu && (
        <div
          ref={menuRef}
          className="dept-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <div className="dept-context-menu-header">{contextMenu.dept.name}</div>
          {onEditDept && (
            <button onClick={() => { onEditDept(contextMenu.dept); setContextMenu(null) }}>
              {t('common.edit')}
            </button>
          )}
          {onDeleteDept && (
            <button className="danger" onClick={() => { onDeleteDept(contextMenu.dept.id); setContextMenu(null) }}>
              {t('common.delete')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default React.memo(StatusBar)
