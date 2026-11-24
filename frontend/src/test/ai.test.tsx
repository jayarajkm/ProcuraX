import '@testing-library/jest-dom/vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ApprovalActions } from '@/components/ApprovalActions'
import { RichText } from '@/components/chat/RichText'
import { ResponseDetails } from '@/components/chat/ResponseDetails'
import { ModelCard } from '@/components/ml/MLMetrics'
import { setToken } from '@/lib/api'
import type { MLModel } from '@/lib/types'
import { UploadDocumentDialog } from '@/pages/DocumentsPage'
import { validateUpload } from '@/pages/documentRules'
import { renderWithProviders } from './utils'

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
beforeAll(() => { vi.stubGlobal('ResizeObserver', ResizeObserverStub) })
afterEach(() => { setToken(null); localStorage.clear() })

describe('ResponseDetails (metadata renderer)', () => {
  it('shows confidence with its kind only when present', async () => {
    const { rerender } = renderWithProviders(<ResponseDetails defaultOpen metadata={{ approach: 'Rule engine', confidence: 0.4, confidence_kind: 'model class probability', action_executed: false }} />)
    expect(screen.getByText('Confidence')).toBeInTheDocument()
    expect(screen.getByText(/40\.0%/)).toBeInTheDocument()
    expect(screen.getByText(/model class probability/)).toBeInTheDocument()
    rerender(<ResponseDetails defaultOpen metadata={{ approach: 'Rule engine', action_executed: false }} />)
    expect(screen.getByText('Approach')).toBeInTheDocument()
    expect(screen.queryByText('Confidence')).not.toBeInTheDocument()
    expect(screen.queryByText(/%/)).not.toBeInTheDocument()
  })

  it('renders citations as a source list with title, page, similarity and excerpt', () => {
    renderWithProviders(<ResponseDetails defaultOpen metadata={{
      approach: 'RAG', retrieval: [{ ref: 1, document: 'Purchase Approval Policy', page: 3, similarity: 0.518, excerpt: 'Purchases above $5,000 require approval' }],
    }} />)
    expect(screen.getByText(/Purchase Approval Policy/)).toBeInTheDocument()
    expect(screen.getByText(/page 3/)).toBeInTheDocument()
    expect(screen.getByText('0.518')).toBeInTheDocument()
    expect(screen.getByText(/above \$5,000 require approval/)).toBeInTheDocument()
  })

  it('shows the action_executed badge, and a table when given', async () => {
    renderWithProviders(<ResponseDetails metadata={{ approach: 'x', action_executed: true, table: { columns: ['PO', 'Status'], rows: [['PO-1', 'sent']] } }} />)
    expect(screen.getByText('Action executed')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /response details/i }))
    expect(screen.getByText('PO-1')).toBeInTheDocument()
  })

  it('omits the badge when no action ran and renders nothing for empty metadata', () => {
    const { container } = renderWithProviders(<ResponseDetails metadata={{ action_executed: false }} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders ML probabilities from metadata.extra', () => {
    renderWithProviders(<ResponseDetails defaultOpen metadata={{ extra: { probabilities: { delivery_issue: 0.39, invoice_issue: 0.08 }, model: 'message_classifier:v1' } }} />)
    expect(screen.getByText('delivery issue')).toBeInTheDocument()
    expect(screen.getByText('39%')).toBeInTheDocument()
  })
})

describe('RichText', () => {
  it('renders bold and newlines without injecting HTML', () => {
    const { container } = renderWithProviders(<RichText text={'Hello **world**\n<img src=x onerror=alert(1)>'} />)
    expect(container.querySelector('strong')?.textContent).toBe('world')
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('br')).not.toBeNull()
    expect(container.textContent).toContain('<img src=x')
  })
})

function mockMe(permissions: string[]) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id: '1', email: 'a@b.c', full_name: 'T', roles: [], permissions }), { status: 200 })))
}

