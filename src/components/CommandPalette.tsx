import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Department } from '../hooks/useAgentState'
import { authedFetch } from '../utils/api'
import { useLocale } from '../i18n/index'
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
  const navigate = useNavigate()
  const { t } = useLocale()
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const searchTimeoutRef = useRef<number | null>(null)
  const paletteRef = useRef<HTMLDivElement>(null)

  // Build command list
  const commands = useMemo<CommandAction[]>(() => {
    const cmds: CommandAction[] = []

    // Department quick-switch
    for (const dept of departments) {
      cmds.push({
        id: `dept:${dept.id}`,
        category: t('cmd.palette.category.dept'),
        label: dept.name,
        description: t('cmd.palette.dept.switch', { name: dept.name }),
        action: () => { onSelectDept(dept.id); onClose() },
      })
    }

    // Tab navigation (office tabs)
    const tabs = [
      { id: 'chat', labelKey: 'app.tab.chat' },
      { id: 'bulletin', labelKey: 'app.tab.bulletin' },
      { id: 'memory', labelKey: 'app.tab.memory' },
      { id: 'activity', labelKey: 'app.tab.activity' },
      { id: 'requests', labelKey: 'app.tab.requests' },
      { id: 'meeting', labelKey: 'app.tab.meeting' },
      { id: 'integrations', labelKey: 'app.tab.integrations' },
      { id: 'skills', labelKey: 'app.tab.skills' },
      { id: 'guide', labelKey: 'app.tab.guide' },
    ]
    for (const tab of tabs) {
      const label = t(tab.labelKey)
      cmds.push({
        id: `tab:${tab.id}`,
        category: t('cmd.palette.category.nav'),
        label: label,
        description: label,
        action: () => { onSwitchTab(tab.id); onClose() },
      })
    }

    // Ops console navigation
    const opsModules = [
      { id: 'dashboard', labelKey: 'ops.module.dashboard' },
      { id: 'system', labelKey: 'ops.module.system' },
      { id: 'cron', labelKey: 'ops.module.cron' },
      { id: 'agents', labelKey: 'ops.module.agents' },
      { id: 'gateways', labelKey: 'ops.module.gateways' },
      { id: 'activity', labelKey: 'ops.module.activity' },
      { id: 'approvals', labelKey: 'ops.module.approvals' },
    ]
    for (const mod of opsModules) {
      const label = t(mod.labelKey)
      cmds.push({
        id: `ops:${mod.id}`,
        category: t('cmd.palette.category.ops'),
        label: label,
        description: label,
        action: () => { navigate(`/ops/${mod.id}`); onClose() },
      })
    }

    // Actions
    if (onOpenMeeting) {
      cmds.push({
        id: 'action:meeting',
        category: t('cmd.palette.category.action'),
        label: t('cmd.palette.action.meeting'),
        description: t('cmd.palette.action.meeting.desc'),
        action: () => { onOpenMeeting(); onClose() },
      })
    }

    return cmds
  }, [departments, onSelectDept, onSwitchTab, onOpenMeeting, onClose, navigate, t])

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
          case 'memory': return t('cmd.palette.search.memory')
          case 'daily': return t('cmd.palette.search.daily')
          case 'chat': return t('cmd.palette.search.chat')
          case 'bulletin': return t('cmd.palette.search.bulletin')
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
  }, [searchResults, onSelectDept, onSwitchTab, onClose, t])

  // Focus trap for Tab navigation
  const handleTabKey = useCallback((e: KeyboardEvent) => {
    if (e.key !== 'Tab') return

    const palette = paletteRef.current
    if (!palette) return

    const focusableElements = palette.querySelectorAll('input, [role="option"]')
    const firstElement = focusableElements[0] as HTMLElement
    const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement

    if (e.shiftKey) {
      // Shift+Tab: if on first element, focus last
      if (document.activeElement === firstElement) {
        e.preventDefault()
        lastElement?.focus()
      }
    } else {
      // Tab: if on last element, focus first
      if (document.activeElement === lastElement) {
        e.preventDefault()
        firstElement?.focus()
      }
    }
  }, [])

  // Reset on open and attach focus trap
  useEffect(() => {
    if (open) {
      setQuery('')
      setSelectedIndex(0)
      setSearchResults([])
      setSearchLoading(false)
      setTimeout(() => inputRef.current?.focus(), 50)

      // Attach focus trap listener
      document.addEventListener('keydown', handleTabKey)
      return () => {
        document.removeEventListener('keydown', handleTabKey)
      }
    }
  }, [open, handleTabKey])

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
      <div
        className="cmd-palette"
        onClick={e => e.stopPropagation()}
        ref={paletteRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cmd-palette-label"
      >
        <div className="cmd-palette-input-row">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="cmd-palette-search-icon" aria-hidden="true">
            <circle cx="6.5" cy="6.5" r="5" stroke="#666" strokeWidth="1.5" />
            <path d="M10.5 10.5L14 14" stroke="#666" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            className="cmd-palette-input"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('cmd.palette.placeholder')}
            aria-label={t('cmd.palette.placeholder')}
            id="cmd-palette-label"
            aria-controls="cmd-palette-results"
            aria-activedescendant={`cmd-option-${selectedIndex}`}
          />
          <kbd className="cmd-palette-kbd" aria-hidden="true">ESC</kbd>
        </div>
        <div
          className="cmd-palette-list"
          ref={listRef}
          role="listbox"
          id="cmd-palette-results"
        >
          {searchLoading && (
            <div className="cmd-search-loading">{t('cmd.palette.loading')}</div>
          )}
          {!searchLoading && filtered.length === 0 && searchCommands.length === 0 && (
            <div className="cmd-palette-empty">{t('cmd.palette.empty')}</div>
          )}
          {!searchLoading && filtered.map((cmd, i) => (
            <div
              key={cmd.id}
              id={`cmd-option-${i}`}
              className={`cmd-palette-item ${i === selectedIndex ? 'selected' : ''}`}
              onClick={() => cmd.action()}
              onMouseEnter={() => setSelectedIndex(i)}
              role="option"
              aria-selected={i === selectedIndex}
              tabIndex={-1}
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
                    id={`cmd-option-${idx}`}
                    className={`cmd-palette-item cmd-search-result ${idx === selectedIndex ? 'selected' : ''}`}
                    onClick={() => cmd.action()}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    role="option"
                    aria-selected={idx === selectedIndex}
                    tabIndex={-1}
                  >
                    <span className={`cmd-search-badge ${cmd.category === t('cmd.palette.search.memory') ? 'memory' : cmd.category === t('cmd.palette.search.daily') ? 'daily' : cmd.category === t('cmd.palette.search.chat') ? 'chat' : 'bulletin'}`}>{cmd.category}</span>
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
