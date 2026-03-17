import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import type { Department } from '../hooks/useAgentState'
import { authedFetch } from '../utils/api'
import './CommandPalette.css'

interface CommandAction {
  id: string
  category: string
  label: string
  description: string
  icon?: string
  action: () => void
}

interface SearchResult {
  type: 'memory' | 'daily' | 'chat' | 'bulletin'
  deptId: string | null
  file: string
  date: string | null
  matches: Array<{ text: string; line?: number; timestamp?: string }>
}

interface CommandPaletteProps {
  open: boolean
  onClose: () => void
  departments: Department[]
  onSelectDept: (deptId: string) => void
  onSwitchTab: (tab: string) => void
  onOpenMeeting?: () => void
}

export default function CommandPalette({ open, onClose, departments, onSelectDept, onSwitchTab, onOpenMeeting }: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const searchTimeoutRef = useRef<number | null>(null)

  // Build command list
  const commands = useMemo<CommandAction[]>(() => {
    const cmds: CommandAction[] = []

    // Department quick-switch
    for (const dept of departments) {
      cmds.push({
        id: `dept:${dept.id}`,
        category: '部门',
        label: dept.name,
        description: `切换到${dept.name}`,
        action: () => { onSelectDept(dept.id); onClose() },
      })
    }

    // Tab navigation
    const tabs = [
      { id: 'chat', label: '对话', desc: '打开对话面板' },
      { id: 'bulletin', label: '公告板', desc: '查看公告' },
      { id: 'memory', label: '记忆', desc: '查看部门记忆' },
      { id: 'activity', label: '活动', desc: '查看活动日志' },
      { id: 'cron', label: '定时任务', desc: '管理定时任务' },
      { id: 'dashboard', label: '仪表盘', desc: '查看系统指标' },
      { id: 'integrations', label: '能力', desc: '系统能力面板' },
      { id: 'system', label: '系统', desc: '系统设置' },
    ]
    for (const tab of tabs) {
      cmds.push({
        id: `tab:${tab.id}`,
        category: '导航',
        label: tab.label,
        description: tab.desc,
        action: () => { onSwitchTab(tab.id); onClose() },
      })
    }

    // Actions
    if (onOpenMeeting) {
      cmds.push({
        id: 'action:meeting',
        category: '操作',
        label: '发起会议',
        description: '跨部门多人会议',
        action: () => { onOpenMeeting(); onClose() },
      })
    }

    return cmds
  }, [departments, onSelectDept, onSwitchTab, onOpenMeeting, onClose])

  // Debounced search
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current)
    }

    if (!query.trim()) {
      setSearchResults([])
      setSearchLoading(false)
      return
    }

    setSearchLoading(true)
    searchTimeoutRef.current = window.setTimeout(() => {
      authedFetch(`/api/search?q=${encodeURIComponent(query)}&limit=20`)
        .then((r: Response) => r.json())
        .then((data: { results?: SearchResult[] }) => {
          setSearchResults(data.results || [])
          setSearchLoading(false)
        })
        .catch(() => {
          setSearchResults([])
          setSearchLoading(false)
        })
    }, 300)

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current)
      }
    }
  }, [query])

  // Fuzzy filter
  const filtered = useMemo(() => {
    if (!query.trim()) return commands
    const q = query.toLowerCase()
    return commands.filter(c =>
      c.label.toLowerCase().includes(q) ||
      c.description.toLowerCase().includes(q) ||
      c.category.toLowerCase().includes(q) ||
      c.id.toLowerCase().includes(q)
    )
  }, [commands, query])

  // Convert search results to command actions
  const searchCommands: CommandAction[] = useMemo(() => {
    return searchResults.flatMap((result, idx) => {
      const getCategoryBadge = () => {
        switch (result.type) {
          case 'memory': return '记忆'
          case 'daily': return '日志'
          case 'chat': return '对话'
          case 'bulletin': return '公告'
          default: return result.type
        }
      }

      return result.matches.map((match, matchIdx) => ({
        id: `search:${idx}:${matchIdx}`,
        category: getCategoryBadge(),
        label: match.text.substring(0, 80).replace(/\*\*/g, ''),
        description: result.file || result.date || '',
        action: () => {
          // Navigate to appropriate tab/dept based on result type
          if (result.type === 'memory' && result.deptId) {
            onSelectDept(result.deptId)
            onSwitchTab('memory')
          } else if (result.type === 'daily' && result.deptId) {
            onSelectDept(result.deptId)
            onSwitchTab('activity')
          } else if (result.type === 'chat') {
            onSwitchTab('activity')
          } else if (result.type === 'bulletin') {
            onSwitchTab('bulletin')
          }
          onClose()
        }
      }))
    })
  }, [searchResults, onSelectDept, onSwitchTab, onClose])

  // Reset on open
  useEffect(() => {
    if (open) {
      setQuery('')
      setSelectedIndex(0)
      setSearchResults([])
      setSearchLoading(false)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const allItems = [...filtered, ...searchCommands]
    if (e.key === 'Escape') {
      onClose()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex(i => Math.min(i + 1, allItems.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (allItems[selectedIndex]) {
        allItems[selectedIndex].action()
      }
    }
  }, [filtered, searchCommands, selectedIndex, onClose])

  // Scroll selected into view
  useEffect(() => {
    const el = listRef.current?.children[selectedIndex] as HTMLElement
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  // Reset selection when query changes
  useEffect(() => { setSelectedIndex(0) }, [query])

  if (!open) return null

  return (
    <div className="cmd-palette-overlay" onClick={onClose}>
      <div className="cmd-palette" onClick={e => e.stopPropagation()}>
        <div className="cmd-palette-input-row">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="cmd-palette-search-icon">
            <circle cx="6.5" cy="6.5" r="5" stroke="#666" strokeWidth="1.5" />
            <path d="M10.5 10.5L14 14" stroke="#666" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            className="cmd-palette-input"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="搜索命令、部门..."
          />
          <kbd className="cmd-palette-kbd">ESC</kbd>
        </div>
        <div className="cmd-palette-list" ref={listRef}>
          {searchLoading && (
            <div className="cmd-search-loading">搜索中...</div>
          )}
          {!searchLoading && filtered.length === 0 && searchCommands.length === 0 && (
            <div className="cmd-palette-empty">无匹配结果</div>
          )}
          {!searchLoading && filtered.map((cmd, i) => (
            <div
              key={cmd.id}
              className={`cmd-palette-item ${i === selectedIndex ? 'selected' : ''}`}
              onClick={() => cmd.action()}
              onMouseEnter={() => setSelectedIndex(i)}
            >
              <span className="cmd-palette-category">{cmd.category}</span>
              <span className="cmd-palette-label">{cmd.label}</span>
              <span className="cmd-palette-desc">{cmd.description}</span>
            </div>
          ))}
          {!searchLoading && searchCommands.length > 0 && (
            <>
              {searchCommands.map((cmd, i) => {
                const idx = filtered.length + i
                return (
                  <div
                    key={cmd.id}
                    className={`cmd-palette-item cmd-search-result ${idx === selectedIndex ? 'selected' : ''}`}
                    onClick={() => cmd.action()}
                    onMouseEnter={() => setSelectedIndex(idx)}
                  >
                    <span className={`cmd-search-badge ${cmd.category === '记忆' ? 'memory' : cmd.category === '日志' ? 'daily' : cmd.category === '对话' ? 'chat' : 'bulletin'}`}>{cmd.category}</span>
                    <span className="cmd-palette-label">{cmd.label}</span>
                    <span className="cmd-palette-desc">{cmd.description}</span>
                  </div>
                )
              })}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
