import { useEffect, useRef, useState, useCallback } from 'react'
import type { Department, ToolState } from '../hooks/useAgentState'
import { consumeVisit, consumeMeetingEvent } from '../hooks/useAgentState'
import type { SubAgent } from './ChatPanel'
import { OfficeState } from '../office/engine/officeState'
import { renderFrame } from '../office/engine/renderer'
import { initFurnitureCatalog } from '../office/furnitureAssets'
import { authedFetch } from '../utils/api'
import {
  TILE_SIZE,
  TOOL_LABEL_COLOR,
  TOOL_LABEL_BG,
  TOOL_LABEL_BORDER,
} from '../constants'
import { useVisibilityInterval } from '../hooks/useVisibilityInterval'
import './OfficeCanvas.css'

const COLLAB_POLL_INTERVAL_MS = 60000

// Initialize furniture catalog once at module load
let catalogInitialized = false
if (!catalogInitialized) {
  catalogInitialized = initFurnitureCatalog()
}

interface CollabLink {
  from: string
  to: string
  label: string
  type?: 'org' | 'request'
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

  // Stable refs for render loop (prevents effect restarts)
  const departmentsRef = useRef(departments)
  departmentsRef.current = departments
  const toolStatesRef = useRef(toolStates)
  toolStatesRef.current = toolStates

  // Ambient animation time (reserved)
  const ambientTimeRef = useRef(0)

  // Active collaboration sessions — agents walk to requester's office with matching stroke
  const activeCollabRef = useRef<Map<string, { agents: number[], color: string }>>(new Map())

  // Track previous dept statuses for emotion triggers (F6)
  const prevStatusRef = useRef<Map<string, string>>(new Map())

