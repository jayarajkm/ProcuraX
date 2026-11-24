import { useState } from 'react'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/ErrorState'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input, Textarea } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  useAdminIntents, useAdminPolicy, useAdminPrompts, useAdminProviders, useAdminRules, usePatchPolicy, usePatchPrompt, usePatchProvider, usePatchRule,
} from '@/hooks/api'
import { fmtDateTime, titleCase } from '@/lib/format'
import type { AdminPolicy, AdminPrompt, AdminProvider, AdminRule } from '@/lib/types'
import { cn } from '@/lib/utils'

export function QueryBoundary({ q, children, empty }: { q: { isLoading: boolean; error: unknown; data: unknown; refetch: () => unknown }; children: React.ReactNode; empty?: string }) {
  if (q.isLoading) return <div className="space-y-3"><Skeleton className="h-24" /><Skeleton className="h-24" /></div>
  if (q.error && !q.data) return <Card><ErrorState error={q.error} onRetry={() => void q.refetch()} /></Card>
  if (Array.isArray(q.data) && q.data.length === 0) return <Card><EmptyState title={empty ?? 'Nothing configured'} /></Card>
  return <>{children}</>
}

export function InlineError({ error }: { error: Error | null }) {
  return error ? <p role="alert" className="text-sm text-destructive">{error.message}</p> : null
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}
      className={cn('relative h-6 w-11 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50', checked ? 'bg-primary' : 'bg-slate-300')}>
      <span className={cn('absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform', checked && 'translate-x-5')} />
    </button>
  )
}

// ---------------- Providers ----------------
export function ProviderRow({ p }: { p: AdminProvider }) {
  const patch = usePatchProvider()
  const [model, setModel] = useState(p.model)
  const [confirm, setConfirm] = useState(false)
  const dirty = model.trim() !== p.model && model.trim().length > 0
  return (
    <Card>
      <CardContent className="space-y-3 pt-5">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-semibold capitalize">{p.provider}</h3>
          {p.is_default && <Badge tone="green">Default</Badge>}
          <Badge tone={p.key_configured ? 'green' : 'amber'}>{p.key_configured ? 'key set on server' : 'not set'}</Badge>
          <span className="text-xs text-muted-foreground">env var <span className="font-mono">{p.api_key_env_var}</span></span>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[14rem] flex-1">
            <label htmlFor={`model-${p.provider}`} className="mb-1 block text-xs font-medium text-muted-foreground">Model</label>
            <Input id={`model-${p.provider}`} value={model} maxLength={80} onChange={(e) => setModel(e.target.value)} />
          </div>
          <Button variant="outline" disabled={!dirty || patch.isPending} onClick={() => patch.mutate({ provider: p.provider, body: { model: model.trim() } })}>Save model</Button>
          <Button disabled={p.is_default || !p.key_configured || patch.isPending} onClick={() => setConfirm(true)}>Make default</Button>
        </div>
        {!p.key_configured && !p.is_default && (
          <p className="text-xs text-muted-foreground">Cannot be made the default: <span className="font-mono">{p.api_key_env_var}</span> is not set in the server environment.</p>
        )}
        <InlineError error={patch.error} />
      </CardContent>
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} title={`Make ${p.provider} the default provider?`} confirmLabel="Make default" loading={patch.isPending}
        description="Generative answers, RAG answers, the agent and insight narratives will use this provider from now on. This is recorded in the audit log."
        onConfirm={() => patch.mutate({ provider: p.provider, body: { is_default: true } }, { onSettled: () => setConfirm(false) })} />
    </Card>
  )
}
export function ProvidersTab() {
  const q = useAdminProviders()
  return (
    <div className="space-y-4">
      <p role="note" className="rounded-md border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">API keys live only in the server environment and are never shown, entered or stored here. This tab only controls which provider is the default and which model each one uses.</p>
      <QueryBoundary q={q} empty="No providers">{q.data?.map((p) => <ProviderRow key={`${p.provider}-${p.model}-${p.is_default}`} p={p} />)}</QueryBoundary>
    </div>
  )
}

// ---------------- Policy ----------------
function PolicyRow({ p }: { p: AdminPolicy }) {
  const patch = usePatchPolicy()
  const current = p.value == null ? '' : String(p.value)
  const [val, setVal] = useState(current)
  return (
    <li className="space-y-1 px-5 py-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[14rem] flex-1">
          <label htmlFor={`policy-${p.key}`} className="mb-1 block text-sm font-medium">{titleCase(p.key)} <span className="font-mono text-xs font-normal text-muted-foreground">{p.key}</span></label>
          <Input id={`policy-${p.key}`} value={val} maxLength={200} onChange={(e) => setVal(e.target.value)} />
        </div>
        <Button variant="outline" disabled={val === current || !val.trim() || patch.isPending} onClick={() => patch.mutate({ key: p.key, value: val.trim() })}>Save</Button>
      </div>
      <InlineError error={patch.error} />
    </li>
  )
}
export function PolicyTab() {
  const q = useAdminPolicy()
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Business policy values the rule-based chatbot quotes. Numeric keys are validated by the server.</p>
      <QueryBoundary q={q} empty="No policy values"><Card><ul className="divide-y">{q.data?.map((p) => <PolicyRow key={`${p.key}-${p.value}`} p={p} />)}</ul></Card></QueryBoundary>
    </div>
  )
}

