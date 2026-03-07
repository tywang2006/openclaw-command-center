import { useEffect, useRef, useState } from 'react'
import type { Department } from '../hooks/useAgentState'
import type { SubAgent } from './ChatPanel'
import { OfficeState } from '../office/engine/officeState'
import { renderFrame } from '../office/engine/renderer'
import { initFurnitureCatalog } from '../office/furnitureAssets'
import './OfficeCanvas.css'

// Initialize furniture catalog once at module load
let catalogInitialized = false
if (!catalogInitialized) {
  catalogInitialized = initFurnitureCatalog()
}

interface OfficeCanvasProps {
  departments: Department[]
  selectedDeptId: string | null
  onSelectDept: (deptId: string | null) => void
  subAgents?: Record<string, SubAgent[]>
}

// Map department IDs to character sprite palettes
const DEPT_TO_CHAR_ID: Record<string, number> = {
  coo: 0,
  engineering: 1,
  operations: 2,
  research: 3,
  product: 4,
  admin: 5,
  blockchain: 0, // Uses char_0 with hue shift
}

// Map department IDs to their main chair seat UID in the layout
const DEPT_TO_SEAT: Record<string, string> = {
  coo: 'dept-coo-chair-main',
  engineering: 'dept-engineering-chair-main',
  operations: 'dept-operations-chair-main',
  research: 'dept-research-chair-main',
  product: 'dept-product-chair-main',
  admin: 'dept-admin-chair-main',
  blockchain: 'dept-blockchain-chair-main',
}

export default function OfficeCanvas({ departments, selectedDeptId, onSelectDept, subAgents }: OfficeCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const officeStateRef = useRef<OfficeState | null>(null)
  const rafRef = useRef<number>(0)
  const lastTimeRef = useRef<number>(0)

  // Pan state (pixel offset from center)
  const [panX, setPanX] = useState(0)
  const [panY, setPanY] = useState(0)
  const [zoom, setZoom] = useState(2)
  const [isPanning, setIsPanning] = useState(false)
  const panStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 })

  // Track last render offsets for click detection
  const lastOffsetsRef = useRef({ offsetX: 0, offsetY: 0 })

  // Sub-agent character ID → display name
  const subAgentNamesRef = useRef<Map<number, string>>(new Map())

  // Initialize office state when departments are loaded
  useEffect(() => {
    if (departments.length === 0) return
    if (officeStateRef.current) return

    fetch('/cmd/assets/default-layout.json')
      .then(res => res.json())
      .then(layout => {
        officeStateRef.current = new OfficeState(layout)
        departments.forEach((dept, index) => {
          const charId = DEPT_TO_CHAR_ID[dept.id] ?? 0
          const hueShift = dept.id === 'blockchain' ? 180 : 0
          const seatId = DEPT_TO_SEAT[dept.id]
          officeStateRef.current!.addAgent(index, charId, hueShift, seatId, true)
        })
      })
      .catch(err => {
        console.error('[OfficeCanvas] Failed to load layout:', err)
        officeStateRef.current = new OfficeState()
        departments.forEach((dept, index) => {
          const charId = DEPT_TO_CHAR_ID[dept.id] ?? 0
          const hueShift = dept.id === 'blockchain' ? 180 : 0
          const seatId = DEPT_TO_SEAT[dept.id]
          officeStateRef.current!.addAgent(index, charId, hueShift, seatId, true)
        })
      })
  }, [departments])

  // Update characters when departments change
  useEffect(() => {
    if (!officeStateRef.current) return
    departments.forEach((dept, index) => {
      const isActive = dept.status === 'active'
      officeStateRef.current!.setAgentActive(index, isActive)
    })
  }, [departments])

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
  }, [selectedDeptId, departments])

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
  }, [subAgents, departments])

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

      // Use the full renderFrame from the game engine
      const result = renderFrame(
        ctx,
        w,
        h,
        state.tileMap,
        state.furniture,
        state.getCharacters(),
        zoom,
        panX,
        panY,
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

        const screenX = offsetX + char.x * zoom
        const screenY = offsetY + (char.y - 20) * zoom

        ctx.save()
        ctx.font = `${Math.max(9, zoom * 5)}px monospace`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'bottom'

        const text = labelText
        const metrics = ctx.measureText(text)
        const bgW = metrics.width + 6
        const bgH = Math.max(14, zoom * 6)

        ctx.fillStyle = isSub ? 'rgba(0, 50, 42, 0.85)' : 'rgba(30, 30, 46, 0.85)'
        ctx.fillRect(screenX - bgW / 2, screenY - bgH, bgW, bgH)

        const isSelected = state.selectedAgentId === char.id
        ctx.strokeStyle = isSelected ? '#00d4aa' : isSub ? '#00553a' : '#2a2a4a'
        ctx.lineWidth = 1
        ctx.strokeRect(screenX - bgW / 2, screenY - bgH, bgW, bgH)

        ctx.fillStyle = isSelected ? '#00d4aa' : isSub ? '#00aa88' : '#e0e0e0'
        ctx.fillText(text, screenX, screenY - 2)
        ctx.restore()
      })

      rafRef.current = requestAnimationFrame(render)
    }

    rafRef.current = requestAnimationFrame(render)

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [panX, panY, zoom, departments, selectedDeptId])

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
      panStartRef.current = { x: mouseX, y: mouseY, panX, panY }
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
      const worldX = (mouseX - offsetX) / zoom
      const worldY = (mouseY - offsetY) / zoom

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