  // Initialize office state when departments are loaded
  useEffect(() => {
    if (departments.length === 0) return
    if (officeStateRef.current) return

    authedFetch('/api/layout')
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
      // Do NOT force char.state here — let the FSM in updateCharacter handle transitions
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

  // Poll collaboration links every 60s (F11) — pauses when tab hidden
  const prevCollabKeyRef = useRef<string>('')
  const collabColors = ['#00d4aa', '#ffbb00', '#00a8ff', '#ff6688', '#aa66ff']
  const fetchCollab = useCallback(() => {
    authedFetch('/api/collaboration')
      .then(res => res.json())
      .then(data => {
        if (!Array.isArray(data?.links) || !officeStateRef.current) return
        const state = officeStateRef.current
        const links = data.links as CollabLink[]
        const newKey = links.map(l => `${l.from}:${l.to}`).sort().join(',')

        // No change — skip
        if (newKey === prevCollabKeyRef.current) return
        prevCollabKeyRef.current = newKey

        // End old collaborations: clear colors, send agents home
        for (const [, collab] of activeCollabRef.current) {
          for (const idx of collab.agents) {
            state.setCollabColor(idx, null)
            state.sendToSeat(idx)
          }
        }
        activeCollabRef.current.clear()

        if (links.length === 0) return

        // Start new collaborations: for each link, walk "to" agent to "from" agent's office
        let colorIdx = 0
        for (const link of links) {
          const fromIdx = departments.findIndex(d => d.id === link.from)
          const toIdx = departments.findIndex(d => d.id === link.to)
          if (fromIdx < 0 || toIdx < 0) continue

          const color = collabColors[colorIdx % collabColors.length]
          colorIdx++
          const key = `${link.from}:${link.to}`

          // "from" is the requester — "to" agent walks to "from"'s office
          const fromSeatId = `dept-${link.from}-chair-main`
          const fromSeat = state.seats.get(fromSeatId)
          if (!fromSeat) continue

          // Walk "to" agent near "from"'s seat
          const col = fromSeat.seatCol - 1
          const row = fromSeat.seatRow
          state.walkToTile(toIdx, col, row) ||
            state.walkToTile(toIdx, fromSeat.seatCol + 1, row) ||
            state.walkToTile(toIdx, fromSeat.seatCol, row - 1) ||
            state.walkToTile(toIdx, fromSeat.seatCol, row + 1)

          // Set matching stroke color on both agents
          state.setCollabColor(fromIdx, color)
          state.setCollabColor(toIdx, color)

          activeCollabRef.current.set(key, { agents: [fromIdx, toIdx], color })
        }
      })
      .catch((err) => {
        if (import.meta.env.DEV) console.warn('Fetch collaboration failed:', err);
      })
  }, [departments])
  useVisibilityInterval(fetchCollab, COLLAB_POLL_INTERVAL_MS, [fetchCollab])

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

  // Handle dept:visit events — poll from queue to avoid re-render loops
  useEffect(() => {
    const interval = setInterval(() => {
      if (!officeStateRef.current) return
      const state = officeStateRef.current
      const visit = consumeVisit()
      if (!visit) return

      const fromIdx = departments.findIndex(d => d.id === visit.from)
      const toIdx = departments.findIndex(d => d.id === visit.to)
      if (fromIdx < 0 || toIdx < 0) return

      // Find target department's seat position
      const targetSeatId = `dept-${visit.to}-chair-main`
      const targetSeat = state.seats.get(targetSeatId)
      if (!targetSeat) return

      // Walk the source agent to a tile near the target seat
      const col = targetSeat.seatCol - 1
      const row = targetSeat.seatRow
      const walked = state.walkToTile(fromIdx, col, row)
      if (!walked) {
        state.walkToTile(fromIdx, targetSeat.seatCol + 1, row) ||
        state.walkToTile(fromIdx, targetSeat.seatCol, row - 1) ||
        state.walkToTile(fromIdx, targetSeat.seatCol, row + 1)
      }

      // Get source agent's character to calculate path length
      const sourceChar = state.characters.get(fromIdx)
      if (!sourceChar) return
      const pathLength = sourceChar.path.length
      const walkTime = pathLength * 333 // 333ms per tile

      // After arrival: target faces visitor, shows thinking, visitor shows speech bubble
      setTimeout(() => {
        if (!officeStateRef.current) return
        const sc = officeStateRef.current.characters.get(fromIdx)
        if (!sc) return
        officeStateRef.current.faceToward(toIdx, sc.tileCol, sc.tileRow)
        officeStateRef.current.setAgentEmotion(toIdx, 'thinking')
        officeStateRef.current.showSpeechBubble(fromIdx, visit.message || '...')
      }, walkTime)

      // After conversation (arrival + 7 seconds): clear and return
      setTimeout(() => {
        if (!officeStateRef.current) return
        officeStateRef.current.setAgentEmotion(toIdx, null)
        officeStateRef.current.clearSpeechBubble(fromIdx)
        officeStateRef.current.sendToSeat(fromIdx)
      }, walkTime + 7000)
    }, 200)

    return () => clearInterval(interval)
  }, [departments, officeReady])

  // Handle meeting gathering animations — poll from queue like visits
  const processedMeetingsRef = useRef(new Set<string>())

  useEffect(() => {
    const interval = setInterval(() => {
      if (!officeStateRef.current) return
      const state = officeStateRef.current
      const event = consumeMeetingEvent()
      if (!event) return

      const depts = departmentsRef.current

      if (event.type === 'start') {
        if (processedMeetingsRef.current.has(event.meetingId)) return
        processedMeetingsRef.current.add(event.meetingId)

        // Find walkable tiles near map center for gathering
        const centerCol = Math.floor(state.layout.cols / 2)
        const centerRow = Math.floor(state.layout.rows / 2)

        // Sort walkable tiles by distance to center, pick closest ones
        const sortedTiles = [...state.walkableTiles]
          .map(t => ({ ...t, dist: Math.abs(t.col - centerCol) + Math.abs(t.row - centerRow) }))
          .sort((a, b) => a.dist - b.dist)

        const participants = event.deptIds
          .map((deptId) => depts.findIndex(d => d.id === deptId))
          .filter((idx) => idx >= 0)

        participants.forEach((agentIdx, i) => {
          // Pick a unique walkable tile near center for each participant
          const tile = sortedTiles[i % sortedTiles.length]
          if (!tile) return

          const walked = state.walkToTile(agentIdx, tile.col, tile.row)

          const char = state.characters.get(agentIdx)
          if (!char) return
          const pathLength = walked ? char.path.length : 0
          const walkTime = pathLength * 333

          setTimeout(() => {
            if (officeStateRef.current) {
              officeStateRef.current.showSpeechBubble(agentIdx, event.topic || 'Meeting', 10)
            }
          }, walkTime + 500)
        })
      } else if (event.type === 'end') {
        const participants = event.deptIds
          .map((deptId) => depts.findIndex(d => d.id === deptId))
          .filter((idx) => idx >= 0)

        participants.forEach((agentIdx) => {
          state.clearSpeechBubble(agentIdx)
          state.sendToSeat(agentIdx)
        })

        if (processedMeetingsRef.current.size > 100) {
          processedMeetingsRef.current.clear()
        }
      }
    }, 300)

    return () => clearInterval(interval)
  }, [officeReady])

  // Render loop using the full renderFrame pipeline (double-buffered to prevent flicker)
  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Offscreen buffer for flicker-free rendering
    let offscreen = document.createElement('canvas')
    let offCtx = offscreen.getContext('2d')!

    // Frame rate limiting: cap at 60fps to avoid wasteful rendering on high refresh displays
    const TARGET_FRAME_MS = 1000 / 60
    let lastFrameTime = 0

    const render = (time: number) => {
      // Skip rendering when tab is hidden to save resources
      if (document.hidden) {
        rafRef.current = requestAnimationFrame(render)
        return
      }

      // Frame rate cap: skip if insufficient time has elapsed since last frame
      if (lastFrameTime > 0 && time - lastFrameTime < TARGET_FRAME_MS) {
        rafRef.current = requestAnimationFrame(render)
        return
      }

      const dt = lastTimeRef.current ? Math.min((time - lastTimeRef.current) / 1000, 0.1) : 0
      lastTimeRef.current = time
      lastFrameTime = time

      if (officeStateRef.current) {
        officeStateRef.current.update(dt)
      }

      // Resize canvas to match container
      const rect = container.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      const w = Math.floor(rect.width)
      const h = Math.floor(rect.height)
      const pw = w * dpr
      const ph = h * dpr
      if (canvas.width !== pw || canvas.height !== ph) {
        canvas.width = pw
        canvas.height = ph
        canvas.style.width = `${w}px`
        canvas.style.height = `${h}px`
      }
      // Sync offscreen buffer size
      if (offscreen.width !== pw || offscreen.height !== ph) {
        offscreen.width = pw
        offscreen.height = ph
      }

      // Draw everything to offscreen buffer, then blit once to avoid flicker
      const drawCtx = offCtx
      drawCtx.setTransform(dpr, 0, 0, dpr, 0, 0)

      const isLight = document.documentElement.dataset.theme === 'light'

      if (!officeStateRef.current) {
        drawCtx.fillStyle = isLight ? '#f0f0f3' : '#0a0a14'
        drawCtx.fillRect(0, 0, w, h)
        drawCtx.fillStyle = isLight ? '#8a8a94' : '#2a2a4a'
        drawCtx.font = '14px monospace'
        drawCtx.textAlign = 'center'
        drawCtx.fillText('Loading office...', w / 2, h / 2)
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.clearRect(0, 0, pw, ph)
        ctx.drawImage(offscreen, 0, 0)
        rafRef.current = requestAnimationFrame(render)
        return
      }

      const state = officeStateRef.current

      // Use the full renderFrame from the game engine (double-buffered)
      const result = renderFrame(
        drawCtx,
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
          const dept = departmentsRef.current[char.id]
          if (dept) labelText = dept.name
        } else {
          labelText = subAgentNamesRef.current.get(char.id) || null
        }
        if (!labelText) return

        const screenX = offsetX + char.x * z
        const screenY = offsetY + (char.y - 20) * z

        drawCtx.save()
        drawCtx.font = `${Math.max(9, z * 5)}px monospace`
        drawCtx.textAlign = 'center'
        drawCtx.textBaseline = 'bottom'

        const text = labelText
        const metrics = drawCtx.measureText(text)
        const bgW = metrics.width + 6
        const bgH = Math.max(14, z * 6)

        drawCtx.fillStyle = isLight
          ? (isSub ? 'rgba(230, 245, 240, 0.92)' : 'rgba(255, 255, 255, 0.92)')
          : (isSub ? 'rgba(0, 50, 42, 0.85)' : 'rgba(30, 30, 46, 0.85)')
        drawCtx.fillRect(screenX - bgW / 2, screenY - bgH, bgW, bgH)

        const isSelected = state.selectedAgentId === char.id
        drawCtx.strokeStyle = isSelected
          ? (isLight ? '#009980' : '#00d4aa')
          : isSub
            ? (isLight ? '#009980' : '#00553a')
            : (isLight ? '#c8c8d0' : '#2a2a4a')
        drawCtx.lineWidth = 1
        drawCtx.strokeRect(screenX - bgW / 2, screenY - bgH, bgW, bgH)

        drawCtx.fillStyle = isSelected
          ? (isLight ? '#009980' : '#00d4aa')
          : isSub
            ? (isLight ? '#009980' : '#00aa88')
            : (isLight ? '#1a1a1e' : '#e0e0e0')
        drawCtx.fillText(text, screenX, screenY - 2)
        drawCtx.restore()

        // F7: Draw tool label below dept name
        if (!isSub && char.id >= 0 && char.id < departmentsRef.current.length) {
          const dept = departmentsRef.current[char.id]
          const tool = toolStatesRef.current?.get(dept.id)
          if (tool && !tool.done && tool.toolName !== 'unknown') {
            const toolScreenY = screenY + 2
            drawCtx.save()
            drawCtx.font = `${Math.max(7, z * 4)}px monospace`
            drawCtx.textAlign = 'center'
            drawCtx.textBaseline = 'top'
            const toolText = `[${tool.toolName}]`
            const tm = drawCtx.measureText(toolText)
            const tbgW = tm.width + 4
            const tbgH = Math.max(10, z * 5)
            drawCtx.fillStyle = TOOL_LABEL_BG
            drawCtx.fillRect(screenX - tbgW / 2, toolScreenY, tbgW, tbgH)
            drawCtx.strokeStyle = TOOL_LABEL_BORDER
            drawCtx.lineWidth = 1
            drawCtx.strokeRect(screenX - tbgW / 2, toolScreenY, tbgW, tbgH)
            drawCtx.fillStyle = TOOL_LABEL_COLOR
            drawCtx.fillText(toolText, screenX, toolScreenY + 1)
            drawCtx.restore()
          }
        }
      })

      // Collaboration stroke colors are rendered by renderer.ts via ch.collabColor
      // No additional drawing needed here

      // Ambient animations removed — caused user-reported flickering at desks

      // Blit offscreen buffer to visible canvas in one shot (prevents flicker)
      if (offscreen.width > 0 && offscreen.height > 0) {
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.clearRect(0, 0, pw, ph)
        ctx.drawImage(offscreen, 0, 0)
      }

      rafRef.current = requestAnimationFrame(render)
    }

