import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ToastProvider } from './components/Toast'
import { LocaleProvider } from './i18n/index'
import { ThemeProvider } from './hooks/useTheme'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LocaleProvider>
      <ThemeProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </ThemeProvider>
    </LocaleProvider>
  </StrictMode>,
)
