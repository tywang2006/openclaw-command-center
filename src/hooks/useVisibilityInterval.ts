import { useEffect, useRef } from 'react'

/**
 * Like setInterval but pauses when the tab is hidden (document.hidden).
 * Fires immediately on mount and when the tab becomes visible again.
 */
export function useVisibilityInterval(callback: () => void, delayMs: number, deps: unknown[] = []) {
  const savedCallback = useRef(callback)
  savedCallback.current = callback

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null

    const start = () => {
      if (!timer) {
        savedCallback.current()
        timer = setInterval(() => savedCallback.current(), delayMs)
      }
    }

    const stop = () => {
      if (timer) {
        clearInterval(timer)
        timer = null
      }
    }

    const onVisibilityChange = () => {
      if (document.hidden) {
        stop()
      } else {
        start()
      }
    }

    if (!document.hidden) {
      start()
    }

    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [delayMs, ...deps])
}
