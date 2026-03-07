import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'
import { zh } from './zh'
import { en } from './en'

type Locale = 'zh' | 'en'
type Translations = Record<string, string>

const translations: Record<Locale, Translations> = { zh, en }

interface LocaleContextType {
  locale: Locale
  setLocale: (l: Locale) => void
  t: (key: string, params?: Record<string, string | number>) => string
}

const LocaleContext = createContext<LocaleContextType>(null!)

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    return (localStorage.getItem('cmd_locale') as Locale) || 'zh'
  })

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l)
    localStorage.setItem('cmd_locale', l)
  }, [])

  const t = useCallback((key: string, params?: Record<string, string | number>) => {
    let text = translations[locale][key] || translations['zh'][key] || key
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v))
      }
    }
    return text
  }, [locale])

  return (
    <LocaleContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </LocaleContext.Provider>
  )
}

export function useLocale() {
  return useContext(LocaleContext)
}

export type { Locale }
