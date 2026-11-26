import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api, errorMessage, LLM_TIMEOUT_MS } from '@/lib/api'
import type {
  AdminAgent, AdminIntent, AdminPolicy, AdminPrompt, AdminProvider, AdminRule, AdminTool, AIAnalytics, AuditEntry, CompareResult, Insights,
  AgentExecution, AgentExecutionSummary, AgentTool, ChatMessage, ChatReply, ChatSession, ChatbotType, ClassifyResult, DocChunk, DocumentRow,
  Language, MLModel, PendingApproval, SearchResponse, StockoutScan,
  Approval, Category, InventoryRow, ListParams, Movement, Overview, Page, PO, PODetail, POCreate, Product, ProductInput,
  ProductUpdate, PurchaseRequest, Recommendation, RequestCreate, Supplier, SupplierInput, SupplierPerformance,
  SupplierProduct, SupplierUpdate, Warehouse, Customer, OwnershipSummary, Quote, SalesBreaks, Shortage, ShortagePOResult, Tier,
} from '@/lib/types'

export const qk = {
  overview: ['overview'] as const,
  categories: ['categories'] as const,
  products: (p?: ListParams) => ['products', p ?? {}] as const,
  product: (id: string) => ['product', id] as const,
  suppliers: (p?: ListParams) => ['suppliers', p ?? {}] as const,
  supplier: (id: string) => ['supplier', id] as const,
  warehouses: ['warehouses'] as const,
  inventory: (p?: ListParams) => ['inventory', p ?? {}] as const,
  reorder: (w?: string) => ['reorder', w ?? ''] as const,
  pos: (p?: ListParams) => ['purchase-orders', p ?? {}] as const,
  po: (id: string) => ['purchase-order', id] as const,
  requests: (p?: ListParams) => ['purchase-requests', p ?? {}] as const,
  request: (id: string) => ['purchase-request', id] as const,
}

const list = <T,>(path: string, params?: ListParams) => api.get<Page<T>>(path, params)

// ---- queries ----
export const useOverview = () => useQuery({ queryKey: qk.overview, queryFn: () => api.get<Overview>('/dashboard/overview') })
export const useCategories = () => useQuery({ queryKey: qk.categories, queryFn: () => api.get<Category[]>('/categories'), staleTime: 60_000 })
export const useProducts = (p: ListParams) =>
  useQuery({ queryKey: qk.products(p), queryFn: () => list<Product>('/products', p), placeholderData: keepPreviousData })
export const useSuppliers = (p: ListParams) =>
  useQuery({ queryKey: qk.suppliers(p), queryFn: () => list<Supplier>('/suppliers', p), placeholderData: keepPreviousData })
export const useWarehouses = () => useQuery({ queryKey: qk.warehouses, queryFn: () => api.get<Warehouse[]>('/warehouses'), staleTime: 60_000 })
export const useSupplierProducts = (id?: string) =>
  useQuery({ queryKey: ['supplier-products', id], queryFn: () => api.get<SupplierProduct[]>(`/suppliers/${id}/products`), enabled: !!id })
export const useSupplierPerformance = (id?: string) =>
  useQuery({ queryKey: ['supplier-performance', id], queryFn: () => api.get<SupplierPerformance>(`/suppliers/${id}/performance`), enabled: !!id })
export const useSupplierPOs = (id?: string) =>
  useQuery({ queryKey: ['supplier-pos', id], queryFn: () => api.get<PO[]>(`/suppliers/${id}/purchase-orders`), enabled: !!id })
export const useInventory = (p: ListParams) =>
  useQuery({ queryKey: qk.inventory(p), queryFn: () => list<InventoryRow>('/inventory', p), placeholderData: keepPreviousData })
export const useMovements = (id?: string) =>
  useQuery({ queryKey: ['movements', id], queryFn: () => api.get<Movement[]>(`/inventory/${id}/movements`), enabled: !!id })
export const useReorder = (warehouseId?: string) =>
  useQuery({ queryKey: qk.reorder(warehouseId), queryFn: () => api.get<Recommendation[]>('/inventory/reorder-recommendations', { warehouse_id: warehouseId }) })
export const usePOs = (p: ListParams) =>
  useQuery({ queryKey: qk.pos(p), queryFn: () => list<PO>('/purchase-orders', p), placeholderData: keepPreviousData })
export const usePO = (id?: string) => useQuery({ queryKey: qk.po(id ?? ''), queryFn: () => api.get<PODetail>(`/purchase-orders/${id}`), enabled: !!id })
export const useRequests = (p: ListParams) =>
  useQuery({ queryKey: qk.requests(p), queryFn: () => list<PurchaseRequest>('/purchase-requests', p), placeholderData: keepPreviousData })
