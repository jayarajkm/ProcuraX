import '@testing-library/jest-dom/vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ResponseDetails } from '@/components/chat/ResponseDetails'
import { TranslationNotice } from '@/components/chat/TranslationInfo'
import { LanguageSelect } from '@/components/LanguageSelect'
import { setToken } from '@/lib/api'
import type { ChatMetadata } from '@/lib/types'
import { AgentPage } from '@/pages/AgentPage'
import { ChatPlaygroundPage } from '@/pages/ChatPlaygroundPage'
import { ComparePage } from '@/pages/ComparePage'
import { renderWithProviders } from './utils'

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
beforeAll(() => { vi.stubGlobal('ResizeObserver', ResizeObserverStub) })
afterEach(() => { setToken(null); localStorage.clear(); vi.unstubAllGlobals(); vi.stubGlobal('ResizeObserver', ResizeObserverStub) })

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const LANGS = [
  { code: 'en', name: 'English', native_name: 'English', rtl: false },
  { code: 'es', name: 'Spanish', native_name: 'Español', rtl: false },
  { code: 'ar', name: 'Arabic', native_name: 'العربية', rtl: true },
]
const me = { id: '1', email: 'a@b.c', full_name: 'T', roles: [], permissions: ['chat:use', 'agent:run'] }
function mockApi(routes: Record<string, (init?: RequestInit) => Response | Promise<Response>>) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${url}`
    const hit = Object.keys(routes).find((k) => key.includes(k))
    return hit ? routes[hit](init) : json({ error: { code: 'not_found', message: `unmocked ${key}` } }, 404)
  })
  vi.stubGlobal('fetch', fn)
  return fn
}
const bodyOf = (fn: ReturnType<typeof vi.fn>, needle: string) =>
  fn.mock.calls.filter((c) => String(c[0]).includes(needle) && (c[1] as RequestInit | undefined)?.method === 'POST').map((c) => JSON.parse(String((c[1] as RequestInit).body)))

describe('LanguageSelect', () => {
  it('lists languages as "native (English)" and persists the choice', async () => {
    mockApi({ '/languages': () => json(LANGS) })
    renderWithProviders(<LanguageSelect />)
    await screen.findByRole('option', { name: 'Español (Spanish)' })
    expect(screen.getByRole('option', { name: 'English' })).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText('Response language'), 'es')
    expect(localStorage.getItem('procurax.language')).toBe('es')
    expect(screen.getByLabelText('Response language')).toHaveValue('es')
  })
  it('falls back to en when the stored code is unknown', async () => {
    localStorage.setItem('procurax.language', 'xx')
    mockApi({ '/languages': () => json(LANGS) })
    renderWithProviders(<LanguageSelect />)
    await screen.findByRole('option', { name: 'Español (Spanish)' })
    expect(screen.getByLabelText('Response language')).toHaveValue('en')
  })
  it('restores a valid stored code', async () => {
    localStorage.setItem('procurax.language', 'es')
    mockApi({ '/languages': () => json(LANGS) })
    renderWithProviders(<LanguageSelect />)
    await waitFor(() => expect(screen.getByLabelText('Response language')).toHaveValue('es'))
  })
})

const detTrans: ChatMetadata = {
  language: 'es', approach: 'Rule engine',
  translation: { mode: 'deterministic_bot_with_llm_translation', input_translated_to_english: 'Which POs are open?', original_reply: 'You have 3 open POs.', not_translated: ['table', 'steps'], note: 'extra note' },
}
describe('translation disclosure', () => {
  it('deterministic mode: badge, details and expandable original reply', async () => {
    mockApi({ '/languages': () => json(LANGS) })
    renderWithProviders(<><TranslationNotice language="es" translation={detTrans.translation} /><ResponseDetails metadata={detTrans} defaultOpen /></>)
    expect(screen.getByText('Translated by LLM')).toBeInTheDocument()
    expect(screen.getByText('Language & translation')).toBeInTheDocument()
    expect(screen.getByText(/The deterministic bot answered in English/)).toBeInTheDocument()
    expect(screen.getByText(/Which POs are open\?/)).toBeInTheDocument()
    expect(screen.getByText(/Stays in English: table, steps/)).toBeInTheDocument()
    expect(screen.getByText('extra note')).toBeInTheDocument()
    expect(screen.queryByTestId('original-reply')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /show original english reply/i }))
    expect(screen.getByTestId('original-reply')).toHaveTextContent('You have 3 open POs.')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
  it('llm_native mode: "Answered in <language>"', async () => {
    mockApi({ '/languages': () => json(LANGS) })
    renderWithProviders(<TranslationNotice language="es" translation={{ mode: 'llm_native' }} />)
    expect(await screen.findByText('Answered in Spanish')).toBeInTheDocument()
    expect(screen.queryByText('Translated by LLM')).not.toBeInTheDocument()
  })
  it('shows the amber warning on translation errors', () => {
    mockApi({ '/languages': () => json(LANGS) })
    const md: ChatMetadata = { language: 'es', approach: 'x', translation: { mode: 'deterministic_bot_with_llm_translation', output_translation_error: 'No LLM provider configured' } }
    renderWithProviders(<><TranslationNotice language="es" translation={md.translation} /><ResponseDetails metadata={md} defaultOpen /></>)
    expect(screen.getAllByText(/Translation unavailable — showing English/).length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText(/No LLM provider configured/)).toBeInTheDocument()
    expect(screen.getAllByRole('alert')[0].className).toMatch(/amber/)
  })
  it('renders nothing for English messages', () => {
    mockApi({ '/languages': () => json(LANGS) })
    const { container } = renderWithProviders(<><TranslationNotice language="en" translation={undefined} /><ResponseDetails metadata={{ language: 'en', translation: { mode: 'llm_native' } }} /></>)
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByText(/Language & translation/)).not.toBeInTheDocument()
  })
})

const bot = (slug: string, requires_llm: boolean) => ({ slug, name: slug, description: 'd', technology: 't', use_cases: [], example_prompts: [], requires_llm, available: true, configured: true })

describe('Playground', () => {
  const setup = (slug: string, reply: object) => {
    setToken('t')
    return mockApi({
      '/auth/me': () => json(me), '/languages': () => json(LANGS),
      [`/chatbots/${slug}/sessions`]: () => json([]),
      [`POST /api/v1/chatbots/${slug}/chat`]: () => json(reply),
      [`/chatbots/${slug}`]: () => json(bot(slug, slug !== 'rule_based')),
    })
  }
  const page = (slug: string) => renderWithProviders(<Routes><Route path="/chatbots/:slug" element={<ChatPlaygroundPage />} /></Routes>, { route: `/chatbots/${slug}` })

  it('sends language with every request and shows the deterministic hint, badge and RTL', async () => {
    localStorage.setItem('procurax.language', 'ar')
    const fn = setup('rule_based', { session_id: 's1', message_id: 'm1', reply: 'مرحبا', metadata: { language: 'ar', approach: 'Rule', translation: { mode: 'deterministic_bot_with_llm_translation', original_reply: 'Hello' } } })
    page('rule_based')
    await waitFor(() => expect(screen.getByLabelText('Response language')).toHaveValue('ar'))
    expect(screen.getByTestId('language-hint')).toHaveTextContent('Answers are produced in English by the deterministic bot and translated by the LLM (requires a configured LLM provider)')
    const input = screen.getByLabelText('Message')
    expect(input).toHaveAttribute('dir', 'rtl')
    await userEvent.type(input, 'hola')
    await userEvent.click(screen.getByRole('button', { name: /send/i }))
    expect(await screen.findByText('مرحبا')).toBeInTheDocument()
    expect(bodyOf(fn, '/chat')).toEqual([{ message: 'hola', language: 'ar' }])
    expect(screen.getByText('مرحبا').closest('[dir="rtl"]')).not.toBeNull()
    expect(screen.getByText('Translated by LLM')).toBeInTheDocument()
  })

  it('English: no hint, no rtl, language "en" sent, no badge', async () => {
    const fn = setup('rule_based', { session_id: 's1', message_id: 'm1', reply: 'Hi', metadata: { language: 'en', approach: 'Rule' } })
    page('rule_based')
    await waitFor(() => expect(screen.getByLabelText('Response language')).not.toBeDisabled())
    expect(screen.queryByTestId('language-hint')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Message')).not.toHaveAttribute('dir')
    await userEvent.type(screen.getByLabelText('Message'), 'hello')
    await userEvent.click(screen.getByRole('button', { name: /send/i }))
    await screen.findByText('Hi')
    expect(bodyOf(fn, '/chat')[0].language).toBe('en')
    expect(screen.queryByTestId('translation-notice')).not.toBeInTheDocument()
  })

  it('LLM bot hint names the language', async () => {
    localStorage.setItem('procurax.language', 'es')
    setup('generative', {})
    page('generative')
    expect(await screen.findByText('The LLM answers in Spanish')).toBeInTheDocument()
  })
})

describe('Compare', () => {
  it('changing language sends nothing; all six requests carry it', async () => {
    setToken('t')
    const fn = mockApi({
      '/auth/me': () => json(me), '/languages': () => json(LANGS),
      '/compare/': () => json({ slug: 'x', status: 'ok', duration_ms: 5, reply: 'ok', action_executed: false, language: 'es', translation: { mode: 'llm_native' } }),
    })
    renderWithProviders(<ComparePage />)
    await screen.findByRole('option', { name: 'Español (Spanish)' })
    await userEvent.selectOptions(screen.getByLabelText(/Response language/), 'es')
    expect(bodyOf(fn, '/compare/')).toHaveLength(0)
    await userEvent.type(screen.getByLabelText('Your question'), 'hello')
    await userEvent.click(screen.getByRole('button', { name: /Compare 6 bots/ }))
    await waitFor(() => expect(bodyOf(fn, '/compare/')).toHaveLength(6))
    expect(bodyOf(fn, '/compare/').every((b) => b.language === 'es' && b.message === 'hello')).toBe(true)
    expect((await screen.findAllByText('Answered in Spanish')).length).toBe(6)
  })
})

describe('Agent form', () => {
  it('sends language and shows the English-audit note', async () => {
    setToken('t')
    localStorage.setItem('procurax.language', 'es')
    const exec = { id: 'e1', language: 'es', user_request: 'r', status: 'completed', plan: [], final_result: 'hecho', error: null, created_at: '2026-01-01T00:00:00Z', finished_at: null, steps: [], approvals: [], logs: [] }
    const fn = mockApi({
      '/auth/me': () => json(me), '/languages': () => json(LANGS),
      'POST /api/v1/agent/executions': () => json(exec),
      '/agent/executions/e1': () => json(exec),
      '/agent/executions': () => json([]),
      '/agent/tools': () => json([]),
    })
    renderWithProviders(<AgentPage />)
    expect(await screen.findByTestId('agent-language-note')).toHaveTextContent('Plan, tool calls and audit logs stay in English; only the final answer is written in the selected language.')
    await waitFor(() => expect(screen.getByLabelText('Final answer language')).toHaveValue('es'))
    await userEvent.type(screen.getByLabelText('Agent request'), 'find stockouts')
    await userEvent.click(screen.getByRole('button', { name: /run agent/i }))
    await waitFor(() => expect(bodyOf(fn, '/agent/executions')).toEqual([{ request: 'find stockouts', language: 'es' }]))
    expect(await screen.findByTestId('execution-language')).toHaveTextContent('Language: Spanish')
  })
})
