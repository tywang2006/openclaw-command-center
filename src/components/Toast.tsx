import { useState, useEffect, useCallback, createContext, useContext } from 'react'
import './Toast.css'

const TOAST_SUCCESS_MS = 5000
const TOAST_WARNING_MS = 5000
const TOAST_EXIT_ANIMATION_MS = 300

interface ToastItem {
  id: number
  message: string
  type: 'error' | 'success' | 'info' | 'warning'
}

interface ToastContextType {
  showToast: (message: string, type?: 'error' | 'success' | 'info' | 'warning') => void
}

const ToastContext = createContext<ToastContextType>({ showToast: () => {} })

export function useToast() {
  return useContext(ToastContext)
}

let nextId = 0

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const showToast = useCallback((message: string, type: 'error' | 'success' | 'info' | 'warning' = 'error') => {
    const id = nextId++
    setToasts(prev => [...prev, { id, message, type }])
  }, [])

  const removeToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="toast-container">
        {toasts.map(toast => (
          <ToastItem key={toast.id} toast={toast} onRemove={removeToast} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

function ToastItem({ toast, onRemove }: { toast: ToastItem; onRemove: (id: number) => void }) {
  const [exiting, setExiting] = useState(false)

  useEffect(() => {
    // Success and warning auto-dismiss after 5 seconds
    // Errors stay visible until manually dismissed
    if (toast.type === 'success') {
      const timer = setTimeout(() => setExiting(true), TOAST_SUCCESS_MS)
      return () => clearTimeout(timer)
    } else if (toast.type === 'warning') {
      const timer = setTimeout(() => setExiting(true), TOAST_WARNING_MS)
      return () => clearTimeout(timer)
    }
  }, [toast.type])

  useEffect(() => {
    if (exiting) {
      const timer = setTimeout(() => onRemove(toast.id), TOAST_EXIT_ANIMATION_MS)
      return () => clearTimeout(timer)
    }
  }, [exiting, toast.id, onRemove])

  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation()
    setExiting(true)
  }

  return (
    <div
      className={`toast-item toast-${toast.type} ${exiting ? 'toast-exit' : 'toast-enter'}`}
    >
      <svg className="toast-icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
        {toast.type === 'error' && (
          <><circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
          <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></>
        )}
        {toast.type === 'success' && (
          <><circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
          <path d="M5 8l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></>
        )}
        {toast.type === 'warning' && (
          <><circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
          <path d="M8 3v5M8 10v0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></>
        )}
        {toast.type === 'info' && (
          <><circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
          <path d="M8 5v0M8 7v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></>
        )}
      </svg>
      <span className="toast-msg">{toast.message}</span>
      <button
        className="toast-close"
        onClick={handleClose}
        aria-label="关闭"
        title="关闭"
      >
        ×
      </button>
    </div>
  )
}