describe('ApprovalActions permission gating', () => {
  it('shows Approve/Reject with agent:approve', async () => {
    setToken('t'); mockMe(['agent:run', 'agent:approve'])
    renderWithProviders(<ApprovalActions approvalId="a1" />)
    expect(await screen.findByRole('button', { name: /approve/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /reject/i })).toBeInTheDocument()
  })
  it('shows the awaiting message and no buttons without agent:approve', async () => {
    setToken('t'); mockMe(['agent:run'])
    renderWithProviders(<ApprovalActions approvalId="a1" />)
    expect(await screen.findByText(/Awaiting approval by a Procurement Manager\/Administrator/)).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /reject/i })).not.toBeInTheDocument()
  })
})

describe('document upload pre-validation', () => {
  it('validateUpload checks type, emptiness and size', () => {
    expect(validateUpload(null)).toMatch(/choose a file/i)
    expect(validateUpload({ name: 'a.exe', size: 10 })).toMatch(/unsupported/i)
    expect(validateUpload({ name: 'noext', size: 10 })).toMatch(/unsupported/i)
    expect(validateUpload({ name: 'a.pdf', size: 0 })).toMatch(/empty/i)
    expect(validateUpload({ name: 'a.PDF', size: 21 * 1024 * 1024 })).toMatch(/limit/i)
    expect(validateUpload({ name: 'a.docx', size: 1024 })).toBeNull()
  })

  it('dialog blocks an unsupported file and never calls the API', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup({ applyAccept: false })
    renderWithProviders(<UploadDocumentDialog open onOpenChange={() => {}} />)
    await user.upload(screen.getByLabelText('File'), new File(['x'], 'malware.exe'))
    expect(await screen.findByText(/Unsupported file type/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Upload' })).toBeDisabled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('shows the server message inline on 422', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'invalid_document', message: 'PDF has no extractable text' } }), { status: 422 })))
    const user = userEvent.setup()
    renderWithProviders(<UploadDocumentDialog open onOpenChange={() => {}} />)
    await user.upload(screen.getByLabelText('File'), new File(['hello'], 'ok.txt', { type: 'text/plain' }))
    await user.click(screen.getByRole('button', { name: 'Upload' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('PDF has no extractable text')
  })
})

describe('ML caveats', () => {
  const base: MLModel = { id: '1', name: 'stockout_risk', version: 'v1', algorithm: 'GBC', training_rows: 3000, trained_at: '2026-11-23T16:39:28Z', is_active: true, metrics: null }
  it('renders caveats and training stock source when present', () => {
    renderWithProviders(<ModelCard model={{ ...base, metrics: { caveats: ['Trained on SYNTHETIC data'], training_stock_source: 'SIMULATED (historical stock levels are not stored)', precision: 0.9, recall: 0.8, f1: 0.85, roc_auc: 0.96 } }} />)
    expect(screen.getByTestId('ml-caveats')).toHaveTextContent('Trained on SYNTHETIC data')
    expect(screen.getByTestId('ml-caveats')).toHaveTextContent('SIMULATED (historical stock levels are not stored)')
  })
  it('still renders a caveats block when metrics are missing', () => {
    renderWithProviders(<ModelCard model={base} />)
    expect(screen.getByTestId('ml-caveats')).toHaveTextContent(/synthetic/i)
  })
  it('renders the confusion matrix and flags a baseline that beats the model', () => {
    renderWithProviders(<ModelCard model={{ ...base, metrics: { caveats: ['c'], f1: 0.84, precision: 0.9, recall: 0.79, roc_auc: 0.96, accuracy: 0.9, confusion_matrix: [[1291, 55], [134, 520]], baseline_naive_cover_rule: { f1: 0.85, precision: 0.84, recall: 0.86, accuracy: 0.9 }, feature_importance: { cover_ratio: 0.8 } } }} />)
    expect(screen.getByLabelText('Confusion matrix')).toBeInTheDocument()
    expect(screen.getByText('1291')).toBeInTheDocument()
    expect(screen.getByText(/higher F1 than the model/)).toBeInTheDocument()
  })
})
