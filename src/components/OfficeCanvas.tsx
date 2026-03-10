import { useEffect, useRef, useState, useCallback } from 'react'
import type { Department, ToolState } from '../hooks/useAgentState'
import type { SubAgent } from './ChatPanel'
import { OfficeState } from '../office/engine/officeState'
import { renderFrame } from '../office/engine/renderer'
import { initFurnitureCatalog } from '../office/furnitureAssets'
import { authedFetch } from '../utils/api'
import {
  TILE_SIZE,
  COLLAB_ARROW_COLOR,
  COLLAB_ARROW_DASH,
  COLLAB_ARROW_ANIM_SPEED,
  COLLAB_ARROW_HEAD_SIZE,
  TOOL_LABEL_COLOR,
  TOOL_LABEL_BG,
  TOOL_LABEL_BORDER,
} from '../constants'
import './OfficeCanvas.css'

// Initialize furniture catalog once at module load
let catalogInitialized = false
if (!catalogInitialized) {
  catalogInitialized = initFurnitureCatalog()
}

interface CollabLink {
  from: string
  to: string
  label: string
}

interface OfficeCanvasProps {
  departments: Department[]
  selectedDeptId: string | null
  onSelectDept: (deptId: string | null) => void
  subAgents?: Record<string, SubAgent[]>
  toolStates?: Map<string, ToolState>
}

