# Database Design — `procurax_db`

PostgreSQL 16 + pgvector. UUID PKs (`gen_random_uuid()`), `created_at`/`updated_at` on mutable tables, `organization_id` on business tables.

## Groups
- **Identity/RBAC**: organizations, users, roles, permissions, user_roles, role_permissions
- **Catalogue**: product_categories, products, suppliers, supplier_products (price, lead time, MOQ; unique product+supplier)
- **Stock**: warehouses, inventory (unique product+warehouse), inventory_movements, demand_history (daily per product/warehouse)
- **Procurement**: purchase_orders (+lines, +status_history), purchase_requests (+lines), approval_workflows, approval_history
- **AI**: chatbot_types, chatbot_configurations, chatbot_sessions, chatbot_messages, intent_definitions, intent_examples, ml_model_registry, ml_predictions, ai_provider_configurations (key stored encrypted/env-ref only), prompt_templates, supplier_messages (labelled training corpus)
- **RAG**: documents, document_chunks (`embedding vector(384)`, HNSW cosine index), document_processing_jobs
- **Agent**: agent_definitions, agent_executions, agent_execution_steps, agent_tool_registry, agent_approvals, agent_execution_logs
- **Audit**: audit_logs

## Conventions
- Status fields are PostgreSQL enums via `String` + CHECK constraints (easier migrations than native enum).
- JSONB only for: chunk/document metadata, ML metrics/features, agent plan/tool args/results, prompt variables.
- Money: `Numeric(14,2)`. Quantities: `Integer`.
- Indexes on all FKs, status columns, `products.sku` (unique per org), `suppliers.code`, `purchase_orders.po_number`.

## Seed targets (seed=42)
200 products, 30 suppliers, 5 warehouses, ~1000 inventory rows, 5000+ demand rows, 150 POs / 400 lines, 100 requests, 300 labelled supplier messages, 10 documents (generated text policy documents). Consistency rules: PO totals = sum of lines + tax; received qty <= ordered; `quantity_on_order` in inventory is derived from open PO lines; demand history drives `avg_daily_demand`.