export const useRequest = (id?: string) =>
  useQuery({ queryKey: qk.request(id ?? ''), queryFn: () => api.get<PurchaseRequest>(`/purchase-requests/${id}`), enabled: !!id })
export const useApprovals = (id?: string) =>
  useQuery({ queryKey: ['approvals', id], queryFn: () => api.get<Approval[]>(`/purchase-requests/${id}/approvals`), enabled: !!id })

/** Id -> entity lookups used to show names where the API returns only ids (PO lines, request lines). */
export function useProductLookup() {
  const q = useQuery({ queryKey: ['lookup-products'], queryFn: () => list<Product>('/products', { page_size: 200 }), staleTime: 60_000 })
  const map = new Map((q.data?.items ?? []).map((p) => [p.id, p]))
  return { map, name: (id: string) => map.get(id)?.name ?? `Product ${id.slice(0, 8)}`, sku: (id: string) => map.get(id)?.sku ?? '' }
}
export function useSupplierLookup() {
  const q = useQuery({ queryKey: ['lookup-suppliers'], queryFn: () => list<Supplier>('/suppliers', { page_size: 200 }), staleTime: 60_000 })
  const map = new Map((q.data?.items ?? []).map((s) => [s.id, s]))
  return { list: q.data?.items ?? [], isLoading: q.isLoading, name: (id?: string | null) => (id ? map.get(id)?.name ?? `Supplier ${id.slice(0, 8)}` : '—') }
}
export function useWarehouseLookup() {
  const q = useWarehouses()
  const map = new Map((q.data ?? []).map((w) => [w.id, w]))
  return { list: q.data ?? [], name: (id: string) => map.get(id)?.name ?? id.slice(0, 8) }
}

// ---- mutations ----
function useApiMutation<TVars, TData>(fn: (v: TVars) => Promise<TData>, invalidate: QueryKey[], success?: string | ((d: TData) => string)) {
  const qc = useQueryClient()
  return useMutation<TData, Error, TVars>({
    mutationFn: fn,
    onSuccess: (d) => {
      invalidate.forEach((k) => void qc.invalidateQueries({ queryKey: k }))
      if (success) toast.success(typeof success === 'function' ? success(d) : success)
    },
    onError: (e) => { toast.error(errorMessage(e)) },
  })
}

const dash = ['overview']
export const useCreateCategory = () =>
  useApiMutation((b: { name: string; description: string }) => api.post<Category>('/categories', b), [['categories']], 'Category created')
export const useCreateProduct = () =>
  useApiMutation((b: ProductInput) => api.post<Product>('/products', b), [['products'], ['lookup-products'], dash], 'Product created')
export const useUpdateProduct = () =>
  useApiMutation((v: { id: string; body: ProductUpdate }) => api.patch<Product>(`/products/${v.id}`, v.body), [['products'], ['lookup-products'], ['inventory']], 'Product updated')
export const useDeleteProduct = () =>
  useApiMutation((id: string) => api.del(`/products/${id}`), [['products'], ['lookup-products'], dash], 'Product deleted')
export const useCreateSupplier = () =>
  useApiMutation((b: SupplierInput) => api.post<Supplier>('/suppliers', b), [['suppliers'], ['lookup-suppliers'], dash], 'Supplier created')
export const useUpdateSupplier = () =>
  useApiMutation((v: { id: string; body: SupplierUpdate }) => api.patch<Supplier>(`/suppliers/${v.id}`, v.body), [['suppliers'], ['lookup-suppliers'], dash], 'Supplier updated')
export const useAdjustInventory = () =>
  useApiMutation((v: { id: string; quantity: number; reason: string }) => api.post<InventoryRow>(`/inventory/${v.id}/adjust`, { quantity: v.quantity, reason: v.reason }),
    [['inventory'], ['movements'], ['reorder'], dash], 'Inventory adjusted')
export const useCreatePO = () =>
  useApiMutation((b: POCreate) => api.post<PODetail>('/purchase-orders', b), [['purchase-orders'], ['supplier-pos'], dash], (d) => `Purchase order ${d.po_number} created`)
export const useChangePOStatus = () =>
  useApiMutation((v: { id: string; to_status: string; note?: string }) => api.post<PODetail>(`/purchase-orders/${v.id}/status`, { to_status: v.to_status, note: v.note ?? '' }),
    [['purchase-orders'], ['purchase-order'], ['supplier-pos'], ['inventory'], dash], 'Status updated')
