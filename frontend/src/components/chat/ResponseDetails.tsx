import { CheckCircle2, ChevronDown, FileText } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { fmtPercent } from '@/lib/format'
import type { ChatMetadata } from '@/lib/types'
import { TranslationSection } from './TranslationInfo'

export function SimilarityBar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(1, value)) * 100
  return (
    <div className="flex items-center gap-2" role="meter" aria-label="Similarity" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} /></div>
      <span className="text-xs tabular-nums text-muted-foreground">{value.toFixed(3)}</span>
    </div>
  )
}

export function Probabilities({ probs }: { probs: Record<string, number> }) {
  const entries = Object.entries(probs).sort((a, b) => b[1] - a[1])
  return (
    <ul className="space-y-1" aria-label="Class probabilities">
      {entries.map(([label, p], i) => (
        <li key={label} className="grid grid-cols-[10rem_1fr_3rem] items-center gap-2 text-xs">
          <span className={i === 0 ? 'truncate font-medium' : 'truncate text-muted-foreground'}>{label.replace(/_/g, ' ')}</span>
          <div className="h-2 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${i === 0 ? 'bg-emerald-500' : 'bg-slate-400'}`} style={{ width: `${p * 100}%` }} /></div>
          <span className="text-right tabular-nums">{fmtPercent(p)}</span>
        </li>
      ))}
    </ul>
  )
}

const hasContent = (m: ChatMetadata) =>
  !!(m.approach || m.data_sources?.length || m.steps?.length || m.confidence != null || m.retrieval?.length || m.table || m.action_executed || m.extra?.probabilities || m.extra?.model || (m.language && m.language !== 'en' && m.translation))

/**
 * Collapsible "Response details" for one assistant message. Renders only what the backend sent:
 * confidence appears only when present (never invented) and always with its kind.
 */
export function ResponseDetails({ metadata, defaultOpen = false }: { metadata: ChatMetadata | null | undefined; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  if (!metadata || !hasContent(metadata)) return null
  const m = metadata
  return (
    <div dir="ltr" className="mt-2 rounded-md border bg-muted/30 text-xs">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between gap-2 px-3 py-1.5 font-medium text-muted-foreground hover:text-foreground">
        <span className="flex flex-wrap items-center gap-2">
          Response details
          {m.action_executed && <Badge tone="green"><CheckCircle2 className="h-3 w-3" />Action executed</Badge>}
        </span>
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="space-y-3 border-t px-3 py-3">
          <TranslationSection language={m.language} translation={m.translation} />
          {m.approach && <Section title="Approach"><p>{m.approach}</p></Section>}
          {m.confidence != null && (
            <Section title="Confidence">
              <p><span className="font-semibold tabular-nums">{(m.confidence * 100).toFixed(1)}%</span>{m.confidence_kind ? <span className="text-muted-foreground"> — {m.confidence_kind}</span> : null}</p>
            </Section>
          )}
          {m.extra?.model && <Section title="Model"><p className="font-mono">{String(m.extra.model)}</p></Section>}
          {m.extra?.probabilities && <Section title="Class probabilities"><Probabilities probs={m.extra.probabilities} /></Section>}
          {!!m.data_sources?.length && (
            <Section title="Data sources"><div className="flex flex-wrap gap-1">{m.data_sources.map((s) => <Badge key={s} tone="blue">{s}</Badge>)}</div></Section>
          )}
          {!!m.steps?.length && <Section title="Steps"><ol className="list-decimal space-y-0.5 pl-4">{m.steps.map((s, i) => <li key={i}>{s}</li>)}</ol></Section>}
          {!!m.retrieval?.length && (
            <Section title={`Sources (${m.retrieval.length})`}>
              <ul className="space-y-2">
                {m.retrieval.map((c, i) => (
                  <li key={i} className="rounded border bg-card p-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 font-medium"><FileText className="h-3.5 w-3.5 text-muted-foreground" />[{c.ref ?? i + 1}] {c.document ?? 'Document'}{c.ref != null && (m.extra?.cited_refs as number[] | undefined)?.includes(c.ref) ? <Badge tone="green" className="ml-1">cited in answer</Badge> : null}{c.page != null ? <span className="font-normal text-muted-foreground"> · page {c.page}</span> : null}</span>
                      {c.similarity != null && <SimilarityBar value={c.similarity} />}
                    </div>
                    {c.excerpt && <p className="mt-1 text-muted-foreground">“{c.excerpt}”</p>}
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {m.table && (
            <Section title="Result table">
              <div className="overflow-x-auto rounded border bg-card">
                <table className="w-full">
                  <thead className="bg-muted/60 text-left text-muted-foreground"><tr>{m.table.columns.map((c) => <th key={c} className="whitespace-nowrap px-2 py-1 font-medium">{c}</th>)}</tr></thead>
                  <tbody className="divide-y">{m.table.rows.map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j} className="px-2 py-1">{v == null ? '—' : String(v)}</td>)}</tr>)}</tbody>
                </table>
              </div>
            </Section>
          )}
        </div>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <div><div className="mb-1 font-semibold uppercase tracking-wide text-[10px] text-muted-foreground">{title}</div>{children}</div>
}
