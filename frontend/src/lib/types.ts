// Types mirror backend/app/schemas/business.py. Decimals arrive as strings.
export interface Page<T> { items: T[]; total: number; page: number; page_size: number }

export interface ListParams {
  page?: number
  page_size?: number
  sort?: string
  order?: 'asc' | 'desc'
  q?: string
  [key: string]: string | number | boolean | undefined | null
}

export interface Me { id: string; email: string; full_name: string; roles: string[]; permissions: string[] }

export interface Category { id: string; name: string; description: string }
export interface Product {
  id: string; sku: string; name: string; description: string; manufacturer: string; unit_of_measure: string
  unit_price: string; is_active: boolean; category_id: string; category: Category; created_at: string; updated_at: string
}
export interface ProductInput {
  sku: string; name: string; description: string; category_id: string; manufacturer: string
  unit_of_measure: string; unit_price: number; is_active: boolean
}
export type ProductUpdate = Partial<Omit<ProductInput, 'sku'>>

export interface Supplier {
  id: string; code: string; name: string; contact_person: string; email: string; phone: string; address: string
  country: string; payment_terms: string; avg_lead_time_days: number; rating: string; is_active: boolean
}
export interface SupplierInput {
  code: string; name: string; contact_person: string; email: string | null; phone: string; address: string
  country: string; payment_terms: string; avg_lead_time_days: number; rating: number; is_active: boolean
}
export type SupplierUpdate = Partial<Omit<SupplierInput, 'code'>>
export interface SupplierProduct {
  product_id: string; sku: string; product_name: string; unit_price: string; lead_time_days: number
  min_order_qty: number; is_preferred: boolean
}
export interface SupplierPerformance {
  supplier_id: string; rating: number; orders_received: number; on_time_rate: number | null
  avg_delay_days: number | null; total_orders: number
}

export interface Warehouse { id: string; code: string; name: string; location: string }
export interface InventoryRow {
  id: string; product_id: string; sku: string; product_name: string; warehouse_id: string; warehouse: string
  quantity_on_hand: number; quantity_reserved: number; quantity_on_order: number; reorder_level: number
  safety_stock: number; avg_daily_demand: string; available: number; projected: number
  days_of_cover: number | null; low_stock: boolean; updated_at: string
}
export interface Movement { id: string; movement_type: string; quantity: number; reference: string; occurred_at: string }
export interface Recommendation {
  product_id: string; sku: string; product_name: string; warehouse: string; available: number; projected: number
  days_of_cover: number | null; suggested_quantity: number; supplier_id: string | null; supplier_name: string | null
  lead_time_days: number | null; unit_price: string | null
}

export interface POLine { id: string; product_id: string; quantity: number; quantity_received: number; unit_price: string; tax_rate: string; line_total: string }
export interface POHistory { from_status: string | null; to_status: string; changed_at: string; note: string }
export interface PO {
  id: string; po_number: string; supplier_id: string; warehouse_id: string; status: string; order_date: string
  expected_delivery_date: string; actual_delivery_date: string | null; subtotal: string; tax_amount: string; total_amount: string
}
export interface PODetail extends PO { lines: POLine[]; history: POHistory[] }
export interface POCreate {
  supplier_id: string; warehouse_id: string; lines: { product_id: string; quantity: number }[]
  expected_delivery_date?: string | null
}

export interface RequestLine { id: string; product_id: string; quantity: number; suggested_supplier_id: string | null }
export interface PurchaseRequest {
  id: string; request_number: string; justification: string; priority: string; status: string
  requested_delivery_date: string | null; created_at: string; lines: RequestLine[]
}
export interface RequestCreate {
  justification: string; priority: string; requested_delivery_date?: string | null
  lines: { product_id: string; quantity: number; suggested_supplier_id?: string | null }[]
}
export interface Approval { action: string; actor_id: string | null; comment: string; acted_at: string }

export interface Overview {
  is_demo_data: boolean; total_products: number; total_suppliers: number; inventory_value: number
  low_stock_records: number; low_stock_products: number; open_purchase_orders: number
  overdue_purchase_orders: number; pending_purchase_requests: number
  supplier_performance: { id: string; code: string; name: string; rating: number; received: number; on_time: number; orders: number; on_time_rate: number | null }[]
  po_status_breakdown: Record<string, number>
  recent_activity: { po_number: string; status: string; at: string }[]
}

// ---- AI: chatbots (backend/app/api/routes/chatbots.py, app/chatbot/types.py) ----
export interface ChatbotType {
  slug: string; name: string; description: string; technology: string; use_cases: string[]; example_prompts: string[]
  requires_llm: boolean; available: boolean; configured: boolean
}
export interface ChatSession { id: string; title: string; created_at: string }
export interface Citation {
  ref?: number; document?: string; document_id?: string; page?: number | null; chunk_index?: number; similarity?: number; excerpt?: string
}
export interface ChatMetadata {
  approach?: string
  data_sources?: string[]
  steps?: string[]
  confidence?: number | null
  confidence_kind?: string | null
  retrieval?: Citation[]
  action_executed?: boolean
  table?: { columns: string[]; rows: unknown[][] }
  extra?: {
    execution_id?: string; execution_status?: string; approval_id?: string | null
    probabilities?: Record<string, number>; model?: string; [k: string]: unknown
  }
}
export interface ChatReply { session_id: string; message_id: string; reply: string; metadata: ChatMetadata }
export interface ChatMessage { id: string; role: 'user' | 'assistant' | string; content: string; metadata: ChatMetadata | null; created_at: string }