export const useCreateRequest = (silent = false) =>
  useApiMutation((b: RequestCreate) => api.post<PurchaseRequest>('/purchase-requests', b), [['purchase-requests'], dash], silent ? undefined : (d) => `Request ${d.request_number} created`)
const reqKeys = [['purchase-requests'], ['purchase-request'], ['approvals'], dash]
export const useSubmitRequest = () =>
  useApiMutation((id: string) => api.post<PurchaseRequest>(`/purchase-requests/${id}/submit`), reqKeys, 'Request submitted for approval')
export const useDecideRequest = () =>
  useApiMutation((v: { id: string; action: 'approve' | 'reject'; comment: string }) => api.post<PurchaseRequest>(`/purchase-requests/${v.id}/${v.action}`, { comment: v.comment }),
    reqKeys, 'Decision recorded')
export const useConvertRequest = () =>
  useApiMutation((id: string) => api.post<PODetail>(`/purchase-requests/${id}/convert`), [...reqKeys, ['purchase-orders']], (d) => `Converted to ${d.po_number}`)


// ===================== AI: chatbots =====================
export const useLanguages = () =>
  useQuery({ queryKey: ['languages'], queryFn: () => api.get<Language[]>('/languages'), staleTime: 60 * 60_000 })
export const useChatbots = () => useQuery({ queryKey: ['chatbots'], queryFn: () => api.get<ChatbotType[]>('/chatbots') })
export const useChatbot = (slug?: string) =>
  useQuery({ queryKey: ['chatbot', slug], queryFn: () => api.get<ChatbotType>(`/chatbots/${slug}`), enabled: !!slug })
export const useChatSessions = (slug?: string) =>
  useQuery({ queryKey: ['chat-sessions', slug], queryFn: () => api.get<ChatSession[]>(`/chatbots/${slug}/sessions`), enabled: !!slug })
export const fetchChatMessages = (sid: string) => api.get<ChatMessage[]>(`/chat-sessions/${sid}/messages`)
/** No success toast; the thread itself is the feedback. Errors are shown inline by the caller. */
export function useSendChat(slug: string) {
  const qc = useQueryClient()
  return useMutation<ChatReply, Error, { message: string; session_id?: string | null; language?: string }>({
    mutationFn: (v) => api.post<ChatReply>(`/chatbots/${slug}/chat`, { message: v.message, ...(v.session_id ? { session_id: v.session_id } : {}), language: v.language ?? 'en' }, { timeoutMs: LLM_TIMEOUT_MS }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['chat-sessions', slug] }); void qc.invalidateQueries({ queryKey: ['agent-executions'] }) },
    onError: (e) => { toast.error(errorMessage(e)) },
  })
}

// ===================== documents =====================
export const docsKey = ['documents'] as const
export const useDocuments = (p: ListParams) =>
  useQuery({
    queryKey: ['documents', p], queryFn: () => list<DocumentRow>('/documents', p), placeholderData: keepPreviousData,
    // poll while the background worker may still be ingesting something
    refetchInterval: (q) => (q.state.data?.items.some((d) => d.status === 'uploaded' || d.status === 'processing') ? 3000 : false),
  })
export const useDocumentChunks = (id?: string) =>
  useQuery({ queryKey: ['document-chunks', id], queryFn: () => api.get<DocChunk[]>(`/documents/${id}/chunks`), enabled: !!id })
export const useUploadDocument = () =>
  useApiMutation((v: { file: File; title: string; category: string }) => {
    const f = new FormData()
    f.append('file', v.file)
    if (v.title.trim()) f.append('title', v.title.trim())
    f.append('category', v.category)
    return api.upload<DocumentRow>('/documents', f)
  }, [docsKey], 'Document uploaded: queued for the background worker')
export const useReprocessDocument = () =>
  useApiMutation((id: string) => api.post<DocumentRow>(`/documents/${id}/reprocess`), [docsKey, ['document-chunks']], 'Reprocessing queued')
export const useDeleteDocument = () =>
  useApiMutation((id: string) => api.del(`/documents/${id}`), [docsKey], 'Document deleted')
export const useDocSearch = (p: { q: string; top_k: number; min_similarity: number; category?: string }) =>
  useQuery({
    queryKey: ['doc-search', p], enabled: p.q.trim().length >= 2,
    queryFn: () => api.get<SearchResponse>('/documents/search', { ...p, q: p.q.trim() }),
  })

