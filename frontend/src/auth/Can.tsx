import type { ReactNode } from 'react'
import { useAuth } from './AuthContext'

/** Renders children only when the current user holds the permission. */
export function Can({ permission, children, fallback = null }: { permission: string; children: ReactNode; fallback?: ReactNode }) {
  const { can } = useAuth()
  return <>{can(permission) ? children : fallback}</>
}