// ---- documents ----
export type DocStatus = 'uploaded' | 'processing' | 'indexed' | 'failed'
export interface DocumentRow {
  id: string; title: string; filename: string; file_type: string; category: string; size_bytes: number; status: DocStatus | string
  error: string | null; metadata: { chunks?: number; pages?: number; [k: string]: unknown } | null; created_at: string; updated_at: string
}
export interface DocChunk { chunk_index: number; page: number | null; content: string; embedding_model: string | null }
export interface SearchHit { document_id: string; title: string; filename: string; chunk_index: number; page: number | null; similarity: number; content: string }
export interface SearchResponse { query: string; results: SearchHit[] }

// ---- agent ----
export interface AgentTool { name: string; description: string; input_schema: Record<string, unknown>; required_permission: string | null; sensitive: boolean }
export interface AgentExecutionSummary { id: string; user_request: string; status: string; created_at: string }
export interface AgentStep { index: number; tool: string; input: unknown; output: unknown; status: string; error: string | null }
export interface AgentApproval { id: string; summary: string; status: string; comment: string | null; decided_by: string | null; decided_at: string | null }
export interface AgentLog { level: string; message: string; at: string }
export interface AgentExecution {
  id: string; user_request: string; status: string; plan: string[] | null; final_result: string | null; error: string | null
  created_at: string; finished_at: string | null; steps: AgentStep[]; approvals: AgentApproval[]; logs: AgentLog[]
}
export interface PendingApproval { id: string; execution_id: string; summary: string; created_at: string }

// ---- ML ----
export interface MLModel {
  id: string; name: string; version: string; algorithm: string; training_rows: number; trained_at: string; is_active: boolean
  metrics: MLMetrics | null
}
export interface MLMetrics {
  task?: string; split?: string; caveats?: string[]; training_stock_source?: string
  accuracy?: number; macro_f1?: number; cv_macro_f1_mean?: number; cv_macro_f1_std?: number
  labels?: string[]; per_class?: Record<string, { precision: number; recall: number; 'f1-score': number; support: number }>
  confusion_matrix?: number[][]; test_rows?: number; train_rows?: number
  precision?: number; recall?: number; f1?: number; roc_auc?: number; positive_rate_test?: number
  baseline_naive_cover_rule?: { precision: number; recall: number; f1: number; accuracy: number }
  feature_importance?: Record<string, number>
  mae?: number; r2?: number; baseline_mae_3mo_mean?: number; baseline_mae_last_month?: number
}
export interface ClassifyResult { label: string; confidence: number; probabilities: Record<string, number>; model: string }
export interface StockoutItem {
  sku: string; product_name: string; warehouse: string; risk_probability: number; available: number; projected: number
  predicted_daily_demand: number; lead_time_days: number | null; suggested_replenishment: number
}
export interface StockoutScan { scanned: number; flagged: number; threshold: number; items: StockoutItem[]; models: string[] }

// ---- comparison (backend/app/api/routes/analytics.py: POST /compare/{slug}) ----
export const COMPARE_BOTS = ['rule_based', 'nlp', 'ml', 'generative', 'rag', 'agentic'] as const
export type CompareStatus = 'ok' | 'not_configured' | 'provider_error' | 'error' | 'forbidden'
export interface CompareResult {
  slug: string; status: CompareStatus; duration_ms: number; message?: string; reply?: string
  approach?: string; data_sources?: string[]; steps?: string[]
  confidence?: number | null; confidence_kind?: string | null
  retrieval?: Citation[]; action_executed?: boolean; table?: { columns: string[]; rows: unknown[][] }
  extra?: ChatMetadata['extra']
}

// ---- insights ----
export interface InsightItem { severity: 'high' | 'medium' | 'low' | string; title: string; detail: string; source: string; link?: string | null }
export interface InsightNarrative { text: string | null; reason?: string | null; model?: string }
export interface Insights { generated_from: string; items: InsightItem[]; narrative: InsightNarrative | null }

// ---- AI analytics ----
export interface AIAnalytics {
  window_days: number
  messages_by_bot: { slug: string; name: string; sessions: number; questions: number }[]
  questions_per_day: { day: string; n: number }[]
  agent_executions_by_status: { status: string; n: number }[]
  tool_usage: { tool_name: string; calls: number; errors: number; awaiting: number }[]
  approvals: { status: string; n: number; avg_seconds_to_decide: number | string | null }[]
  ml_predictions_by_model: { name: string; version: string; predictions: number; avg_confidence: number | string | null }[]
  documents_by_status: { status: string; n: number }[]
  note?: string
}

// ---- AI administration (backend/app/api/routes/admin.py) ----
export interface AdminProvider { provider: string; model: string; is_default: boolean; api_key_env_var: string; key_configured: boolean }
export interface AdminPolicy { key: string; value: string | number | null }
export interface AdminRule { name: string; patterns: string[]; response_template: string; value_source: string; is_active: boolean }
export interface AdminIntent { name: string; action: string; examples: string[] }
export interface AdminPrompt { name: string; template: string; variables: string[] | null; updated_at: string }
export interface AdminAgent { name: string; max_iterations: number; timeout_seconds: number }
export interface AdminTool { name: string; description: string; required_permission: string | null; is_sensitive: boolean; is_enabled: boolean }
export interface AuditEntry { id: string; at: string; user: string | null; action: string; entity_type: string; entity_id: string | null; details: Record<string, unknown> | null }