// ===================== agent =====================
export const agentKeys = [['agent-executions'], ['agent-execution'], ['agent-approvals']] as QueryKey[]
export const useAgentTools = () => useQuery({ queryKey: ['agent-tools'], queryFn: () => api.get<AgentTool[]>('/agent/tools'), staleTime: 60_000 })
export const useAgentExecutions = () =>
  useQuery({ queryKey: ['agent-executions'], queryFn: () => api.get<AgentExecutionSummary[]>('/agent/executions') })
export const useAgentExecution = (id?: string) =>
  useQuery({ queryKey: ['agent-execution', id], queryFn: () => api.get<AgentExecution>(`/agent/executions/${id}`), enabled: !!id,
    refetchInterval: (q) => (q.state.data?.status === 'running' ? 3000 : false) })
export const usePendingApprovals = (enabled: boolean) =>
  useQuery({ queryKey: ['agent-approvals'], queryFn: () => api.get<PendingApproval[]>('/agent/approvals'), enabled })
export function useRunAgent() {
  const qc = useQueryClient()
  return useMutation<AgentExecution, Error, { request: string; language?: string }>({
    mutationFn: (v) => api.post<AgentExecution>('/agent/executions', { request: v.request, language: v.language ?? 'en' }, { timeoutMs: LLM_TIMEOUT_MS }),
    onSuccess: () => { agentKeys.forEach((k) => void qc.invalidateQueries({ queryKey: k })) },
    onError: (e) => { toast.error(errorMessage(e)); void qc.invalidateQueries({ queryKey: ['agent-executions'] }) },
  })
}
export const useDecideApproval = () =>
  useApiMutation((v: { id: string; approve: boolean; comment: string }) =>
    api.post<AgentExecution>(`/agent/approvals/${v.id}/decision`, { approve: v.approve, comment: v.comment }),
    [...agentKeys, ['purchase-requests'], ['overview']], (d) => `Decision recorded (execution ${d.status.replace(/_/g, ' ')})`)

// ===================== ML =====================
export const useMLModels = () => useQuery({ queryKey: ['ml-models'], queryFn: () => api.get<MLModel[]>('/ml/models') })
export const useStockoutRisk = (limit: number, threshold: number) =>
  useQuery({ queryKey: ['ml-stockout', limit, threshold], queryFn: () => api.get<StockoutScan>('/ml/stockout-risk', { limit, threshold }), retry: false })
export const useClassify = () =>
  useMutation<ClassifyResult, Error, string>({
    mutationFn: (text) => api.post<ClassifyResult>('/ml/classify', { text }),
    onError: (e) => { toast.error(errorMessage(e)) },
  })
export const useTrainModels = () =>
  useApiMutation((_: void) => api.post<MLModel[]>('/ml/train', undefined, { timeoutMs: LLM_TIMEOUT_MS }), [['ml-models'], ['ml-stockout']], (d) => `Trained ${d.length} new model version(s)`)


// ===================== comparison =====================
/** One stateless bot run for the comparison page. Never throws: transport failures become an `error` result so one card cannot break the others. */
export async function compareBot(slug: string, message: string, language = 'en'): Promise<CompareResult> {
  const t = performance.now()
  try {
    return await api.post<CompareResult>(`/compare/${slug}`, { message, language }, { timeoutMs: LLM_TIMEOUT_MS })
  } catch (e) {
    return { slug, status: 'error', message: errorMessage(e), duration_ms: Math.round(performance.now() - t) }
  }
}

// ===================== insights =====================
export const useInsights = () => useQuery({ queryKey: ['insights'], queryFn: () => api.get<Insights>('/dashboard/insights') })
/** The narrative is LLM-written, so it is only ever fetched on an explicit click (a mutation, not a query). */
export const useInsightsNarrative = () =>
  useMutation<Insights, Error, void>({
    mutationFn: () => api.get<Insights>('/dashboard/insights', { narrative: true }, { timeoutMs: LLM_TIMEOUT_MS }),
    onError: (e) => { toast.error(errorMessage(e)) },
  })

// ===================== AI analytics =====================
export const useAIAnalytics = (days: number) =>
  useQuery({ queryKey: ['ai-analytics', days], queryFn: () => api.get<AIAnalytics>('/analytics/ai', { days }) })

