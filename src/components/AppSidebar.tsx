import { useLocation, useNavigate } from 'react-router-dom'
import { useLocale } from '../i18n/index'
import './AppSidebar.css'

export default function AppSidebar() {
  const location = useLocation()
  const navigate = useNavigate()
  const { t } = useLocale()

  // Determine active page based on pathname
  const isOfficePage = location.pathname === '/'
  const isOpsPage = location.pathname.startsWith('/ops')

  return (
    <nav className="app-sidebar">
      <button
        className={`app-sidebar-btn ${isOfficePage ? 'active' : ''}`}
        onClick={() => navigate('/')}
        title={t('sidebar.office')}
      >
        <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
          <path d="M2 7l6-5 6 5v7H2V7z" stroke="currentColor" strokeWidth="1.3" fill="none" />
          <rect x="6" y="10" width="4" height="4" stroke="currentColor" strokeWidth="1.3" fill="none" />
        </svg>
        <span className="app-sidebar-label">{t('sidebar.office')}</span>
      </button>
      <button
        className={`app-sidebar-btn ${isOpsPage ? 'active' : ''}`}
        onClick={() => navigate('/ops')}
        title={t('sidebar.ops')}
      >
        <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
          <rect x="1" y="1" width="14" height="14" rx="1" stroke="currentColor" strokeWidth="1.3" fill="none" />
          <path d="M1 5h14M5 5v10" stroke="currentColor" strokeWidth="1.3" />
        </svg>
        <span className="app-sidebar-label">{t('sidebar.ops')}</span>
      </button>
    </nav>
  )
}