export default function OfficeCanvas({ departments, selectedDeptId, onSelectDept, subAgents, toolStates }: OfficeCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const officeStateRef = useRef<OfficeState | null>(null)
  const rafRef = useRef<number>(0)
  const lastTimeRef = useRef<number>(0)

  // Pan/zoom stored in refs for stable render loop, state for UI controls
  const [panX, setPanX] = useState(0)
  const [panY, setPanY] = useState(0)
  const [zoom, setZoom] = useState(2)
  const panXRef = useRef(0)
  const panYRef = useRef(0)
  const zoomRef = useRef(2)
  const [officeReady, setOfficeReady] = useState(false)
  const [isPanning, setIsPanning] = useState(false)
  const panStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 })

  // Keep refs in sync with state
  panXRef.current = panX
  panYRef.current = panY
  zoomRef.current = zoom

  // Track last render offsets for click detection
  const lastOffsetsRef = useRef({ offsetX: 0, offsetY: 0 })

  // Sub-agent character ID → display name
  const subAgentNamesRef = useRef<Map<number, string>>(new Map())

  // Collaboration arrows (F11)
  const [collabLinks, setCollabLinks] = useState<CollabLink[]>([])
  const collabAnimRef = useRef(0)

  // Track previous dept statuses for emotion triggers (F6)
  const prevStatusRef = useRef<Map<string, string>>(new Map())

  // Initialize office state when departments are loaded
  useEffect(() => {
    if (departments.length === 0) return
    if (officeStateRef.current) return

    fetch('/cmd/assets/default-layout.json')
      .then(res => res.json())
      .then(layout => {
        officeStateRef.current = new OfficeState(layout)
        departments.forEach((dept, index) => {
          const charId = index % 6
          const hueShift = dept.hue ?? 0
          const seatId = `dept-${dept.id}-chair-main`
          officeStateRef.current!.addAgent(index, charId, hueShift, seatId, true)
        })
        setOfficeReady(true)
      })
      .catch(err => {
        console.error('[OfficeCanvas] Failed to load layout:', err)
        officeStateRef.current = new OfficeState()
        departments.forEach((dept, index) => {
          const charId = index % 6
          const hueShift = dept.hue ?? 0
          const seatId = `dept-${dept.id}-chair-main`
          officeStateRef.current!.addAgent(index, charId, hueShift, seatId, true)
        })
        setOfficeReady(true)
      })
  }, [departments])

  // Update characters when departments change
  useEffect(() => {
    if (!officeStateRef.current) return
    departments.forEach((dept, index) => {
      const isActive = dept.status === 'active'
      officeStateRef.current!.setAgentActive(index, isActive)
    })
  }, [departments, officeReady])

  // Trigger emotions based on department status changes (F6)
  useEffect(() => {
    if (!officeStateRef.current) return
    departments.forEach((dept, index) => {
      const prev = prevStatusRef.current.get(dept.id)
      if (prev && prev !== dept.status) {
        if (dept.status === 'active') {
          officeStateRef.current!.setAgentEmotion(index, 'thinking')
        } else if (prev === 'active' && dept.status === 'idle') {
          officeStateRef.current!.setAgentEmotion(index, null)
        }
      }
      prevStatusRef.current.set(dept.id, dept.status)
    })
  }, [departments, officeReady])

  // Poll collaboration links every 60s (F11)
  useEffect(() => {
    const fetchCollab = () => {
      authedFetch('/api/collaboration')
        .then(res => res.json())
        .then(data => {
          if (Array.isArray(data?.links)) setCollabLinks(data.links)
        })
        .catch(() => {})
    }
    fetchCollab()
    const timer = setInterval(fetchCollab, 60000)
    return () => clearInterval(timer)
  }, [])

  // Update selection
  useEffect(() => {
    if (!officeStateRef.current) return
    if (selectedDeptId) {
      const index = departments.findIndex(d => d.id === selectedDeptId)
      if (index >= 0) {
        officeStateRef.current.selectedAgentId = index
      }
    } else {
      officeStateRef.current.selectedAgentId = null
    }
  }, [selectedDeptId, departments, officeReady])

  // Sync sub-agents with office state
  useEffect(() => {
    if (!officeStateRef.current || !subAgents) return
    const state = officeStateRef.current
    const activeKeys = new Set<string>()

    // Add new sub-agents
    Object.entries(subAgents).forEach(([deptId, subs]) => {
      const deptIndex = departments.findIndex(d => d.id === deptId)
      if (deptIndex < 0) return

      subs.forEach(sub => {
        const key = `${deptIndex}:${sub.id}`
        activeKeys.add(key)

        const existingId = state.getSubagentId(deptIndex, sub.id)
        if (existingId === null) {
          const charId = state.addSubagent(deptIndex, sub.id)
          subAgentNamesRef.current.set(charId, sub.name)
        }
      })
    })

    // Remove sub-agents no longer present
    const toRemove: Array<{ parentId: number; toolId: string; charId: number }> = []
    for (const [key, charId] of state.subagentIdMap) {
      if (!activeKeys.has(key)) {
        const meta = state.subagentMeta.get(charId)
        if (meta) {
          toRemove.push({ parentId: meta.parentAgentId, toolId: meta.parentToolId, charId })
        }
      }
    }
    toRemove.forEach(({ parentId, toolId, charId }) => {
      state.removeSubagent(parentId, toolId)
      subAgentNamesRef.current.delete(charId)
    })
  }, [subAgents, departments, officeReady])

  // Render loop using the full renderFrame pipeline
  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const render = (time: number) => {
      const dt = lastTimeRef.current ? Math.min((time - lastTimeRef.current) / 1000, 0.1) : 0
      lastTimeRef.current = time

      if (officeStateRef.current) {
        officeStateRef.current.update(dt)
      }

      // Resize canvas to match container
      const rect = container.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      const w = Math.floor(rect.width)
      const h = Math.floor(rect.height)
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr
        canvas.height = h * dpr
        canvas.style.width = `${w}px`
        canvas.style.height = `${h}px`
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      if (!officeStateRef.current) {
        ctx.fillStyle = '#0a0a14'
        ctx.fillRect(0, 0, w, h)
        // Loading text
        ctx.fillStyle = '#2a2a4a'
        ctx.font = '14px monospace'
        ctx.textAlign = 'center'
        ctx.fillText('Loading office...', w / 2, h / 2)
        rafRef.current = requestAnimationFrame(render)
        return
      }

      const state = officeStateRef.current

      // Use the full renderFrame from the game engine (read from refs for stable loop)
      const result = renderFrame(
        ctx,
        w,
        h,
        state.tileMap,
        state.furniture,
        state.getCharacters(),
        zoomRef.current,
        panXRef.current,
        panYRef.current,
        {
          selectedAgentId: state.selectedAgentId,
          hoveredAgentId: state.hoveredAgentId,
          hoveredTile: null,
          seats: state.seats,
          characters: state.characters,
        },
        undefined, // no editor
        state.layout.tileColors,
        state.layout.cols,
        state.layout.rows,
      )

      lastOffsetsRef.current = result

      // Draw name labels above characters (departments + sub-agents)
      const characters = state.getCharacters()
      const { offsetX, offsetY } = result
      const z = zoomRef.current

      characters.forEach((char) => {
        // Skip despawning characters
        if (char.matrixEffect === 'despawn') return

        let labelText: string | null = null
        const isSub = char.id < 0

        if (!isSub) {
          const dept = departments[char.id]
          if (dept) labelText = dept.name
        } else {
          labelText = subAgentNamesRef.current.get(char.id) || null
        }
        if (!labelText) return

        const screenX = offsetX + char.x * z
        const screenY = offsetY + (char.y - 20) * z

        ctx.save()
        ctx.font = `${Math.max(9, z * 5)}px monospace`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'bottom'

        const text = labelText
        const metrics = ctx.measureText(text)
        const bgW = metrics.width + 6
        const bgH = Math.max(14, z * 6)

        ctx.fillStyle = isSub ? 'rgba(0, 50, 42, 0.85)' : 'rgba(30, 30, 46, 0.85)'
        ctx.fillRect(screenX - bgW / 2, screenY - bgH, bgW, bgH)

        const isSelected = state.selectedAgentId === char.id
        ctx.strokeStyle = isSelected ? '#00d4aa' : isSub ? '#00553a' : '#2a2a4a'
        ctx.lineWidth = 1
        ctx.strokeRect(screenX - bgW / 2, screenY - bgH, bgW, bgH)

        ctx.fillStyle = isSelected ? '#00d4aa' : isSub ? '#00aa88' : '#e0e0e0'
        ctx.fillText(text, screenX, screenY - 2)
        ctx.restore()

        // F7: Draw tool label below dept name
        if (!isSub && char.id >= 0 && char.id < departments.length) {
          const dept = departments[char.id]
          const tool = toolStates?.get(dept.id)
          if (tool && !tool.done) {
            const toolScreenY = screenY + 2
            ctx.save()
            ctx.font = `${Math.max(7, z * 4)}px monospace`
            ctx.textAlign = 'center'
            ctx.textBaseline = 'top'
            const toolText = `[${tool.toolName}]`
            const tm = ctx.measureText(toolText)
            const tbgW = tm.width + 4
            const tbgH = Math.max(10, z * 5)
            ctx.fillStyle = TOOL_LABEL_BG
            ctx.fillRect(screenX - tbgW / 2, toolScreenY, tbgW, tbgH)
            ctx.strokeStyle = TOOL_LABEL_BORDER
            ctx.lineWidth = 1
            ctx.strokeRect(screenX - tbgW / 2, toolScreenY, tbgW, tbgH)
            ctx.fillStyle = TOOL_LABEL_COLOR
            ctx.fillText(toolText, screenX, toolScreenY + 1)
            ctx.restore()
          }
        }
      })

      // F11: Draw collaboration arrows between departments
      if (collabLinks.length > 0) {
        collabAnimRef.current = (collabAnimRef.current + 1) % 1000
        ctx.save()
        ctx.strokeStyle = COLLAB_ARROW_COLOR
        ctx.lineWidth = Math.max(1, z * 0.5)
        ctx.setLineDash(COLLAB_ARROW_DASH)
        ctx.lineDashOffset = -(collabAnimRef.current * COLLAB_ARROW_ANIM_SPEED / 60)

        for (const link of collabLinks) {
          const fromIdx = departments.findIndex(d => d.id === link.from)
          const toIdx = departments.findIndex(d => d.id === link.to)
          if (fromIdx < 0 || toIdx < 0) continue
          const fromCh = state.characters.get(fromIdx)
          const toCh = state.characters.get(toIdx)
          if (!fromCh || !toCh) continue

          const x1 = offsetX + fromCh.x * z
          const y1 = offsetY + fromCh.y * z
          const x2 = offsetX + toCh.x * z
          const y2 = offsetY + toCh.y * z

          // Draw line
          ctx.beginPath()
          ctx.moveTo(x1, y1)
          ctx.lineTo(x2, y2)
          ctx.stroke()

          // Draw arrowhead at destination
          const angle = Math.atan2(y2 - y1, x2 - x1)
          const hs = COLLAB_ARROW_HEAD_SIZE * z * 0.3
          ctx.setLineDash([])
          ctx.beginPath()
          ctx.moveTo(x2, y2)
          ctx.lineTo(x2 - hs * Math.cos(angle - 0.4), y2 - hs * Math.sin(angle - 0.4))
          ctx.moveTo(x2, y2)
          ctx.lineTo(x2 - hs * Math.cos(angle + 0.4), y2 - hs * Math.sin(angle + 0.4))
          ctx.stroke()
          ctx.setLineDash(COLLAB_ARROW_DASH)
        }
        ctx.restore()
      }

      rafRef.current = requestAnimationFrame(render)
    }

    rafRef.current = requestAnimationFrame(render)

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [departments, selectedDeptId])

  // Track whether a left-click drag moved enough to be a pan (vs a click)
  const dragDistRef = useRef(0)

  // Click to select character / drag to pan
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas || !officeStateRef.current) return

    const rect = canvas.getBoundingClientRect()
    const mouseX = e.clientX - rect.left
    const mouseY = e.clientY - rect.top

    // Any mouse button starts panning
    if (e.button === 0 || e.button === 1 || e.button === 2) {
      e.preventDefault()
      setIsPanning(true)
      dragDistRef.current = 0
      panStartRef.current = { x: mouseX, y: mouseY, panX: panXRef.current, panY: panYRef.current }
    }
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isPanning) return
    const canvas = canvasRef.current
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    const mouseX = e.clientX - rect.left
    const mouseY = e.clientY - rect.top

    const dx = mouseX - panStartRef.current.x
    const dy = mouseY - panStartRef.current.y
    dragDistRef.current = Math.max(dragDistRef.current, Math.abs(dx) + Math.abs(dy))

    setPanX(panStartRef.current.panX + dx)
    setPanY(panStartRef.current.panY + dy)
  }

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const wasPanning = isPanning
    setIsPanning(false)

    // Left click: if drag distance was small, treat as a click to select
    if (e.button === 0 && wasPanning && dragDistRef.current < 5) {
      const canvas = canvasRef.current
      if (!canvas || !officeStateRef.current) return

      const rect = canvas.getBoundingClientRect()
      const mouseX = e.clientX - rect.left
      const mouseY = e.clientY - rect.top
      const { offsetX, offsetY } = lastOffsetsRef.current
      const worldX = (mouseX - offsetX) / zoomRef.current
      const worldY = (mouseY - offsetY) / zoomRef.current

      const clickedId = officeStateRef.current.getCharacterAt(worldX, worldY)
      if (clickedId !== null) {
        const dept = departments[clickedId]
        if (dept) {
          onSelectDept(selectedDeptId === dept.id ? null : dept.id)
        }
      }
    }
  }

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    const delta = e.deltaY > 0 ? -0.5 : 0.5
    setZoom(prev => Math.max(1, Math.min(5, prev + delta)))
  }

  return (
    <div ref={containerRef} className="office-canvas-container panel">
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => setIsPanning(false)}
        onWheel={handleWheel}
        onContextMenu={e => e.preventDefault()}
        style={{ cursor: isPanning ? 'grabbing' : 'default' }}
      />
      <div className="zoom-controls">
        <button
          className="zoom-btn"
          onClick={() => setZoom(prev => Math.max(1, prev - 0.5))}
          disabled={zoom <= 1}
        >−</button>
        <input
          type="range"
          className="zoom-slider"
          min="1"
          max="5"
          step="0.25"
          value={zoom}
          onChange={e => setZoom(parseFloat(e.target.value))}
        />
        <button
          className="zoom-btn"
          onClick={() => setZoom(prev => Math.min(5, prev + 0.5))}
          disabled={zoom >= 5}
        >+</button>
        <span className="zoom-label">{zoom.toFixed(1)}x</span>
      </div>
    </div>
  )
}
