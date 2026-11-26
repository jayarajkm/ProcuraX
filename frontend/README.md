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

## Response language (all chatbots)
- `GET /languages` feeds `LanguageSelect` (`src/components/LanguageSelect.tsx`, native `<select>`, shows `native_name (name)`). The choice is one shared preference (`useLanguage()` in `src/hooks/useLanguage.ts`, localStorage key `procurax.language`, default `en`; an unknown stored code or a failed language list falls back to `en`). Changing it never sends a request.
- Sent as `language` in `POST /chatbots/{slug}/chat` (Playground), `POST /compare/{slug}` (all six calls) and `POST /agent/executions` (Agent form). Knowledge Center's RAG hand-off still only passes `?q=`.
- Disclosure (`src/components/chat/TranslationInfo.tsx`): badge "Translated by LLM" (rule-based/NLP/ML: English answer translated by the LLM, so a configured LLM provider is required) or "Answered in <language>" (LLM bots); a "Language & translation" section in Response details (mode, English question used, expandable original English reply, what stays English, note); an amber "Translation unavailable — showing English" warning when `input_/output_translation_error` exist. Only fields the backend sent are shown; English and legacy messages render nothing.
- RTL languages (`rtl: true`, e.g. Arabic): assistant replies and the input get `dir="rtl"`; details, tables and IDs stay LTR.
- Agent: plan, tool calls and audit logs stay English; only the final answer is localised. Execution detail shows a language chip.

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

## Comparison, administration, analytics, insights
| Route | Page | Backend | Permissions |
|---|---|---|---|
| `/compare` | Chatbot Comparison: one question, up to six parallel `POST /compare/{slug}` calls (LLM timeout), a card per bot that fills in as its own request returns (spinner + elapsed timer), per-bot include checkboxes, example chips, summary table | `POST /compare/{slug}` | `chat:use` (agent card shows "forbidden" without `agent:run`) |
| `/admin` | AI Administration, tabs: Providers, Policy values, Rules, Intents (read-only), Prompts, Agent & Tools, Audit log, AI Analytics | `/admin/*`, `/analytics/ai` | `admin:manage`; others see an "Administrator only" card and no admin request is made |
| `/ai-analytics` | AI Analytics (sidebar item next to ML Models, so non-admins with `ml:read` can reach it; also a tab in `/admin`) | `GET /analytics/ai?days=` | `ml:read` |
| `/overview` | "Insights" panel: deterministic rule insights (severity, detail, source, link) plus an opt-in "Generate narrative summary" button | `GET /dashboard/insights[?narrative=true]` | `product:read` |

Notes
- Comparison cards render only what each bot returned. Confidence is shown only when present, with its `confidence_kind`; bots without one say "no confidence score produced by this technique" and the summary table shows a dash. An agent result with `extra.execution_status === 'awaiting_approval'` is labelled "Prepared, awaiting human approval — nothing executed" with a link to `/agent`. `not_configured` is shown as an informational note, `error`/`provider_error` as a red alert, `forbidden` muted. A transport failure or the 170s client timeout becomes an `error` card (the server may still have run the agent: check Agent Workspace).
- Admin edits are never optimistic: each mutation invalidates its query (and `admin-audit`) and toasts, and API messages (409 key missing, 422 validation) are shown inline. Making a provider the default and disabling a tool ask for confirmation. API keys are never shown or entered; the UI states they live only in the server environment. "Make default" is disabled when `key_configured` is false.
- The narrative summary calls an LLM only when the button is clicked (a mutation, not a query). If `narrative.text` is null, `narrative.reason` is shown as a muted setup notice.
- The nav path for the comparison page is `/compare` and for administration `/admin` (earlier placeholders used `/chatbot-comparison` and `/ai-admin`).
- Tests: `src/test/phase3.test.tsx` (mocked fetch) covers card states, summary confidence, parallel calls, admin gating, make-default, tool/policy/agent-limit flows, analytics gating, insights fallback. The live smoke test also mounts Overview insights (no narrative), AI Analytics and the idle comparison page; it never calls PATCH or LLM bots.
