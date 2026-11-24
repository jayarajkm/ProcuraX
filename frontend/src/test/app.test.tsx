import { screen, waitFor } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Can } from '@/auth/Can'
import { ProtectedRoute } from '@/auth/ProtectedRoute'
import { DataTable, type Column } from '@/components/DataTable'
import { StatusBadge, statusTone } from '@/components/StatusBadge'
import { setToken } from '@/lib/api'
import { allowedTransitions } from '@/pages/purchaseOrderRules'
import { renderWithProviders } from './utils'

afterEach(() => { setToken(null); localStorage.clear(); vi.restoreAllMocks() })

function mockMe(permissions: string[]) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id: '1', email: 'a@b.c', full_name: 'Test', roles: ['Buyer'], permissions }), { status: 200 })))
}

describe('ProtectedRoute', () => {
  it('redirects unauthenticated users to /login', async () => {
    renderWithProviders(
      <Routes>
        <Route path="/login" element={<div>login page</div>} />
        <Route element={<ProtectedRoute />}><Route path="/secret" element={<div>secret</div>} /></Route>
      </Routes>, { route: '/secret' })
    expect(await screen.findByText('login page')).toBeInTheDocument()
    expect(screen.queryByText('secret')).not.toBeInTheDocument()
  })

  it('renders the protected page when a valid token exists', async () => {
    setToken('tok'); mockMe(['product:read'])
    renderWithProviders(
      <Routes><Route path="/login" element={<div>login page</div>} /><Route element={<ProtectedRoute />}><Route path="/secret" element={<div>secret</div>} /></Route></Routes>,
      { route: '/secret' })
    expect(await screen.findByText('secret')).toBeInTheDocument()
  })

  it('sends the user back to login when the stored token is rejected', async () => {
    setToken('bad')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'unauthorized', message: 'no' } }), { status: 401 })))
    renderWithProviders(
      <Routes><Route path="/login" element={<div>login page</div>} /><Route element={<ProtectedRoute />}><Route path="/secret" element={<div>secret</div>} /></Route></Routes>,
      { route: '/secret' })
    expect(await screen.findByText('login page')).toBeInTheDocument()
  })
})

describe('permission gating', () => {
  const Gate = () => <ProtectedRoute />
  const tree = (
    <Routes><Route element={<Gate />}><Route path="/" element={<Can permission="product:write"><button>Delete product</button></Can>} /></Route></Routes>
  )
  it('hides gated buttons without the permission', async () => {
    setToken('t'); mockMe(['product:read'])
    renderWithProviders(tree)
    await waitFor(() => expect(screen.queryByText('Delete product')).not.toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Delete product' })).toBeNull()
  })
  it('shows gated buttons with the permission', async () => {
    setToken('t'); mockMe(['product:write'])
    renderWithProviders(tree)
    expect(await screen.findByRole('button', { name: 'Delete product' })).toBeInTheDocument()
  })
})

describe('DataTable', () => {
  type Row = { id: string; name: string }
  const columns: Column<Row>[] = [{ key: 'name', header: 'Name', cell: (r) => r.name }]
  it('renders rows', () => {
    renderWithProviders(<DataTable columns={columns} rows={[{ id: '1', name: 'Widget' }, { id: '2', name: 'Gadget' }]} rowKey={(r) => r.id} />)
    expect(screen.getByText('Widget')).toBeInTheDocument()
    expect(screen.getByText('Gadget')).toBeInTheDocument()
  })
  it('renders the empty state', () => {
    renderWithProviders(<DataTable columns={columns} rows={[]} rowKey={(r) => r.id} emptyTitle="Nothing here" />)
    expect(screen.getByText('Nothing here')).toBeInTheDocument()
  })
  it('renders a loading skeleton and an error state', () => {
    const { unmount } = renderWithProviders(<DataTable columns={columns} rows={undefined} loading rowKey={(r) => r.id} />)
    expect(screen.getByRole('status')).toBeInTheDocument()
    unmount()
    renderWithProviders(<DataTable columns={columns} rows={undefined} error={new Error('boom')} rowKey={(r) => r.id} />)
    expect(screen.getByRole('alert')).toHaveTextContent('boom')
  })
})

describe('StatusBadge', () => {
  it('maps statuses to tones and humanises labels', () => {
    expect(statusTone('received')).toBe('green')
    expect(statusTone('cancelled')).toBe('red')
    expect(statusTone('pending_approval')).toBe('amber')
    expect(statusTone('unknown_thing')).toBe('neutral')
    renderWithProviders(<StatusBadge status="partially_received" />)
    expect(screen.getByText('Partially Received')).toHaveAttribute('data-tone', 'amber')
  })
})

describe('PO transitions', () => {
  const has = (perms: string[]) => (p: string) => perms.includes(p)
  it('follows the documented state machine', () => {
    expect(allowedTransitions('draft', has(['po:write']))).toEqual(['pending_approval', 'cancelled'])
    expect(allowedTransitions('sent', has(['po:write']))).toEqual(['partially_received', 'received', 'cancelled'])
    expect(allowedTransitions('received', has(['po:write']))).toEqual([])
  })
  it('requires po:approve for approval and po:write for any change', () => {
    expect(allowedTransitions('pending_approval', has(['po:write']))).toEqual(['draft', 'cancelled'])
    expect(allowedTransitions('pending_approval', has(['po:write', 'po:approve']))).toContain('approved')
    expect(allowedTransitions('draft', has([]))).toEqual([])
  })
})
