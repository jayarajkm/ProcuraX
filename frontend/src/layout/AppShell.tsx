import { LogOut, Menu, PanelLeftClose, PanelLeftOpen, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '@/auth/AuthContext'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { NAV_ITEMS } from '@/config/nav'
import { cn } from '@/lib/utils'

function readCollapsed() {
  try { return localStorage.getItem('procurax.sidebar') === 'collapsed' } catch { return false }
}

export function AppShell() {
  const { user, logout } = useAuth()
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()

  useEffect(() => { setMobileOpen(false) }, [location.pathname])
  const toggle = () => {
    setCollapsed((c) => {
      try { localStorage.setItem('procurax.sidebar', c ? 'expanded' : 'collapsed') } catch { /* ignore */ }
      return !c
    })
  }

  const nav = (compact: boolean) => (
    <nav aria-label="Main navigation" className="flex-1 space-y-0.5 overflow-y-auto px-2 py-3">
      {NAV_ITEMS.map((item) => (
        <NavLink key={item.path} to={item.path} title={compact ? item.label : undefined}
          className={({ isActive }) => cn('flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
            isActive ? 'bg-primary text-primary-foreground' : 'text-slate-300 hover:bg-slate-800 hover:text-white', compact && 'justify-center px-2')}>
          <item.icon className="h-4 w-4 shrink-0" />
          {!compact && <span className="truncate">{item.label}</span>}
          {compact && <span className="sr-only">{item.label}</span>}
        </NavLink>
      ))}
    </nav>
  )
  const brand = (compact: boolean) => (
    <div className={cn('flex h-14 items-center gap-2 border-b border-slate-800 px-4 text-white', compact && 'justify-center px-2')}>
      <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-sm font-bold">P</div>
      {!compact && <span className="font-semibold tracking-tight">ProcuraX <span className="text-blue-300">AI</span></span>}
    </div>
  )

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className={cn('hidden flex-col bg-slate-900 transition-[width] md:flex', collapsed ? 'w-16' : 'w-60')}>
        {brand(collapsed)}
        {nav(collapsed)}
        <button type="button" onClick={toggle} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="flex items-center justify-center gap-2 border-t border-slate-800 py-3 text-xs text-slate-400 hover:text-white">
          {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <><PanelLeftClose className="h-4 w-4" /> Collapse</>}
        </button>
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-30 md:hidden">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col bg-slate-900">
            <div className="flex items-center justify-between pr-2">{brand(false)}
              <button type="button" aria-label="Close menu" onClick={() => setMobileOpen(false)} className="text-slate-300"><X className="h-5 w-5" /></button>
            </div>
            {nav(false)}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b bg-card px-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open menu" onClick={() => setMobileOpen(true)}><Menu className="h-5 w-5" /></Button>
            <Badge tone="amber" title="All records in this environment are generated for demonstration">Synthetic demo data</Badge>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden text-right text-sm leading-tight sm:block">
              <div className="font-medium">{user?.full_name}</div>
              <div className="text-xs text-muted-foreground">{user?.roles.join(', ')}</div>
            </div>
            <Button variant="outline" size="sm" onClick={logout}><LogOut className="h-4 w-4" /> Sign out</Button>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 md:p-6"><div className="mx-auto max-w-7xl"><Outlet /></div></main>
      </div>
    </div>
  )
}