// ===================== AI administration =====================
export const useAdminProviders = () => useQuery({ queryKey: ['admin-providers'], queryFn: () => api.get<AdminProvider[]>('/admin/providers') })
export const useAdminPolicy = () => useQuery({ queryKey: ['admin-policy'], queryFn: () => api.get<AdminPolicy[]>('/admin/policy') })
export const useAdminRules = () => useQuery({ queryKey: ['admin-rules'], queryFn: () => api.get<AdminRule[]>('/admin/rules') })
export const useAdminIntents = () => useQuery({ queryKey: ['admin-intents'], queryFn: () => api.get<AdminIntent[]>('/admin/intents') })
export const useAdminPrompts = () => useQuery({ queryKey: ['admin-prompts'], queryFn: () => api.get<AdminPrompt[]>('/admin/prompts') })
export const useAdminAgent = () => useQuery({ queryKey: ['admin-agent'], queryFn: () => api.get<AdminAgent>('/admin/agent') })
export const useAdminTools = () => useQuery({ queryKey: ['admin-tools'], queryFn: () => api.get<AdminTool[]>('/admin/tools') })
export const useAdminAudit = (p: { action?: string; page: number; page_size: number }) =>
  useQuery({ queryKey: ['admin-audit', p], queryFn: () => api.get<Page<AuditEntry>>('/admin/audit', p), placeholderData: keepPreviousData })

const auditKey = ['admin-audit']
export const usePatchProvider = () =>
  useApiMutation((v: { provider: string; body: { model?: string; is_default?: boolean } }) => api.patch<unknown>(`/admin/providers/${v.provider}`, v.body),
    [['admin-providers'], ['chatbots'], auditKey], 'Provider updated')
export const usePatchPolicy = () =>
  useApiMutation((v: { key: string; value: string }) => api.patch<unknown>(`/admin/policy/${v.key}`, { value: v.value }), [['admin-policy'], auditKey], 'Policy value updated')
export const usePatchRule = () =>
  useApiMutation((v: { name: string; body: { patterns?: string[]; response_template?: string; is_active?: boolean } }) => api.patch<unknown>(`/admin/rules/${v.name}`, v.body),
    [['admin-rules'], auditKey], 'Rule updated')
export const usePatchPrompt = () =>
  useApiMutation((v: { name: string; template: string }) => api.patch<unknown>(`/admin/prompts/${v.name}`, { template: v.template }), [['admin-prompts'], auditKey], 'Prompt saved')
export const usePatchAgent = () =>
  useApiMutation((b: { max_iterations?: number; timeout_seconds?: number }) => api.patch<unknown>('/admin/agent', b), [['admin-agent'], auditKey], 'Agent limits updated')
export const usePatchTool = () =>
  useApiMutation((v: { name: string; is_enabled: boolean }) => api.patch<unknown>(`/admin/tools/${v.name}`, { is_enabled: v.is_enabled }),
    [['admin-tools'], ['agent-tools'], auditKey], (_d) => 'Tool updated')

// ---- distributor: ownership, price breaks, replenishment ----
export const useOwnershipSummary = () => useQuery({ queryKey: ['ownership-summary'], queryFn: () => api.get<OwnershipSummary>('/warehouses/ownership-summary') })
export const useCustomers = () => useQuery({ queryKey: ['customers'], queryFn: () => api.get<Customer[]>('/customers'), staleTime: 60_000 })
export const useShortages = (warehouseId: string | undefined, takePriceBreaks: boolean) =>
  useQuery({ queryKey: ['shortages', warehouseId ?? '', takePriceBreaks], queryFn: () => api.get<Shortage[]>('/replenishment/shortages', { warehouse_id: warehouseId, take_price_breaks: takePriceBreaks ? true : undefined }) })
export const useCreateShortagePOs = () =>
  useApiMutation((b: { warehouse_id: string; take_price_breaks: boolean }) => api.post<ShortagePOResult>('/replenishment/create-pos', b),
    [['shortages'], ['purchase-orders'], ['inventory'], ['reorder'], dash])
export const useQuote = (product: string, quantity: number, customer: string) =>
  useQuery({ queryKey: ['quote', product, quantity, customer], enabled: !!product && quantity >= 1,
    queryFn: () => api.get<Quote>('/pricing/quote', { product_id: product, quantity, customer_id: customer || undefined }) })
export const useSalesBreaks = (product: string, customer: string) =>
  useQuery({ queryKey: ['sales-breaks', product, customer], enabled: !!product,
    queryFn: () => api.get<SalesBreaks>(`/price-breaks/sales/${product}`, { customer_id: customer || undefined }) })
export const useSaveSalesBreaks = () =>
  useApiMutation((v: { product: string; customer: string; breaks: { min_qty: number; unit_price: number }[] }) =>
    api.put<{ breaks: Tier[] }>(`/price-breaks/sales/${v.product}${v.customer ? `?customer_id=${v.customer}` : ''}`, { breaks: v.breaks }),
    [['sales-breaks'], ['quote']], 'Price breaks saved')