// ---------------- Rules ----------------
export const placeholdersOf = (t: string) => Array.from(new Set(Array.from(t.matchAll(/\{(\w+)\}/g), (m) => m[1])))
function RuleCard({ r }: { r: AdminRule }) {
  const patch = usePatchRule()
  const [patterns, setPatterns] = useState(r.patterns.join('\n'))
  const [template, setTemplate] = useState(r.response_template)
  const list = patterns.split('\n').map((s) => s.trim()).filter(Boolean)
  const body: { patterns?: string[]; response_template?: string } = {}
  if (list.join('\n') !== r.patterns.join('\n')) body.patterns = list
  if (template !== r.response_template) body.response_template = template
  const dirty = Object.keys(body).length > 0
  const invalid = list.length === 0 || template.trim().length === 0
  return (
    <Card>
      <CardContent className="space-y-3 pt-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2"><h3 className="font-mono text-sm font-semibold">{r.name}</h3><Badge tone={r.is_active ? 'green' : 'neutral'}>{r.is_active ? 'Active' : 'Inactive'}</Badge><span className="text-xs text-muted-foreground">value source: <span className="font-mono">{r.value_source}</span></span></div>
          <label className="flex items-center gap-2 text-sm">Active<Switch checked={r.is_active} label={`${r.name} active`} disabled={patch.isPending} onChange={(v) => patch.mutate({ name: r.name, body: { is_active: v } })} /></label>
        </div>
        <div>
          <label htmlFor={`pat-${r.name}`} className="mb-1 block text-xs font-medium text-muted-foreground">Trigger patterns (one per line; a question containing any of them matches)</label>
          <Textarea id={`pat-${r.name}`} rows={Math.min(6, Math.max(2, list.length + 1))} value={patterns} onChange={(e) => setPatterns(e.target.value)} />
        </div>
        <div>
          <label htmlFor={`tpl-${r.name}`} className="mb-1 block text-xs font-medium text-muted-foreground">Response template</label>
          <Textarea id={`tpl-${r.name}`} rows={3} maxLength={1000} value={template} onChange={(e) => setTemplate(e.target.value)} />
          <p className="mt-1 text-xs text-muted-foreground">
            Placeholders use <span className="font-mono">{'{name}'}</span>, filled from the <span className="font-mono">{r.value_source}</span> source. Placeholders the source cannot supply are rejected by the server.
            {placeholdersOf(template).length > 0 && <> In use: {placeholdersOf(template).map((n) => <span key={n} className="mr-1 font-mono">{`{${n}}`}</span>)}</>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={!dirty || invalid || patch.isPending} onClick={() => patch.mutate({ name: r.name, body })}>Save rule</Button>
          {dirty && <Button variant="ghost" onClick={() => { setPatterns(r.patterns.join('\n')); setTemplate(r.response_template) }}>Reset</Button>}
        </div>
        <InlineError error={patch.error} />
      </CardContent>
    </Card>
  )
}
export function RulesTab() {
  const q = useAdminRules()
  return <div className="space-y-4"><p className="text-sm text-muted-foreground">Rules of the rule-based chatbot: deterministic pattern to templated answer.</p><QueryBoundary q={q} empty="No rules">{q.data?.map((r) => <RuleCard key={`${r.name}-${r.is_active}-${r.response_template}-${r.patterns.join()}`} r={r} />)}</QueryBoundary></div>
}

// ---------------- Intents ----------------
export function IntentsTab() {
  const q = useAdminIntents()
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Intents recognised by the NLP chatbot (TF-IDF similarity to these training examples). Read-only.</p>
      <QueryBoundary q={q} empty="No intents">
        <div className="grid gap-4 md:grid-cols-2">
          {q.data?.map((i) => (
            <Card key={i.name}><CardContent className="space-y-2 pt-5">
              <div className="flex flex-wrap items-center gap-2"><h3 className="font-mono text-sm font-semibold">{i.name}</h3><Badge tone="blue">action: {i.action}</Badge></div>
              <ul className="list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">{i.examples.map((e) => <li key={e}>{e}</li>)}</ul>
            </CardContent></Card>
          ))}
        </div>
      </QueryBoundary>
    </div>
  )
}

// ---------------- Prompts ----------------
function PromptCard({ p }: { p: AdminPrompt }) {
  const patch = usePatchPrompt()
  const [text, setText] = useState(p.template)
  return (
    <Card><CardContent className="space-y-3 pt-5">
      <div className="flex flex-wrap items-center gap-2"><h3 className="font-mono text-sm font-semibold">{p.name}</h3>{p.variables?.map((v) => <Badge key={v} tone="purple">{`{${v}}`}</Badge>)}<span className="text-xs text-muted-foreground">updated {fmtDateTime(p.updated_at)}</span></div>
      <Textarea aria-label={`Prompt ${p.name}`} rows={6} maxLength={8000} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="flex items-center gap-3">
        <Button disabled={text === p.template || text.trim().length < 10 || patch.isPending} onClick={() => patch.mutate({ name: p.name, template: text })}>Save prompt</Button>
        <span className="text-xs text-muted-foreground">{text.length} / 8000</span>
      </div>
      <InlineError error={patch.error} />
    </CardContent></Card>
  )
}
export function PromptsTab() {
  const q = useAdminPrompts()
  return <div className="space-y-4"><p className="text-sm text-muted-foreground">System prompts used by the generative, RAG and agent bots. Changes apply to the next request.</p><QueryBoundary q={q} empty="No prompts">{q.data?.map((p) => <PromptCard key={`${p.name}-${p.updated_at}`} p={p} />)}</QueryBoundary></div>
}
