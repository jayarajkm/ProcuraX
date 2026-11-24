import { AlertTriangle, CheckCircle2, ChevronDown, ExternalLink, FileText, Info, Loader2, MinusCircle, ShieldAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { SimilarityBar } from '@/components/chat/ResponseDetails'
import { botStyle } from '@/components/chat/chatbotStyles'
import { RichText } from '@/components/chat/RichText'
import { TranslationDisclosure } from '@/components/chat/TranslationInfo'
import { useLanguageInfo } from '@/hooks/useLanguage'
import { Badge } from '@/components/ui/badge'
import type { CompareResult } from '@/lib/types'
import { cn } from '@/lib/utils'

export type RunPhase = 'idle' | 'running' | 'done'
export interface BotRun { phase: RunPhase; startedAt?: number; result?: CompareResult }

export const BOT_NAMES: Record<string, string> = {
  rule_based: 'Rule-Based', nlp: 'NLP / Intent', ml: 'Machine Learning', generative: 'Generative AI', rag: 'RAG', agentic: 'Agentic AI',
}

export const isAwaitingApproval = (r?: CompareResult) => r?.extra?.execution_status === 'awaiting_approval'
export const confidenceText = (r?: CompareResult) =>
  r?.status === 'ok' && r.confidence != null ? `${(r.confidence * 100).toFixed(1)}%` : null

export function useElapsed(startedAt?: number, active = true) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active || startedAt == null) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [startedAt, active])
  return startedAt == null ? 0 : Math.max(0, now - startedAt)
}
const fmtSeconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`
export const fmtDuration = (ms: number) => (ms < 1000 ? `${ms} ms` : fmtSeconds(ms))

function Label({ children }: { children: React.ReactNode }) {
  return <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{children}</div>
}

function Steps({ steps }: { steps: string[] }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground">
        Execution steps ({steps.length}) <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
      </button>
      {open && <ol className="mt-1 list-decimal space-y-0.5 pl-4 text-xs">{steps.map((s, i) => <li key={i}>{s}</li>)}</ol>}
    </div>
  )
}

function Reply({ slug, text, language }: { slug: string; text: string; language?: string }) {
  return language && language !== 'en' ? <RtlReply slug={slug} text={text} language={language} /> : <ReplyBox slug={slug} text={text} />
}
function RtlReply({ slug, text, language }: { slug: string; text: string; language: string }) {
  return <ReplyBox slug={slug} text={text} rtl={useLanguageInfo().isRtl(language)} />
}
function ReplyBox({ slug, text, rtl }: { slug: string; text: string; rtl?: boolean }) {
  return <div className={cn('rounded-md bg-muted/40 p-3 leading-relaxed', rtl && 'text-right')} dir={rtl ? 'rtl' : undefined} data-testid={`reply-${slug}`}><RichText text={text} /></div>
}

export function CompareCard({ slug, name, run }: { slug: string; name?: string; run: BotRun }) {
  const st = botStyle(slug)
  const Icon = st.icon
  const r = run.result
  const elapsed = useElapsed(run.startedAt, run.phase === 'running')
  const ok = r?.status === 'ok'
  const conf = confidenceText(r)
  const awaiting = ok && isAwaitingApproval(r)
  return (
    <article aria-label={`${name ?? BOT_NAMES[slug] ?? slug} result`} data-testid={`card-${slug}`} className={cn('flex flex-col gap-3 rounded-lg border border-t-4 bg-card p-4 text-sm shadow-sm', st.border)}>
      <header className="flex items-center justify-between gap-2">
        <div className={cn('flex items-center gap-2 font-semibold', st.text)}><span className={cn('rounded-md p-1.5', st.bg)}><Icon className="h-4 w-4" /></span>{name ?? BOT_NAMES[slug] ?? slug}</div>
        {run.phase === 'done' && r && <span className="text-xs tabular-nums text-muted-foreground" data-testid={`duration-${slug}`}>{fmtDuration(r.duration_ms)}</span>}
      </header>

      {run.phase === 'idle' && <p className="text-muted-foreground">Not run yet. Ask a question above.</p>}

      {run.phase === 'running' && (
        <div role="status" className="flex items-center gap-2 rounded-md bg-muted/50 p-3 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Running… <span className="tabular-nums" data-testid={`elapsed-${slug}`}>{fmtSeconds(elapsed)}</span></span>
        </div>
      )}

      {run.phase === 'done' && r && r.status === 'not_configured' && (
        <div role="note" className="flex gap-2 rounded-md border border-sky-200 bg-sky-50 p-3 text-sky-900">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <div><div className="font-medium">Not configured</div><p className="mt-0.5">{r.reply ?? r.message ?? 'This technique needs setup before it can answer.'}</p></div>
        </div>
      )}
      {run.phase === 'done' && r && (r.status === 'error' || r.status === 'provider_error') && (
        <div role="alert" className="flex gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-red-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div><div className="font-medium">{r.status === 'provider_error' ? 'Provider error' : 'Error'}</div><p className="mt-0.5 break-words">{r.message ?? r.reply ?? 'The request failed.'}</p></div>
        </div>
      )}
      {run.phase === 'done' && r && r.status === 'forbidden' && (
        <div className="flex gap-2 rounded-md bg-muted/60 p-3 text-muted-foreground"><MinusCircle className="mt-0.5 h-4 w-4 shrink-0" /><p>{r.message ?? 'Your role is not allowed to run this bot.'}</p></div>
      )}

      {run.phase === 'done' && ok && r && (
        <>
          <Reply slug={slug} text={r.reply ?? ''} language={r.language} />
          <TranslationDisclosure language={r.language} translation={r.translation} />

          {awaiting ? (
            <div role="status" className="rounded-md border-2 border-amber-300 bg-amber-50 p-3 text-amber-900">
              <div className="flex items-center gap-2 font-semibold"><ShieldAlert className="h-4 w-4" />Prepared, awaiting human approval — nothing executed</div>
              {r.extra?.execution_id
                ? <Link to={`/agent?execution=${r.extra.execution_id}`} className="mt-1 inline-flex items-center gap-1 font-medium text-primary hover:underline">Review in Agent Workspace <ExternalLink className="h-3.5 w-3.5" /></Link>
                : <Link to="/agent" className="mt-1 inline-flex items-center gap-1 font-medium text-primary hover:underline">Open Agent Workspace <ExternalLink className="h-3.5 w-3.5" /></Link>}
            </div>
          ) : null}

          {r.approach && <div><Label>Processing approach</Label><p className="text-xs">{r.approach}</p></div>}
          <div>
            <Label>Confidence</Label>
            {conf
              ? <p className="text-xs"><span className="font-semibold tabular-nums">{conf}</span>{r.confidence_kind ? <span className="text-muted-foreground"> — {r.confidence_kind}</span> : null}</p>
              : <p className="text-xs text-muted-foreground">no confidence score produced by this technique</p>}
          </div>
          <div>
            <Label>Data sources</Label>
            {r.data_sources?.length ? <div className="flex flex-wrap gap-1">{r.data_sources.map((s) => <Badge key={s} tone="blue">{s}</Badge>)}</div> : <p className="text-xs text-muted-foreground">none reported</p>}
          </div>
          {!!r.steps?.length && <Steps steps={r.steps} />}
          {!!r.retrieval?.length && (
            <div>
              <Label>Retrieved passages ({r.retrieval.length})</Label>
              <ul className="space-y-1.5">
                {r.retrieval.map((c, i) => (
                  <li key={i} className="rounded border bg-muted/20 p-2 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 font-medium"><FileText className="h-3.5 w-3.5 text-muted-foreground" />[{c.ref ?? i + 1}] {c.document ?? 'Document'}{c.page != null ? <span className="font-normal text-muted-foreground"> · page {c.page}</span> : null}</span>
                      {c.similarity != null && <SimilarityBar value={c.similarity} />}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {r.table && (
            <div>
              <Label>Result table</Label>
              <div className="overflow-x-auto rounded border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/60 text-left text-muted-foreground"><tr>{r.table.columns.map((c) => <th key={c} className="whitespace-nowrap px-2 py-1 font-medium">{c}</th>)}</tr></thead>
                  <tbody className="divide-y">{r.table.rows.map((row, i) => <tr key={i}>{row.map((v, j) => <td key={j} className="px-2 py-1">{v == null ? '—' : String(v)}</td>)}</tr>)}</tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {run.phase === 'done' && r && (
        <footer className="mt-auto pt-1">
          {r.action_executed
            ? <Badge tone="green"><CheckCircle2 className="h-3 w-3" />Action executed: yes</Badge>
            : <Badge tone="neutral">Action executed: no</Badge>}
        </footer>
      )}
    </article>
  )
}

export interface SummaryRow { slug: string; run: BotRun; included: boolean }

const STATUS_LABEL: Record<string, { text: string; tone: 'green' | 'blue' | 'red' | 'neutral' | 'amber' }> = {
  ok: { text: 'OK', tone: 'green' }, not_configured: { text: 'Not configured', tone: 'blue' }, provider_error: { text: 'Provider error', tone: 'red' },
  error: { text: 'Error', tone: 'red' }, forbidden: { text: 'Forbidden', tone: 'neutral' },
}

export function CompareSummary({ rows }: { rows: SummaryRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" aria-label="Comparison summary">
        <thead className="bg-muted/60 text-left text-xs uppercase text-muted-foreground">
          <tr>
            <th className="px-4 py-2">Bot</th><th className="px-4 py-2">Status</th><th className="px-4 py-2 text-right">Duration</th>
            <th className="px-4 py-2">Confidence</th><th className="px-4 py-2 text-right">Data sources</th><th className="px-4 py-2">Action executed</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map(({ slug, run, included }) => {
            const r = run.result
            const done = run.phase === 'done' && r
            const conf = done ? confidenceText(r) : null
            const status = done ? STATUS_LABEL[r.status] : undefined
            return (
              <tr key={slug} data-testid={`summary-${slug}`}>
                <td className="px-4 py-2 font-medium">{BOT_NAMES[slug] ?? slug}</td>
                <td className="px-4 py-2">
                  {!included ? <span className="text-muted-foreground">Excluded</span>
                    : run.phase === 'idle' ? <span className="text-muted-foreground">Not run</span>
                    : run.phase === 'running' ? <span className="text-muted-foreground">Running…</span>
                    : <Badge tone={status?.tone ?? 'neutral'}>{status?.text ?? r?.status}</Badge>}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{done ? fmtDuration(r.duration_ms) : '—'}</td>
                <td className="px-4 py-2" data-testid={`summary-conf-${slug}`}>
                  {conf ? <><span className="font-semibold tabular-nums">{conf}</span>{r?.confidence_kind ? <div className="max-w-[16rem] truncate text-xs text-muted-foreground" title={r.confidence_kind}>{r.confidence_kind}</div> : null}</> : '—'}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{done && r.status === 'ok' ? (r.data_sources?.length ?? 0) : '—'}</td>
                <td className="px-4 py-2">{done && r.status === 'ok' ? (r.action_executed ? 'Yes' : isAwaitingApproval(r) ? 'No (awaiting approval)' : 'No') : '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
