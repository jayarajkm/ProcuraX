import { ShieldAlert } from 'lucide-react'
import { useState } from 'react'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { DataTable, type Column } from '@/components/DataTable'
import { Pagination } from '@/components/Pagination'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useAdminAgent, useAdminAudit, useAdminTools, usePatchAgent, usePatchTool } from '@/hooks/api'
import { fmtDateTime } from '@/lib/format'
import type { AdminAgent, AdminTool, AuditEntry } from '@/lib/types'
import { InlineError, QueryBoundary, Switch } from './AdminConfigTabs'

export const AGENT_LIMITS = { iter: { min: 1, max: 30 }, timeout: { min: 10, max: 900 } }

function AgentLimitsForm({ a }: { a: AdminAgent }) {
  const patch = usePatchAgent()
  const [iter, setIter] = useState(String(a.max_iterations))
  const [timeout, setTimeoutV] = useState(String(a.timeout_seconds))
  const check = (v: string, r: { min: number; max: number }) => (/^\d+$/.test(v) && +v >= r.min && +v <= r.max ? null : `Enter a whole number from ${r.min} to ${r.max}`)
  const e1 = check(iter, AGENT_LIMITS.iter), e2 = check(timeout, AGENT_LIMITS.timeout)
  const dirty = iter !== String(a.max_iterations) || timeout !== String(a.timeout_seconds)
  return (
    <Card>
      <CardHeader><CardTitle>Agent limits <span className="font-mono text-xs font-normal text-muted-foreground">{a.name}</span></CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="max-iter" className="mb-1 block text-sm font-medium">Max iterations (1–30)</label>
            <Input id="max-iter" inputMode="numeric" value={iter} onChange={(e) => setIter(e.target.value)} aria-invalid={!!e1} />
            {e1 && <p className="mt-1 text-xs text-destructive">{e1}</p>}
          </div>
          <div>
            <label htmlFor="timeout-s" className="mb-1 block text-sm font-medium">Timeout seconds (10–900)</label>
            <Input id="timeout-s" inputMode="numeric" value={timeout} onChange={(e) => setTimeoutV(e.target.value)} aria-invalid={!!e2} />
            {e2 && <p className="mt-1 text-xs text-destructive">{e2}</p>}
          </div>
        </div>
        <Button disabled={!dirty || !!e1 || !!e2 || patch.isPending} onClick={() => patch.mutate({ max_iterations: +iter, timeout_seconds: +timeout })}>Save limits</Button>
        <InlineError error={patch.error} />
      </CardContent>
    </Card>
  )
}

function ToolRow({ t }: { t: AdminTool }) {
  const patch = usePatchTool()
  const [confirm, setConfirm] = useState(false)
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 px-5 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm font-semibold">{t.name}</span>
          {t.is_sensitive && <Badge tone="amber"><ShieldAlert className="h-3 w-3" />Sensitive</Badge>}
          {!t.is_enabled && <Badge tone="red">Disabled</Badge>}
          {t.required_permission && <Badge tone="neutral">needs {t.required_permission}</Badge>}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{t.description}</p>
      </div>
      <div className="flex items-center gap-2 text-sm">{t.is_enabled ? 'Enabled' : 'Disabled'}
        <Switch checked={t.is_enabled} label={`${t.name} enabled`} disabled={patch.isPending}
          onChange={(v) => (v ? patch.mutate({ name: t.name, is_enabled: true }) : setConfirm(true))} />
      </div>
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} title={`Disable ${t.name}?`} confirmLabel="Disable tool" destructive loading={patch.isPending}
        description="The agent will refuse any step that calls this tool at runtime, even if the model plans to use it. Executions that need it will fail or finish without it."
        onConfirm={() => patch.mutate({ name: t.name, is_enabled: false }, { onSettled: () => setConfirm(false) })} />
    </li>
  )
}

export function AgentToolsTab() {
  const agent = useAdminAgent()
  const tools = useAdminTools()
  return (
    <div className="space-y-4">
      <QueryBoundary q={agent}>{agent.data && <AgentLimitsForm key={`${agent.data.max_iterations}-${agent.data.timeout_seconds}`} a={agent.data} />}</QueryBoundary>
      <Card className="overflow-hidden">
        <CardHeader><CardTitle>Tools</CardTitle></CardHeader>
        <p className="px-5 pb-3 text-sm text-muted-foreground">Disabled tools are refused at runtime: the agent cannot call them. Sensitive tools additionally require human approval before they commit anything.</p>
        <div className="border-t">
          <QueryBoundary q={tools} empty="No tools registered"><ul className="divide-y">{tools.data?.map((t) => <ToolRow key={`${t.name}-${t.is_enabled}`} t={t} />)}</ul></QueryBoundary>
        </div>
      </Card>
    </div>
  )
}

export function AuditTab() {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [draft, setDraft] = useState('')
  const [action, setAction] = useState('')
  const { data, isLoading, error, refetch } = useAdminAudit({ action: action || undefined, page, page_size: pageSize })
  const columns: Column<AuditEntry>[] = [
    { key: 'at', header: 'Time', cell: (a) => <span className="whitespace-nowrap">{fmtDateTime(a.at)}</span> },
    { key: 'user', header: 'User', cell: (a) => a.user ?? '—' },
    { key: 'action', header: 'Action', cell: (a) => <span className="font-mono text-xs">{a.action}</span> },
    { key: 'entity', header: 'Entity', cell: (a) => <span className="text-xs">{a.entity_type}{a.entity_id ? <span className="text-muted-foreground"> · {a.entity_id.length > 12 ? `${a.entity_id.slice(0, 8)}…` : a.entity_id}</span> : null}</span> },
    { key: 'details', header: 'Details', cell: (a) => (a.details && Object.keys(a.details).length
      ? <details><summary className="cursor-pointer text-xs text-primary">Show JSON</summary><pre className="mt-1 max-w-md overflow-x-auto rounded bg-muted p-2 text-xs">{JSON.stringify(a.details, null, 2)}</pre></details>
      : <span className="text-muted-foreground">—</span>) },
  ]
  return (
    <Card className="overflow-hidden">
      <form className="flex flex-wrap items-end gap-2 border-b p-4" onSubmit={(e) => { e.preventDefault(); setAction(draft.trim()); setPage(1) }}>
        <div className="min-w-[14rem] flex-1">
          <label htmlFor="audit-action" className="mb-1 block text-xs font-medium text-muted-foreground">Filter by action (contains)</label>
          <Input id="audit-action" placeholder="e.g. admin.tool" value={draft} onChange={(e) => setDraft(e.target.value)} />
        </div>
        <Button type="submit" variant="outline">Apply</Button>
        {action && <Button type="button" variant="ghost" onClick={() => { setDraft(''); setAction(''); setPage(1) }}>Clear</Button>}
      </form>
      <DataTable columns={columns} rows={data?.items} rowKey={(a) => a.id} loading={isLoading} error={error} onRetry={() => void refetch()} emptyTitle="No audit entries" emptyDescription={action ? 'No entries match this action filter.' : undefined} />
      <Pagination page={page} pageSize={pageSize} total={data?.total ?? 0} onPageChange={setPage} onPageSizeChange={(n) => { setPageSize(n); setPage(1) }} />
    </Card>
  )
}
