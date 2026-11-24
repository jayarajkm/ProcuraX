import { useCallback, useSyncExternalStore } from 'react'
import { useLanguages } from '@/hooks/api'
import type { Language } from '@/lib/types'

const KEY = 'procurax.language'
const FALLBACK: Language[] = [{ code: 'en', name: 'English', native_name: 'English', rtl: false }]
let memory = 'en'  // used only if localStorage is unavailable
const listeners = new Set<() => void>()

function read(): string {
  try { return localStorage.getItem(KEY) || 'en' } catch { return memory }
}
function subscribe(cb: () => void) {
  listeners.add(cb)
  window.addEventListener('storage', cb)
  return () => { listeners.delete(cb); window.removeEventListener('storage', cb) }
}
function write(code: string) {
  memory = code
  try { localStorage.setItem(KEY, code) } catch { /* storage blocked: keep in memory */ }
  listeners.forEach((l) => l())
}

/** Language metadata lookups (name / rtl) for any code, tolerant of an unknown or not-yet-loaded list. */
export function useLanguageInfo() {
  const q = useLanguages()
  const list = q.data?.length ? q.data : FALLBACK
  return {
    languages: list,
    isLoading: q.isLoading,
    error: q.error,
    refetch: q.refetch,
    nameOf: (code?: string | null) => (code ? list.find((l) => l.code === code)?.name ?? code : ''),
    isRtl: (code?: string | null) => !!code && !!list.find((l) => l.code === code)?.rtl,
  }
}

/** Shared, persisted response-language preference (default 'en'; an unknown stored code falls back to 'en'). */
export function useLanguage() {
  const info = useLanguageInfo()
  const stored = useSyncExternalStore(subscribe, read, () => 'en')
  const known = info.languages.some((l) => l.code === stored)
  // until the list has loaded we cannot validate the stored code, so treat it as English
  const code = known ? stored : 'en'
  const language = info.languages.find((l) => l.code === code) ?? FALLBACK[0]
  const setCode = useCallback((c: string) => write(c), [])
  return { ...info, code, language, rtl: language.rtl, setCode }
}
