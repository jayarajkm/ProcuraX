/**
 * Optional smoke test against a RUNNING backend (read-only). Run with:
 *   LIVE_API=http://127.0.0.1:8000 pnpm test:live
 * Skipped in the normal `pnpm test` run.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import { ChatPlaygroundPage } from '@/pages/ChatPlaygroundPage'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { AuthProvider } from '@/auth/AuthContext'
import { AgentPage } from '@/pages/AgentPage'
import { ChatbotsPage } from '@/pages/ChatbotsPage'
import { DocumentsPage } from '@/pages/DocumentsPage'
import { KnowledgePage } from '@/pages/KnowledgePage'
import { MLModelsPage } from '@/pages/MLModelsPage'
import { InventoryPage } from '@/pages/InventoryPage'
import { OverviewPage } from '@/pages/OverviewPage'
import { ProductsPage } from '@/pages/ProductsPage'
import { PurchaseOrdersPage } from '@/pages/PurchaseOrdersPage'
import { RequestsPage } from '@/pages/RequestsPage'
import { SuppliersPage } from '@/pages/SuppliersPage'
import { setToken } from '@/lib/api'

const API = process.env.LIVE_API
const realFetch = globalThis.fetch

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }

describe.skipIf(!API)('live backend smoke', () => {
  const errors: unknown[][] = []
  let spy: ReturnType<typeof vi.spyOn>
  beforeAll(async () => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => realFetch(`${API}${url}`, init))
    const res = await realFetch(`${API}/api/v1/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'manager@procurax.demo', password: 'Demo@12345' }) })
    setToken(((await res.json()) as { access_token: string }).access_token)
    spy = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { errors.push(a) })
  })
  afterAll(() => { spy.mockRestore(); setToken(null) })

  const mount = (ui: React.ReactElement) => render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><AuthProvider>{ui}</AuthProvider></MemoryRouter>
    </QueryClientProvider>)

  it.each([
    ['Overview', <OverviewPage />, /Total products/i],
    ['Products', <ProductsPage />, /FAS-0001|SKU/],
    ['Suppliers', <SuppliersPage />, /SUP-001/],
    ['Inventory', <InventoryPage />, /Low stock|In stock/],
    ['Purchase Orders', <PurchaseOrdersPage />, /PO-\d+/],
    ['Requests', <RequestsPage />, /REQ-\d+/],
    ['AI Chatbots', <ChatbotsPage />, /Rule-Based Chatbot/],
    ['Documents', <DocumentsPage />, /Purchase Approval Policy/],
    ['Knowledge Center', <KnowledgePage />, /Search the knowledge base/],
    ['Agent Workspace', <AgentPage />, /Run the agent/],
    ['ML Models', <MLModelsPage />, /Training rows/],
  ])('%s renders live data without console errors', async (_n, ui, text) => {
    mount(ui)
    await waitFor(() => expect(screen.getAllByText(text).length).toBeGreaterThan(0), { timeout: 8000 })
    expect(errors).toEqual([])
  })

  // Rule-based only: deterministic, no LLM. Creates one chat session row (same as using the UI).
  it('Playground: rule-based example prompt round-trips with response details', async () => {
    Element.prototype.scrollIntoView = () => {}
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/chatbots/rule_based']}><AuthProvider>
          <Routes><Route path="/chatbots/:slug" element={<ChatPlaygroundPage />} /></Routes>
        </AuthProvider></MemoryRouter>
      </QueryClientProvider>)
    const thread = await screen.findByLabelText('Conversation', {}, { timeout: 8000 }) // scope: the history sidebar repeats prompt text
    const btn = await within(thread).findByRole('button', { name: /What is the purchase approval threshold\?/ })
    await userEvent.click(btn)
    await waitFor(() => expect(screen.getByRole('button', { name: /response details/i })).toBeInTheDocument(), { timeout: 8000 })
    expect(errors).toEqual([])
  }, 20000)
})
