import { Ban, Loader2, Play, ShieldCheck, Wrench } from 'lucide-react'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Can } from '@/auth/Can'
import { useAuth } from '@/auth/AuthContext'
import { ApprovalActions } from '@/components/ApprovalActions'
import { RichText } from '@/components/chat/RichText'
import { DataTable, type Column } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/ErrorState'
import { PageHeader } from '@/components/PageHeader'
import { DetailSkeleton, TableSkeleton } from '@/components/Skeletons'
import { StatusBadge } from '@/components/StatusBadge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAgentExecution, useAgentExecutions, useAgentTools, usePendingApprovals, useRunAgent } from '@/hooks/api'
import { fmtDateTime } from '@/lib/format'
import type { AgentTool } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useEffect } from 'react'

export const AGENT_EXAMPLES = [
  'Find products that may run out within the next seven days and prepare purchase requests.',
  'Which suppliers have the best on-time delivery? Summarise the top three.',
  'List open purchase orders that are overdue and explain why they matter.',
]

function Json({ value }: { value: unknown }) {
  return <pre className="max-h-64 overflow-auto rounded bg-muted p-2 text-xs">{JSON.stringify(value, null, 2)}</pre>
}

function RunForm({ onStarted }: { onStarted: (id: string) => void }) {
  const [text, setText] = useState('')
  const run = useRunAgent()
  const [secs, setSecs] = useState(0)
  useEffect(() => {
    if (!run.isPending) { setSecs(0); return }
    const t = setInterval(() => setSecs((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [run.isPending])
  const valid = text.trim().length >= 3
  const go = () => { if (valid && !run.isPending) run.mutate(text.trim(), { onSuccess: (ex) => { onStarted(ex.id); setText('') } }) }
  return (
    <Card>
      <CardHeader><CardTitle>Run the agent</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <Textarea aria-label="Agent request" rows={4} maxLength={2000} placeholder="Describe a procurement task in plain language…" value={text} onChange={(e) => setText(e.target.value)} disabled={run.isPending} />
        <div className="flex flex-wrap gap-1.5">
          {AGENT_EXAMPLES.map((p) => (
            <button key={p} type="button" disabled={run.isPending} onClick={() => setText(p)} className="rounded-full border px-2.5 py-1 text-left text-xs hover:bg-muted disabled:opacity-50">{p}</button>
          ))}
        </div>
        <Button className="w-full" onClick={go} disabled={!valid || run.isPending}>
          {run.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}{run.isPending ? 'Agent is working…' : 'Run agent'}
        </Button>
        {run.isPending && (
          <div role="status" aria-live="polite" className="rounded-md border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
            Planning and calling tools… {secs}s elapsed. A run can take up to about 2 minutes. You can keep browsing this page; the result will appear in the list when it finishes.
          </div>
        )}
        {run.error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800">{run.error.message}</p>}
      </CardContent>
    </Card>
  )
}

function ExecutionList({ selected, onSelect }: { selected?: string; onSelect: (id: string) => void }) {
  const { data, isLoading, error, refetch } = useAgentExecutions()
  return (
    <Card>
      <CardHeader><CardTitle>Executions</CardTitle><Button variant="ghost" size="sm" onClick={() => void refetch()}>Refresh</Button></CardHeader>
      {isLoading ? <TableSkeleton rows={4} cols={2} /> : error ? <ErrorState error={error} onRetry={() => void refetch()} />
        : !data?.length ? <EmptyState title="No executions yet" description="Run the agent to see its plan, steps and approvals here." />
        : (
          <ul className="max-h-[26rem] divide-y overflow-y-auto">
            {data.map((e) => (
              <li key={e.id}>
                <button type="button" onClick={() => onSelect(e.id)} aria-current={e.id === selected} className={cn('w-full space-y-1 px-4 py-2.5 text-left hover:bg-muted', e.id === selected && 'bg-accent')}>
                  <div className="flex items-center justify-between gap-2"><StatusBadge status={e.status} /><span className="text-xs text-muted-foreground">{fmtDateTime(e.created_at)}</span></div>
                  <p className="line-clamp-2 text-sm">{e.user_request}</p>
                </button>
              </li>
            ))}
          </ul>
        )}
    </Card>
  )
}

export function ExecutionDetail({ id }: { id: string }) {
  const { data: ex, isLoading, error, refetch } = useAgentExecution(id)
  if (isLoading) return <Card className="p-5"><DetailSkeleton /></Card>
  if (error || !ex) return <Card><ErrorState error={error} onRetry={() => void refetch()} /></Card>
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="min-w-0"><CardTitle>Request</CardTitle><p className="mt-1 break-words text-sm">{ex.user_request}</p></div>
          <StatusBadge status={ex.status} />
        </CardHeader>
        <CardContent className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
          <span>Started: {fmtDateTime(ex.created_at)}</span><span>Finished: {fmtDateTime(ex.finished_at)}</span><span className="font-mono">{ex.id}</span>
        </CardContent>
      </Card>

      {ex.approvals.filter((a) => a.status === 'pending').map((a) => (
        <div key={a.id} role="alert" className="rounded-lg border-2 border-amber-300 bg-amber-50 p-4 text-amber-900" data-testid="pending-approval">
          <div className="font-semibold">Pending approval</div>
          <p className="mt-1 whitespace-pre-wrap break-words text-sm">{a.summary}</p>
          <div className="mt-3"><ApprovalActions approvalId={a.id} /></div>
        </div>
      ))}

      {ex.error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{ex.error}</p>}
      {ex.final_result && (
        <Card><CardHeader><CardTitle>Final result</CardTitle></CardHeader><CardContent className="text-sm"><RichText text={ex.final_result} /></CardContent></Card>
      )}

      <Card>
        <CardHeader><CardTitle>Plan</CardTitle></CardHeader>
        <CardContent>{ex.plan?.length ? <ol className="list-decimal space-y-1 pl-5 text-sm">{ex.plan.map((p, i) => <li key={i}>{p}</li>)}</ol> : <p className="text-sm text-muted-foreground">No plan was recorded.</p>}</CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Step timeline ({ex.steps.length})</CardTitle></CardHeader>
        <CardContent>
          {!ex.steps.length ? <p className="text-sm text-muted-foreground">No tool calls were made.</p> : (
            <ol className="space-y-3 border-l-2 pl-4">
              {ex.steps.map((s) => (
                <li key={s.index} className="space-y-1.5" data-testid="agent-step">
                  <div className="flex flex-wrap items-center gap-2"><span className="text-xs text-muted-foreground">#{s.index + 1}</span><code className="rounded bg-muted px-1.5 py-0.5 text-sm font-semibold">{s.tool}</code><StatusBadge status={s.status} /></div>
                  {s.error && <p className="text-xs text-destructive">{s.error}</p>}
                  <details className="text-xs"><summary className="cursor-pointer text-muted-foreground">Input</summary><Json value={s.input} /></details>
                  {s.output != null && <details className="text-xs"><summary className="cursor-pointer text-muted-foreground">Output</summary><Json value={s.output} /></details>}
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Approvals ({ex.approvals.length})</CardTitle></CardHeader>
        <CardContent>
          {!ex.approvals.length ? <p className="text-sm text-muted-foreground">This run did not need any approval.</p> : (
            <ul className="space-y-2">{ex.approvals.map((a) => (
              <li key={a.id} className="rounded-md border p-3 text-sm">
                <div className="flex items-center justify-between gap-2"><StatusBadge status={a.status} />{a.decided_at && <span className="text-xs text-muted-foreground">{fmtDateTime(a.decided_at)}</span>}</div>
                <p className="mt-1 whitespace-pre-wrap break-words">{a.summary}</p>
                {a.comment && <p className="mt-1 text-xs text-muted-foreground">Comment: {a.comment}</p>}
              </li>))}</ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Logs ({ex.logs.length})</CardTitle></CardHeader>
        <CardContent>
          {!ex.logs.length ? <p className="text-sm text-muted-foreground">No log entries.</p> : (
            <ul className="space-y-1 font-mono text-xs">{ex.logs.map((l, i) => (
              <li key={i} className="flex gap-2"><span className="shrink-0 text-muted-foreground">{fmtDateTime(l.at)}</span>
                <span className={cn('shrink-0 uppercase', l.level === 'error' ? 'text-destructive' : l.level === 'warning' ? 'text-amber-700' : 'text-muted-foreground')}>{l.level}</span><span className="break-words">{l.message}</span></li>))}</ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function PendingTab({ onOpen }: { onOpen: (id: string) => void }) {
  const { data, isLoading, error, refetch } = usePendingApprovals(true)
  return (
    <Card>
      {isLoading ? <TableSkeleton rows={3} cols={3} /> : error ? <ErrorState error={error} onRetry={() => void refetch()} />
        : !data?.length ? <EmptyState title="No pending approvals" description="Actions that need a human decision will appear here." />
        : (
          <ul className="divide-y">
            {data.map((a) => (
              <li key={a.id} className="space-y-2 p-4" data-testid="pending-row">
                <p className="whitespace-pre-wrap break-words text-sm">{a.summary}</p>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <button type="button" className="text-xs text-primary underline-offset-4 hover:underline" onClick={() => onOpen(a.execution_id)}>Open execution</button>
                  <ApprovalActions approvalId={a.id} />
                </div>
                <p className="text-xs text-muted-foreground">Requested {fmtDateTime(a.created_at)}</p>
              </li>
            ))}
          </ul>
        )}
    </Card>
  )
}

function ToolsTab() {
  const { data, isLoading, error, refetch } = useAgentTools()
  const columns: Column<AgentTool>[] = [
    { key: 'name', header: 'Tool', cell: (t) => <code className="font-semibold">{t.name}</code> },
    { key: 'desc', header: 'Description', cell: (t) => t.description },
    { key: 'perm', header: 'Permission', cell: (t) => (t.required_permission ? <code className="text-xs">{t.required_permission}</code> : '—') },
    { key: 'sens', header: 'Sensitive', cell: (t) => (t.sensitive ? <Badge tone="amber"><ShieldCheck className="h-3 w-3" />Needs human approval</Badge> : <Badge>Read / safe</Badge>) },
    { key: 'schema', header: 'Inputs', cell: (t) => {
      const props = Object.keys((t.input_schema as { properties?: Record<string, unknown> }).properties ?? {})
      return <details className="text-xs"><summary className="cursor-pointer">{props.join(', ') || 'none'}</summary><Json value={t.input_schema} /></details>
    } },
  ]
  return (
    <Card className="overflow-hidden">
      <DataTable columns={columns} rows={data} rowKey={(t) => t.name} loading={isLoading} error={error} onRetry={() => void refetch()} emptyTitle="No tools registered" />
    </Card>
  )
}

export function AgentPage() {
  const [params, setParams] = useSearchParams()
  const { can } = useAuth()
  const selected = params.get('execution') ?? undefined
  const select = (id: string) => setParams((p) => { const n = new URLSearchParams(p); n.set('execution', id); return n }, { replace: true })
  const [tab, setTab] = useState('workspace')
  const open = (id: string) => { select(id); setTab('workspace') }
  return (
    <>
      <PageHeader title="Agent Workspace" description="A supervised procurement agent: it plans, calls whitelisted tools, and stops for a human before anything sensitive happens." />
      <div role="note" className="mb-4 flex items-start gap-2 rounded-md border border-slate-300 bg-slate-50 p-3 text-sm">
        <Ban className="mt-0.5 h-4 w-4 shrink-0 text-slate-600" />
        <span><strong>Safety boundaries:</strong> the agent can <strong>never approve</strong> anything itself: approvals are always a human decision by a Procurement Manager or Administrator. It can only call the registered tools listed in the Tools tab, and it <strong>cannot run SQL or shell commands</strong>.</span>
      </div>
      {!can('agent:run') ? (
        <Card><EmptyState title="Agent access required" description="Your role does not include agent:run, so the run form, execution history and tool registry are hidden (the API refuses them too). Ask an administrator for access." /></Card>
      ) : (
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="workspace">Workspace</TabsTrigger>
          <Can permission="agent:approve"><TabsTrigger value="pending">Pending approvals</TabsTrigger></Can>
          <TabsTrigger value="tools"><Wrench className="mr-1 inline h-3.5 w-3.5" />Tools</TabsTrigger>
        </TabsList>
        <TabsContent value="workspace">
          <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
            <div className="space-y-4">
              <RunForm onStarted={select} />
              <ExecutionList selected={selected} onSelect={select} />
            </div>
            <div>{selected ? <ExecutionDetail id={selected} /> : <Card><EmptyState title="Select an execution" description="Choose one from the list, or run the agent to see its plan, step timeline and approvals." /></Card>}</div>
          </div>
        </TabsContent>
        {can('agent:approve') && <TabsContent value="pending"><PendingTab onOpen={open} /></TabsContent>}
        <TabsContent value="tools"><ToolsTab /></TabsContent>
      </Tabs>
      )}
    </>
  )
}