    rafRef.current = requestAnimationFrame(render)

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

      // First try character click
      const clickedId = officeStateRef.current.getCharacterAt(worldX, worldY)
      if (clickedId !== null && clickedId >= 0) {
        const dept = departments[clickedId]
        if (dept) {
          onSelectDept(selectedDeptId === dept.id ? null : dept.id)
          return
        }
      }

      // If no character clicked, check furniture interaction (Phase 4G)
      handleFurnitureClick(worldX, worldY)
    }
  }

  // Phase 4G: Furniture interaction handler
  const handleFurnitureClick = (worldX: number, worldY: number) => {
    if (!officeStateRef.current) return

    const state = officeStateRef.current
    const clickCol = Math.floor(worldX / TILE_SIZE)
    const clickRow = Math.floor(worldY / TILE_SIZE)

    // Check each furniture piece for clicks
    for (const furn of state.furniture) {
      const furnLeft = furn.x
      const furnRight = furn.x + furn.sprite[0].length
      const furnTop = furn.y
      const furnBottom = furn.y + furn.sprite.length

      if (worldX >= furnLeft && worldX < furnRight && worldY >= furnTop && worldY < furnBottom) {
        // Find which department owns this furniture by checking seats/proximity
        const furnCol = Math.floor((furnLeft + furnRight) / 2 / TILE_SIZE)
        const furnRow = Math.floor((furnTop + furnBottom) / 2 / TILE_SIZE)

        // Find nearest department by seat proximity
        let nearestDept: Department | null = null
        let nearestDist = Infinity

        for (const [seatId, seat] of state.seats.entries()) {
          const dist = Math.abs(seat.seatCol - furnCol) + Math.abs(seat.seatRow - furnRow)
          if (dist < nearestDist) {
            nearestDist = dist
            // Extract dept ID from seat ID (format: "dept-{id}-chair-main")
            const match = seatId.match(/^dept-([^-]+)-/)
            if (match) {
              const deptId = match[1]
              const dept = departments.find(d => d.id === deptId)
              if (dept) {
                nearestDept = dept
              }
            }
          }
        }

        if (nearestDept && nearestDist <= 3) {
          // Trigger department-specific action based on furniture type
          // Detect furniture type by sprite characteristics or position
          const spriteHeight = furn.sprite.length
          const spriteWidth = furn.sprite[0].length

          // Heuristics for furniture detection:
          // Desk/Computer: wider sprites near seats
          // Bookshelf: tall narrow sprites
          // Bulletin board: check if in lobby/common area

          if (nearestDist <= 1) {
            // Click on desk/computer → open department chat
            onSelectDept(nearestDept.id)
            // Trigger chat tab switch would be handled by parent component
          }
        }

        break
      }
    }
  }

  // Native wheel listener with { passive: false } to allow preventDefault without console errors
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const handler = (e: WheelEvent) => {
      e.preventDefault()
      const delta = e.deltaY > 0 ? -0.5 : 0.5
      setZoom(prev => Math.max(1, Math.min(5, prev + delta)))
    }
    canvas.addEventListener('wheel', handler, { passive: false })
    return () => canvas.removeEventListener('wheel', handler)
  }, [])

  return (
    <div ref={containerRef} className="office-canvas-container panel">
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => setIsPanning(false)}
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
