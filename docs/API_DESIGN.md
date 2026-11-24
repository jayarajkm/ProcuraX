# API Design

Base: `/api/v1`. OpenAPI at `/docs`. Auth: `Authorization: Bearer <JWT>` (login at `POST /api/v1/auth/login`).

## Conventions
- Lists: `?page=1&page_size=25&sort=name&order=asc&q=search&<filters>` → `{items, total, page, page_size}`
- Errors: `{ "error": { "code": "not_found", "message": "...", "details": {} } }`
- Mutations are transactional; sensitive transitions check permissions (`po:approve`, `request:approve`, ...).

## Resource groups
auth, dashboard, products, categories, suppliers, warehouses, inventory (+movements, reorder-recommendations), purchase-orders (+status), purchase-requests (+submit/approve/reject/convert), documents (+reprocess, search), chatbots (catalogue, sessions, messages, `/chatbots/{type}/chat`), compare, ml (models, predict, evaluation), agent (executions, approvals), admin (providers, prompts, audit).
