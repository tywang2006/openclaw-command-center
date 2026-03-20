import { useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import './MobileDrawer.css'

interface NotifyPrefs {
  enabled: boolean
  errors: boolean
  gateway: boolean
  slow: boolean
}

interface MobileDrawerProps {
  open: boolean
  onClose: () => void
  locale: string
  onToggleLocale: () => void
  onToggleFullscreen: () => void
  isFullscreen: boolean
  onLogout: () => void
  notifyPrefs: NotifyPrefs
  onToggleNotifications: () => void
  onToggleNotifyPref: (key: 'errors' | 'gateway' | 'slow') => void
  t: (key: string) => string
}

export default function MobileDrawer({
  open,
  onClose,
  locale,
  onToggleLocale,
  onToggleFullscreen,
  isFullscreen,
  onLogout,
  notifyPrefs,
  onToggleNotifications,
  onToggleNotifyPref,
  t,
}: MobileDrawerProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const isOps = location.pathname.startsWith('/ops')

  // Lock body scroll when open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [open])

  return (
    <>
      <div
        className={`mobile-drawer-overlay ${open ? 'open' : ''}`}
        onClick={onClose}
      />
      <aside className={`mobile-drawer ${open ? 'open' : ''}`}>
        <div className="mobile-drawer-header">
          <span className="mobile-drawer-title">{t('app.title')}</span>
          <button className="mobile-drawer-close" onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <nav className="mobile-drawer-menu">
          {/* Page navigation */}
          <button className={`mobile-drawer-item ${!isOps ? 'active' : ''}`} onClick={() => { navigate('/'); onClose() }}>
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
              <path d="M2 7l6-5 6 5v7H2V7z" stroke="currentColor" strokeWidth="1.3" fill="none" />
              <rect x="6" y="10" width="4" height="4" stroke="currentColor" strokeWidth="1.3" fill="none" />
            </svg>
            <span>{t('sidebar.office') || '办公室'}</span>
          </button>
          <button className={`mobile-drawer-item ${isOps ? 'active' : ''}`} onClick={() => { navigate('/ops'); onClose() }}>
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
              <rect x="1" y="1" width="14" height="14" rx="1" stroke="currentColor" strokeWidth="1.3" fill="none" />
              <path d="M1 5h14M5 5v10" stroke="currentColor" strokeWidth="1.3" />
            </svg>
            <span>{t('sidebar.ops') || '控制台'}</span>
          </button>

          <div className="mobile-drawer-divider" />

          {/* Language toggle */}
          <button className="mobile-drawer-item" onClick={() => { onToggleLocale(); onClose() }}>
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.3" />
              <path d="M1.5 8h13M8 1.5c-2 2-2 11 0 13M8 1.5c2 2 2 11 0 13" stroke="currentColor" strokeWidth="1.3" />
            </svg>
            <span>{t('drawer.language')}</span>
            <span className="mobile-drawer-badge">{locale === 'zh' ? 'EN' : '中'}</span>
          </button>

          {/* Fullscreen toggle */}
          <button className="mobile-drawer-item" onClick={() => { onToggleFullscreen(); onClose() }}>
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
              {isFullscreen ? (
                <path d="M5 1v4H1M11 1v4h4M5 15v-4H1M11 15v-4h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              ) : (
                <path d="M1 5V1h4M15 5V1h-4M1 11v4h4M15 11v4h-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              )}
            </svg>
            <span>{t('drawer.fullscreen')}</span>
          </button>

          {/* Notifications section */}
          <div className="mobile-drawer-section">
            <span className="mobile-drawer-section-label">{t('drawer.notifications')}</span>
          </div>

          <label className="mobile-drawer-toggle">
            <span>{t('notify.enable')}</span>
            <input type="checkbox" checked={notifyPrefs.enabled} onChange={onToggleNotifications} />
          </label>
          <label className="mobile-drawer-toggle sub">
            <span>{t('notify.errors')}</span>
            <input type="checkbox" checked={notifyPrefs.errors} onChange={() => onToggleNotifyPref('errors')} disabled={!notifyPrefs.enabled} />
          </label>
          <label className="mobile-drawer-toggle sub">
            <span>{t('notify.gateway')}</span>
            <input type="checkbox" checked={notifyPrefs.gateway} onChange={() => onToggleNotifyPref('gateway')} disabled={!notifyPrefs.enabled} />
          </label>
          <label className="mobile-drawer-toggle sub">
            <span>{t('notify.slow')}</span>
            <input type="checkbox" checked={notifyPrefs.slow} onChange={() => onToggleNotifyPref('slow')} disabled={!notifyPrefs.enabled} />
          </label>

          {/* Divider */}
          <div className="mobile-drawer-divider" />

          {/* Logout */}
          <button className="mobile-drawer-item danger" onClick={() => { onLogout(); onClose() }}>
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
              <path d="M6 2H3v12h3M11 4l4 4-4 4M7 8h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>{t('drawer.logout')}</span>
          </button>
        </nav>
      </aside>
    </>
  )
}
