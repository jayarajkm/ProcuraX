import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api, loadStoredToken, onUnauthorized, setToken } from '@/lib/api'
import type { Me } from '@/lib/types'

interface AuthState {
  user: Me | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => void
  can: (permission: string) => boolean
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const [user, setUser] = useState<Me | null>(null)
  const [loading, setLoading] = useState<boolean>(() => !!loadStoredToken())

  const clear = useCallback(() => {
    setToken(null)
    setUser(null)
    qc.clear()
  }, [qc])

  useEffect(() => {
    onUnauthorized(clear)
    return () => onUnauthorized(null)
  }, [clear])

  useEffect(() => {
    if (!loading) return
    let cancelled = false
    api.get<Me>('/auth/me')
      .then((me) => { if (!cancelled) setUser(me) })
      .catch(() => { if (!cancelled) clear() })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [loading, clear])

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.post<{ access_token: string }>('/auth/login', { email, password }, { auth: false })
    setToken(res.access_token)
    try {
      setUser(await api.get<Me>('/auth/me'))
    } catch (e) {
      setToken(null)
      throw e
    }
  }, [])

  const value = useMemo<AuthState>(
    () => ({ user, loading, login, logout: clear, can: (p) => !!user?.permissions.includes(p) }),
    [user, loading, login, clear],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
