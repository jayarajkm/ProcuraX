# ProcuraX AI — Frontend

React + TypeScript + Vite, Tailwind CSS 3.4 (hand-written shadcn-style components in `src/components/ui`), Radix primitives,
TanStack Query, React Hook Form + Zod, Recharts, Sonner, Lucide.

## Prerequisites
- Node 20+, pnpm 10
- Backend running on `127.0.0.1:8000`: `cd .. && docker compose up -d postgres backend`

## Run
```bash
pnpm install
pnpm dev          # http://localhost:5173, proxies /api -> http://127.0.0.1:8000
```
Override the proxy target with `VITE_API_PROXY=http://host:port pnpm dev`.

Demo logins (password `Demo@12345`): `admin@`, `manager@`, `buyer@`, `viewer@procurax.demo`. All data is synthetic.

## Build / preview
```bash
pnpm build        # tsc -b && vite build -> dist/
pnpm preview      # http://localhost:4173 (same /api proxy)
```

## Test
```bash
pnpm test         # Vitest + Testing Library (unit/component tests)
LIVE_API=http://127.0.0.1:8000 pnpm test:live   # optional smoke test of every page against a running backend (read-only except one rule-based chat message in the playground test; no LLM calls)
```

## Structure
- `src/config/nav.tsx` — data-driven sidebar + routes. Placeholder pages become real by setting `component` and removing `placeholder`.
- `src/lib/api.ts` — typed fetch client (bearer token, `{error:{code,message}}` parsing, 401 handler); `src/lib/types.ts` mirrors backend schemas.
- `src/hooks/api.ts` — TanStack Query hooks and mutations with invalidation and error toasts.
- `src/auth/` — AuthContext (token in memory + localStorage), `ProtectedRoute`, `Can` (permission gate).
- `src/components/` — DataTable, Pagination, PageHeader, StatusBadge, ConfirmDialog, Drawer, EmptyState, ErrorState, Skeletons.
- `src/pages/` — Overview, Products, Suppliers, Inventory, Purchase Orders, Requests, Settings, Placeholder, plus the AI pages below.
- `src/components/chat/` — `ResponseDetails` (metadata renderer), `RichText` (safe `**bold**`/newlines), `ApprovalCallout`, per-bot styles. `src/components/ml/MLMetrics.tsx` — model cards, confusion-matrix heat grid, feature-importance chart. `src/components/ApprovalActions.tsx` — permission-gated approve/reject.

## AI pages
| Route | Page | Backend | Permissions |
|---|---|---|---|
| `/chatbots` | Catalogue of the six chatbots (accent colour + icon each, `available`/`configured` badges, LLM-not-configured notice) | `GET /chatbots` | `chat:use` |
| `/chatbots/:slug` | Playground: how-it-works panel, example prompts (send immediately), thread, session sidebar, `?q=` prefill (no auto-send), collapsible "Response details" | `POST /chatbots/{slug}/chat`, `GET /chatbots/{slug}/sessions`, `GET /chat-sessions/{id}/messages` | `chat:use` |
| `/documents` | List/filter/paginate, upload dialog with client pre-validation, chunk drawer, reprocess, delete; polls every 3s while uploaded/processing | `/documents*` | `document:read`; writes need `document:write` |
| `/knowledge` | Semantic search (top_k, min similarity, category) + "Ask the RAG chatbot" link | `GET /documents/search` | `document:read` |
| `/agent` | Run form, execution list, detail (plan, step timeline, approvals, logs, result), Pending approvals tab, Tools tab. `?execution=<id>` deep-links | `/agent/*` | `agent:run`; approve/reject and the pending tab need `agent:approve` |
| `/ml` | Active model cards with real metrics and always-visible caveats, classifier "Try it", stockout scan, retrain (confirm), version history | `/ml/*` | `ml:read`; retrain needs `ml:train` |

Notes
- LLM-backed calls (generative, RAG, agentic, agent runs) use a client-side timeout of 170s (`LLM_TIMEOUT_MS` in `src/lib/api.ts`) and show elapsed-time progress. Other requests have no client timeout.
- Response details render only what the backend returned: confidence appears only when present and always with its `confidence_kind`; values nested under `metadata.extra` (execution id/status, approval id, probabilities, model) are read from there.
- ML caveats and `training_stock_source` are always rendered (they describe synthetic-data limits). If the registry row has none, a generic synthetic-data notice is shown instead.
- The agent can never approve anything: the UI states this, and approval controls are shown only to users with `agent:approve`.
- Upload client limit (`MAX_UPLOAD_MB` in `src/pages/documentRules.ts`) mirrors the server default of 20 MB; the server is authoritative and its 422 message is shown inline.
- Chatbot Comparison and AI Administration remain honest placeholders (planned for the next build phase).

Chatbot Comparison and AI Administration are honest placeholders (next build phase).
