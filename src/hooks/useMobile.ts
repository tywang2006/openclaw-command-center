import { useEffect, useState, useCallback, useRef } from 'react'

const MOBILE_BREAKPOINT = 768

export function useMobile() {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < MOBILE_BREAKPOINT)

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  return isMobile
}

export function useSwipeGesture(onSwipeLeft: () => void, onSwipeRight: () => void) {
  const touchStartX = useRef(0)
  const touchStartY = useRef(0)

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX
    touchStartY.current = e.touches[0].clientY
  }, [])

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    const deltaX = e.changedTouches[0].clientX - touchStartX.current
    const deltaY = e.changedTouches[0].clientY - touchStartY.current
    const minSwipe = 60

    // Only trigger if horizontal swipe is dominant
    if (Math.abs(deltaX) > minSwipe && Math.abs(deltaX) > Math.abs(deltaY) * 1.5) {
      if (deltaX < 0) onSwipeLeft()
      else onSwipeRight()
    }
  }, [onSwipeLeft, onSwipeRight])

  return { handleTouchStart, handleTouchEnd }
}
