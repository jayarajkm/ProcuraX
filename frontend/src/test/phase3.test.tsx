import '@testing-library/jest-dom/vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { CompareCard, CompareSummary, type BotRun } from '@/components/compare/CompareCard'
import { ProviderRow } from '@/components/admin/AdminConfigTabs'
import { InsightsPanel } from '@/components/InsightsPanel'
import { NAV_ITEMS } from '@/config/nav'
import { setToken } from '@/lib/api'
import type { CompareResult } from '@/lib/types'
import { AdminPage } from '@/pages/AdminPage'
import { AIAnalyticsPage } from '@/pages/AIAnalyticsPage'
import { ComparePage } from '@/pages/ComparePage'
import { renderWithProviders } from './utils'

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
beforeAll(() => { vi.stubGlobal('ResizeObserver', ResizeObserverStub) })
afterEach(() => { setToken(null); localStorage.clear(); vi.unstubAllGlobals(); vi.stubGlobal('ResizeObserver', ResizeObserverStub) })

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const me = (permissions: string[]) => ({ id: '1', email: 'a@b.c', full_name: 'T', roles: [], permissions })
/** Routes fetch by "METHOD path" substring; records calls. */
function mockApi(routes: Record<string, (init?: RequestInit) => Response | Promise<Response>>) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${url}`
    const hit = Object.keys(routes).find((k) => key.includes(k))
    return hit ? routes[hit](init) : json({ error: { code: 'not_found', message: `unmocked ${key}` } }, 404)
  })
  vi.stubGlobal('fetch', fn)
  return fn
}
const done = (result: CompareResult): BotRun => ({ phase: 'done', startedAt: 0, result })
const base = { duration_ms: 12, action_executed: false } as const

describe('CompareCard states', () => {
  it('ok without confidence says none was produced and shows no percentage', () => {
    renderWithProviders(<CompareCard slug="rule_based" run={done({ ...base, slug: 'rule_based', status: 'ok', reply: 'Threshold is **$5,000**', approach: 'Rule engine', data_sources: ['rules'] })} />)
    expect(screen.getByText(/no confidence score produced by this technique/)).toBeInTheDocument()
    expect(screen.queryByText(/%/)).not.toBeInTheDocument()
    expect(screen.getByText('$5,000').tagName).toBe('STRONG')
    expect(screen.getByText('Action executed: no')).toBeInTheDocument()
    expect(screen.getByText('rules')).toBeInTheDocument()
  })
  it('ok with confidence shows value and its kind', () => {
    renderWithProviders(<CompareCard slug="nlp" run={done({ ...base, slug: 'nlp', status: 'ok', reply: 'r', confidence: 0.524, confidence_kind: 'cosine similarity to best intent example' })} />)
    expect(screen.getByText('52.4%')).toBeInTheDocument()
    expect(screen.getByText(/cosine similarity to best intent example/)).toBeInTheDocument()
    expect(screen.queryByText(/no confidence score/)).not.toBeInTheDocument()
  })
  it('renders retrieval citations and a result table', () => {
    renderWithProviders(<CompareCard slug="rag" run={done({ ...base, slug: 'rag', status: 'ok', reply: 'r', retrieval: [{ ref: 1, document: 'Approval Policy', page: 3, similarity: 0.518 }], table: { columns: ['PO'], rows: [['PO-1']] } })} />)
    expect(screen.getByText(/Approval Policy/)).toBeInTheDocument()
    expect(screen.getByText(/page 3/)).toBeInTheDocument()
    expect(screen.getByText('0.518')).toBeInTheDocument()
    expect(screen.getByText('PO-1')).toBeInTheDocument()
  })
  it('not_configured shows the setup message as a note, not an error', () => {
    renderWithProviders(<CompareCard slug="generative" run={done({ ...base, slug: 'generative', status: 'not_configured', reply: 'No LLM provider is configured. Set GROQ_API_KEY.' })} />)
    expect(screen.getByRole('note')).toHaveTextContent('No LLM provider is configured')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
  it('agent awaiting approval says nothing was executed and links to /agent', () => {
    renderWithProviders(<CompareCard slug="agentic" run={done({ ...base, slug: 'agentic', status: 'ok', reply: 'Prepared a request', extra: { execution_status: 'awaiting_approval', execution_id: 'ex1' } })} />)
    expect(screen.getByText(/Prepared, awaiting human approval — nothing executed/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Agent Workspace/ })).toHaveAttribute('href', '/agent?execution=ex1')
    expect(screen.getByText('Action executed: no')).toBeInTheDocument()
  })
  it('error and provider_error render as red alerts; forbidden is muted', () => {
    const { rerender } = renderWithProviders(<CompareCard slug="ml" run={done({ ...base, slug: 'ml', status: 'error', message: 'ValueError: boom' })} />)
    expect(screen.getByRole('alert')).toHaveTextContent('ValueError: boom')
    rerender(<CompareCard slug="generative" run={done({ ...base, slug: 'generative', status: 'provider_error', reply: 'The provider returned an error: 429' })} />)
    expect(screen.getByRole('alert')).toHaveTextContent('429')
    rerender(<CompareCard slug="agentic" run={done({ ...base, slug: 'agentic', status: 'forbidden', message: 'Your role cannot run the agent.' })} />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText('Your role cannot run the agent.')).toBeInTheDocument()
  })
  it('running shows a spinner status with an elapsed timer', () => {
    renderWithProviders(<CompareCard slug="agentic" run={{ phase: 'running', startedAt: Date.now() }} />)
    expect(screen.getByRole('status')).toHaveTextContent(/Running/)
    expect(screen.getByTestId('elapsed-agentic')).toHaveTextContent(/\d+\.\ds/)
  })
})

describe('CompareSummary', () => {
  it('never shows a confidence for bots that returned none', () => {
    renderWithProviders(<CompareSummary rows={[
      { slug: 'rule_based', included: true, run: done({ ...base, slug: 'rule_based', status: 'ok', reply: 'x', data_sources: ['a', 'b'] }) },
      { slug: 'nlp', included: true, run: done({ ...base, slug: 'nlp', status: 'ok', reply: 'x', confidence: 0.5, confidence_kind: 'cosine' }) },
      { slug: 'generative', included: true, run: done({ ...base, slug: 'generative', status: 'not_configured', reply: 'No LLM' }) },
      { slug: 'rag', included: false, run: { phase: 'idle' } },
      { slug: 'agentic', included: true, run: { phase: 'running', startedAt: 0 } },
    ]} />)
    expect(screen.getByTestId('summary-conf-rule_based')).toHaveTextContent('—')
    expect(screen.getByTestId('summary-conf-rule_based')).not.toHaveTextContent('%')
    expect(screen.getByTestId('summary-conf-nlp')).toHaveTextContent('50.0%')
    expect(screen.getByTestId('summary-conf-generative')).toHaveTextContent('—')
    expect(screen.getByTestId('summary-rag')).toHaveTextContent('Excluded')
    expect(within(screen.getByTestId('summary-rule_based')).getByText('2')).toBeInTheDocument()
  })
})

describe('ComparePage', () => {
  it('calls all included bots in parallel and fills cards independently', async () => {
    setToken('t')
    let release: (r: Response) => void = () => {}
    const slow = new Promise<Response>((res) => { release = res })
    const fetchMock = mockApi({
      '/auth/me': () => json(me(['chat:use'])),
      '/compare/agentic': () => slow,
      '/compare/': () => json({ slug: 'x', status: 'ok', duration_ms: 5, reply: 'fast answer', action_executed: false }),
    })
    const user = userEvent.setup()
    renderWithProviders(<ComparePage />)
    await user.click(screen.getByRole('button', { name: 'Show my open purchase orders' }))
    expect(screen.getByLabelText('Your question')).toHaveValue('Show my open purchase orders')
    await user.click(screen.getByLabelText('Machine Learning'))  // exclude ML
    await user.click(screen.getByRole('button', { name: /Compare 5 bots/ }))
    await waitFor(() => expect(screen.getAllByText('fast answer')).toHaveLength(4))
    const urls = fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => u.includes('/compare/'))
    expect(urls.sort()).toEqual(['generative', 'nlp', 'rag', 'rule_based', 'agentic'].sort().map((s) => `/api/v1/compare/${s}`))
    expect(screen.getByTestId('elapsed-agentic')).toBeInTheDocument()  // agent still running while others are done
    release(json({ slug: 'agentic', status: 'ok', duration_ms: 90000, reply: 'agent done', action_executed: false }))
    expect(await screen.findByText('agent done')).toBeInTheDocument()
    expect(screen.getByRole('table', { name: 'Comparison summary' })).toBeInTheDocument()
  })
})

describe('AdminPage gating', () => {
  it('shows the Administrator only card and makes no admin calls without admin:manage', async () => {
    setToken('t')
    const fetchMock = mockApi({ '/auth/me': () => json(me(['chat:use', 'ml:read'])) })
    renderWithProviders(<AdminPage />)
    expect(await screen.findByText('Administrator only')).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Providers' })).not.toBeInTheDocument()
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/admin/'))).toBe(false)
  })
  it('shows tabs and loads providers for admin:manage', async () => {
    setToken('t')
    mockApi({
      '/auth/me': () => json(me(['admin:manage'])),
      '/admin/providers': () => json([{ provider: 'groq', model: 'm1', is_default: true, api_key_env_var: 'GROQ_API_KEY', key_configured: true }]),
    })
    renderWithProviders(<AdminPage />)
    expect(await screen.findByRole('tab', { name: 'Audit log' })).toBeInTheDocument()
    expect(await screen.findByText('key set on server')).toBeInTheDocument()
    expect(screen.getByText(/API keys live only in the server environment/)).toBeInTheDocument()
  })
})

describe('AIAnalyticsPage', () => {
  it('is available to ml:read without admin and blocked without it', async () => {
    setToken('t')
    mockApi({
      '/auth/me': () => json(me(['ml:read'])),
      '/analytics/ai': () => json({ window_days: 30, messages_by_bot: [], questions_per_day: [], agent_executions_by_status: [], tool_usage: [], approvals: [], ml_predictions_by_model: [], documents_by_status: [], note: 'Counts come from persisted history tables.' }),
    })
    renderWithProviders(<AIAnalyticsPage />)
    expect(await screen.findByText(/Counts come from persisted history tables/)).toBeInTheDocument()
    expect(screen.getByText('No approvals recorded')).toBeInTheDocument()
  })
  it('nav keeps the required order with Analytics beside ML Models', () => {
    expect(NAV_ITEMS.map((n) => n.label)).toEqual(['Overview', 'Products', 'Suppliers', 'Inventory', 'Purchase Orders', 'Procurement Requests', 'Documents', 'AI Chatbots', 'Chatbot Comparison', 'Knowledge Center', 'Agent Workspace', 'ML Models', 'AI Analytics', 'AI Administration', 'Settings'])
    expect(NAV_ITEMS.find((n) => n.path === '/compare')?.placeholder).toBeUndefined()
    expect(NAV_ITEMS.find((n) => n.path === '/admin')?.placeholder).toBeUndefined()
  })
})

describe('ProviderRow', () => {
  const p = { provider: 'anthropic', model: 'claude', is_default: false, api_key_env_var: 'ANTHROPIC_API_KEY', key_configured: false }
  it('disables Make default with an explanation when the key is not configured', () => {
    renderWithProviders(<ProviderRow p={p} />)
    expect(screen.getByRole('button', { name: 'Make default' })).toBeDisabled()
    expect(screen.getByText('not set')).toBeInTheDocument()
    expect(screen.getByText(/is not set in the server environment/)).toBeInTheDocument()
  })
  it('confirms before PATCHing and shows a 409 message from the API', async () => {
    setToken('t')
    const fetchMock = mockApi({
      '/auth/me': () => json(me([])),
      'PATCH /api/v1/admin/providers/anthropic': () => json({ error: { code: 'key_missing', message: 'ANTHROPIC_API_KEY is not set on the server' } }, 409),
    })
    const patches = () => fetchMock.mock.calls.filter((c) => c[1]?.method === 'PATCH')
    const user = userEvent.setup()
    renderWithProviders(<ProviderRow p={{ ...p, key_configured: true }} />)
    await user.click(screen.getByRole('button', { name: 'Make default' }))
    expect(patches()).toHaveLength(0)  // dialog first
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Make default' }))
    await waitFor(() => expect(patches()).toHaveLength(1))
    expect(JSON.parse(String(patches()[0][1]?.body))).toEqual({ is_default: true })
    expect((await screen.findAllByText('ANTHROPIC_API_KEY is not set on the server')).length).toBeGreaterThan(0)
  })
})

describe('InsightsPanel', () => {
  const items = [{ severity: 'high', title: '30 POs overdue', detail: 'Past due', source: 'purchase_orders', link: '/purchase-orders' }, { severity: 'low', title: 'FYI', detail: 'd', source: 'x', link: null }]
  it('lists items and only requests the narrative on click; null text falls back to the reason', async () => {
    const fetchMock = mockApi({
      'GET /api/v1/dashboard/insights?narrative=true': () => json({ generated_from: 'db', items, narrative: { text: null, reason: 'No LLM provider is configured: set GROQ_API_KEY' } }),
      'GET /api/v1/dashboard/insights': () => json({ generated_from: 'database (deterministic rules)', items, narrative: null }),
    })
    const user = userEvent.setup()
    renderWithProviders(<InsightsPanel />)
    expect(await screen.findByText('30 POs overdue')).toBeInTheDocument()
    expect(screen.getByText('high')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View details' })).toHaveAttribute('href', '/purchase-orders')
    expect(screen.getAllByRole('link')).toHaveLength(1)
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('narrative=true'))).toBe(false)
    await user.click(screen.getByRole('button', { name: /Generate narrative summary/ }))
    expect(await screen.findByTestId('narrative-reason')).toHaveTextContent('No LLM provider is configured')
    expect(screen.queryByTestId('narrative-text')).not.toBeInTheDocument()
  })
  it('shows narrative.text when present', async () => {
    mockApi({
      'narrative=true': () => json({ generated_from: 'db', items, narrative: { text: 'Fix overdue POs first.', model: 'm', reason: null } }),
      'GET /api/v1/dashboard/insights': () => json({ generated_from: 'db', items, narrative: null }),
    })
    const user = userEvent.setup()
    renderWithProviders(<InsightsPanel />)
    await user.click(await screen.findByRole('button', { name: /Generate narrative summary/ }))
    expect(await screen.findByTestId('narrative-text')).toHaveTextContent('Fix overdue POs first.')
  })
})

describe('Admin PATCH flows (mocked)', () => {
  it('disabling a tool needs confirmation and sends is_enabled false; enabling does not', async () => {
    setToken('t')
    const tool = { name: 'create_purchase_request', description: 'SENSITIVE (needs human approval)', required_permission: 'request:write', is_sensitive: true, is_enabled: true }
    const fetchMock = mockApi({
      '/auth/me': () => json(me(['admin:manage'])),
      '/admin/agent': () => json({ name: 'procurement_agent', max_iterations: 10, timeout_seconds: 120 }),
      'GET /api/v1/admin/tools': () => json([tool]),
      'PATCH /api/v1/admin/tools/create_purchase_request': () => json({ name: tool.name, is_enabled: false }),
    })
    const patches = () => fetchMock.mock.calls.filter((c) => c[1]?.method === 'PATCH')
    const user = userEvent.setup()
    renderWithProviders(<AdminPage />)
    await user.click(await screen.findByRole('tab', { name: 'Agent & Tools' }))
    expect(await screen.findByText('Sensitive')).toBeInTheDocument()
    expect(screen.getByText(/refused at runtime/)).toBeInTheDocument()
    await user.click(await screen.findByRole('switch', { name: /create_purchase_request enabled/ }))
    expect(patches()).toHaveLength(0)
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Disable tool' }))
    await waitFor(() => expect(patches()).toHaveLength(1))
    expect(JSON.parse(String(patches()[0][1]?.body))).toEqual({ is_enabled: false })
  })
  it('shows the API 422 message inline for a policy value', async () => {
    setToken('t')
    mockApi({
      '/auth/me': () => json(me(['admin:manage'])),
      '/admin/providers': () => json([]),
      'GET /api/v1/admin/policy': () => json([{ key: 'approval_threshold', value: '5000' }]),
      'PATCH /api/v1/admin/policy/approval_threshold': () => json({ error: { code: 'invalid_value', message: "'approval_threshold' must be numeric" } }, 422),
    })
    const user = userEvent.setup()
    renderWithProviders(<AdminPage />)
    await user.click(await screen.findByRole('tab', { name: 'Policy values' }))
    const input = await screen.findByLabelText(/Approval Threshold/)
    await user.clear(input); await user.type(input, 'abc')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect((await screen.findAllByText("'approval_threshold' must be numeric")).length).toBeGreaterThan(0)
  })
  it('validates agent limit ranges client-side', async () => {
    setToken('t')
    mockApi({
      '/auth/me': () => json(me(['admin:manage'])),
      '/admin/providers': () => json([]),
      'GET /api/v1/admin/agent': () => json({ name: 'procurement_agent', max_iterations: 10, timeout_seconds: 120 }),
      'GET /api/v1/admin/tools': () => json([]),
    })
    const user = userEvent.setup()
    renderWithProviders(<AdminPage />)
    await user.click(await screen.findByRole('tab', { name: 'Agent & Tools' }))
    const it = await screen.findByLabelText(/Max iterations/)
    await user.clear(it); await user.type(it, '31')
    expect(screen.getByText('Enter a whole number from 1 to 30')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save limits' })).toBeDisabled()
  })
})
