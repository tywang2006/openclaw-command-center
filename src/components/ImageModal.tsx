import { useState, useEffect, useRef, useCallback } from 'react'

interface ImageModalProps {
  src: string
  onClose: () => void
}

export default function ImageModal({ src, onClose }: ImageModalProps) {
  const [scale, setScale] = useState(1)
  const [translate, setTranslate] = useState({ x: 0, y: 0 })
  const lastTouchDist = useRef<number | null>(null)
  const panStart = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  // Prevent body scroll while modal is open
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  const resetTransform = useCallback(() => {
    setScale(1)
    setTranslate({ x: 0, y: 0 })
  }, [])

  // Pinch-to-zoom
  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      e.preventDefault()
      const dx = e.touches[0].clientX - e.touches[1].clientX
      const dy = e.touches[0].clientY - e.touches[1].clientY
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (lastTouchDist.current !== null) {
        const ratio = dist / lastTouchDist.current
        setScale(prev => Math.min(5, Math.max(0.5, prev * ratio)))
      }
      lastTouchDist.current = dist
    } else if (e.touches.length === 1 && scale > 1 && panStart.current) {
      const dx = e.touches[0].clientX - panStart.current.x
      const dy = e.touches[0].clientY - panStart.current.y
      setTranslate({ x: panStart.current.tx + dx, y: panStart.current.ty + dy })
    }
  }, [scale])

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX
      const dy = e.touches[0].clientY - e.touches[1].clientY
      lastTouchDist.current = Math.sqrt(dx * dx + dy * dy)
    } else if (e.touches.length === 1 && scale > 1) {
      panStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, tx: translate.x, ty: translate.y }
    }
  }, [scale, translate])

  const handleTouchEnd = useCallback(() => {
    lastTouchDist.current = null
    panStart.current = null
  }, [])

  // Double-tap to reset/zoom
  const lastTap = useRef(0)
  const handleTap = useCallback(() => {
    const now = Date.now()
    if (now - lastTap.current < 300) {
      if (scale !== 1) {
        resetTransform()
      } else {
        setScale(2)
      }
    }
    lastTap.current = now
  }, [scale, resetTransform])

  return (
    <div
      className="image-modal-overlay"
      onClick={onClose}
      ref={containerRef}
    >
      <button className="image-modal-close" onClick={onClose} aria-label="Close">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      </button>
      <div
        className="image-modal-content"
        onClick={e => e.stopPropagation()}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClickCapture={handleTap}
      >
        <img
          src={src}
          alt=""
          className="image-modal-img"
          style={{
            transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
          }}
          draggable={false}
        />
      </div>
    </div>
  )
}
