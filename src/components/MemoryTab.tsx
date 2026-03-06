import { useEffect, useState } from 'react'
import type { Department } from '../hooks/useAgentState'
import { MemoryIcon, DeptIcon } from './Icons'
import './MemoryTab.css'

interface MemoryTabProps {
  selectedDeptId: string | null
  memories: Map<string, string>
  departments: Department[]
}

export default function MemoryTab({ selectedDeptId, memories, departments }: MemoryTabProps) {
  const [memoryContent, setMemoryContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const selectedDept = departments.find(d => d.id === selectedDeptId)

  // Fetch memory from API when department changes
  useEffect(() => {
    if (!selectedDeptId) {
      setMemoryContent(null)
      return
    }

    // Check if already in WS state
    const cached = memories.get(selectedDeptId)
    if (cached) {
      setMemoryContent(cached)
      return
    }

    // Fetch from API
    setLoading(true)
    fetch(`/cmd/api/departments/${selectedDeptId}/memory`)
      .then(res => res.json())
      .then(data => {
        setMemoryContent(data.content || '')
      })
      .catch(() => setMemoryContent(''))
      .finally(() => setLoading(false))
  }, [selectedDeptId, memories])

  if (!selectedDeptId) {
    return (
      <div className="memory-tab empty">
        <div className="empty-message">
          <div className="empty-icon"><MemoryIcon size={32} color="#a0a0b0" /></div>
          <p>点击一个部门查看记忆</p>
        </div>
      </div>
    )
  }

  return (
    <div className="memory-tab">
      <div className="memory-header">
        <DeptIcon deptId={selectedDeptId} size={18} />
        <h2>{selectedDept?.name || selectedDeptId}</h2>
      </div>
      {loading ? (
        <div className="empty-message"><p>加载中...</p></div>
      ) : memoryContent ? (
        <pre className="markdown-content" style={{ whiteSpace: 'pre-wrap' }}>{memoryContent}</pre>
      ) : (
        <div className="empty-message"><p>暂无记忆内容</p></div>
      )}
    </div>
  )
}
