import { AlertTriangle } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { fmtDateTime, fmtNumber, titleCase } from '@/lib/format'
import type { MLMetrics, MLModel } from '@/lib/types'

const f3 = (v: number | undefined) => (v === undefined || v === null ? '—' : v.toFixed(3))

export function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-md border bg-card p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </div>
  )
}

/** Caveats and training-data provenance are ALWAYS rendered, whatever else the metrics contain. */
export function Caveats({ metrics }: { metrics: MLMetrics | null }) {
  const caveats = metrics?.caveats ?? []
  return (
    <div role="note" data-testid="ml-caveats" className="rounded-md border-2 border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      <div className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" />Caveats: read before trusting these numbers</div>
      {caveats.length ? <ul className="mt-1 list-disc space-y-0.5 pl-5">{caveats.map((c, i) => <li key={i}>{c}</li>)}</ul>
        : <p className="mt-1">No caveats were recorded for this registry entry. All ProcuraX AI data is synthetic demo data, so treat every metric as illustrative.</p>}
      {metrics?.training_stock_source && <p className="mt-2"><strong>Training stock source:</strong> {metrics.training_stock_source}</p>}
    </div>
  )
}

export function ConfusionMatrix({ matrix, labels, title = 'Confusion matrix' }: { matrix: number[][]; labels: string[]; title?: string }) {
  const max = Math.max(1, ...matrix.flat())
  return (
    <div>
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title} <span className="font-normal normal-case">(rows = actual, columns = predicted)</span></div>
      <div className="overflow-x-auto">
        <table className="text-xs" aria-label={title}>
          <thead><tr><th />{labels.map((l) => <th key={l} className="max-w-[6rem] px-1 pb-1 text-center font-medium text-muted-foreground" title={l}><span className="block truncate">{l.replace(/_/g, ' ')}</span></th>)}</tr></thead>
          <tbody>
            {matrix.map((row, i) => (
              <tr key={i}>
                <th className="max-w-[8rem] truncate pr-2 text-right font-medium text-muted-foreground" title={labels[i]}>{(labels[i] ?? `#${i}`).replace(/_/g, ' ')}</th>
                {row.map((v, j) => (
                  <td key={j} className="h-9 w-14 border border-white text-center tabular-nums"
                    style={{ backgroundColor: `rgba(37, 99, 235, ${(v / max) * 0.85})`, color: v / max > 0.5 ? '#fff' : undefined }}>{v}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ClassifierMetrics({ m }: { m: MLMetrics }) {
  const per = Object.entries(m.per_class ?? {})
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Accuracy" value={f3(m.accuracy)} hint={`hold-out, ${m.test_rows ?? '?'} rows`} />
        <Metric label="Macro F1" value={f3(m.macro_f1)} />
        <Metric label="CV macro F1" value={f3(m.cv_macro_f1_mean)} hint={m.cv_macro_f1_std !== undefined ? `± ${f3(m.cv_macro_f1_std)} std` : undefined} />
        <Metric label="Train / test rows" value={`${m.train_rows ?? '—'} / ${m.test_rows ?? '—'}`} />
      </div>
      {per.length > 0 && (
        <div className="overflow-x-auto rounded border">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-3 py-2">Class</th><th className="px-3 py-2 text-right">Precision</th><th className="px-3 py-2 text-right">Recall</th><th className="px-3 py-2 text-right">F1</th><th className="px-3 py-2 text-right">Support</th></tr></thead>
            <tbody className="divide-y">{per.map(([k, v]) => (
              <tr key={k}><td className="px-3 py-1.5">{titleCase(k)}</td><td className="px-3 py-1.5 text-right tabular-nums">{f3(v.precision)}</td><td className="px-3 py-1.5 text-right tabular-nums">{f3(v.recall)}</td><td className="px-3 py-1.5 text-right tabular-nums">{f3(v['f1-score'])}</td><td className="px-3 py-1.5 text-right tabular-nums">{v.support}</td></tr>))}</tbody>
          </table>
        </div>
      )}
      {m.confusion_matrix && <ConfusionMatrix matrix={m.confusion_matrix} labels={m.labels ?? per.map(([k]) => k)} />}
    </div>
  )
}

function StockoutMetrics({ m }: { m: MLMetrics }) {
  const b = m.baseline_naive_cover_rule
  const fi = Object.entries(m.feature_importance ?? {}).sort((a, c) => c[1] - a[1]).map(([name, value]) => ({ name, value }))
  const rows: [string, number | undefined, number | undefined][] = [['Precision', m.precision, b?.precision], ['Recall', m.recall, b?.recall], ['F1', m.f1, b?.f1], ['Accuracy', m.accuracy, b?.accuracy]]
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Precision" value={f3(m.precision)} /><Metric label="Recall" value={f3(m.recall)} /><Metric label="F1" value={f3(m.f1)} /><Metric label="ROC-AUC" value={f3(m.roc_auc)} />
      </div>
      {b && (
        <div className="overflow-x-auto rounded border">
          <table className="w-full text-sm" aria-label="Model versus baseline">
            <thead className="bg-muted/60 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-3 py-2">Metric</th><th className="px-3 py-2 text-right">Model</th><th className="px-3 py-2 text-right">Naive cover-rule baseline</th></tr></thead>
            <tbody className="divide-y">{rows.map(([k, a, c]) => <tr key={k}><td className="px-3 py-1.5">{k}</td><td className="px-3 py-1.5 text-right tabular-nums">{f3(a)}</td><td className="px-3 py-1.5 text-right tabular-nums">{f3(c)}</td></tr>)}</tbody>
          </table>
          {m.f1 !== undefined && b.f1 > m.f1 && <p className="border-t bg-muted/30 px-3 py-2 text-xs text-muted-foreground">Note: the simple baseline rule scores a higher F1 than the model on this synthetic hold-out. The model is not shown to beat it.</p>}
        </div>
      )}
      {m.confusion_matrix && <ConfusionMatrix matrix={m.confusion_matrix} labels={['not at risk', 'at risk']} />}
      {fi.length > 0 && (
        <div>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Feature importance</div>
          <div className="h-64 w-full" role="img" aria-label="Feature importance bar chart">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={fi} layout="vertical" margin={{ left: 16, right: 16 }}>
                <CartesianGrid horizontal={false} strokeDasharray="3 3" />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="name" width={80} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => (typeof v === 'number' ? v.toFixed(4) : String(v))} />
                <Bar dataKey="value" fill="#2563eb" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  )
}

function ForecasterMetrics({ m }: { m: MLMetrics }) {
  const rows: [string, number | undefined][] = [['Model (gradient boosting)', m.mae], ['Baseline: last month', m.baseline_mae_last_month], ['Baseline: 3-month mean', m.baseline_mae_3mo_mean]]
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="MAE" value={f3(m.mae)} hint="lower is better" /><Metric label="R²" value={f3(m.r2)} />
        <Metric label="Train / test rows" value={`${m.train_rows ?? '—'} / ${m.test_rows ?? '—'}`} />
      </div>
      <div className="overflow-x-auto rounded border">
        <table className="w-full text-sm" aria-label="MAE versus baselines">
          <thead className="bg-muted/60 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-3 py-2">Predictor</th><th className="px-3 py-2 text-right">MAE (lower is better)</th></tr></thead>
          <tbody className="divide-y">{rows.map(([k, v]) => <tr key={k}><td className="px-3 py-1.5">{k}</td><td className="px-3 py-1.5 text-right tabular-nums">{f3(v)}</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  )
}

function GenericMetrics({ m }: { m: MLMetrics }) {
  const scalars = Object.entries(m).filter(([, v]) => typeof v === 'number') as [string, number][]
  if (!scalars.length) return <p className="text-sm text-muted-foreground">No numeric metrics recorded.</p>
  return <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{scalars.map(([k, v]) => <Metric key={k} label={titleCase(k)} value={f3(v)} />)}</div>
}

export function ModelCard({ model }: { model: MLModel }) {
  const m = model.metrics
  return (
    <Card className="space-y-4 p-5" data-testid={`model-card-${model.name}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">{titleCase(model.name)}</h2>
          {m?.task && <p className="text-sm text-muted-foreground">{titleCase(m.task)}{m.split ? ` · split: ${m.split}` : ''}</p>}
        </div>
        <Badge tone="green">Active</Badge>
      </div>
      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div><dt className="text-xs uppercase text-muted-foreground">Version</dt><dd className="font-mono text-xs">{model.version}</dd></div>
        <div><dt className="text-xs uppercase text-muted-foreground">Algorithm</dt><dd>{model.algorithm}</dd></div>
        <div><dt className="text-xs uppercase text-muted-foreground">Training rows</dt><dd>{fmtNumber(model.training_rows)}</dd></div>
        <div><dt className="text-xs uppercase text-muted-foreground">Trained at</dt><dd>{fmtDateTime(model.trained_at)}</dd></div>
      </dl>
      <Caveats metrics={m} />
      {m && (model.name === 'message_classifier' ? <ClassifierMetrics m={m} /> : model.name === 'stockout_risk' ? <StockoutMetrics m={m} /> : model.name === 'demand_forecaster' ? <ForecasterMetrics m={m} /> : <GenericMetrics m={m} />)}
    </Card>
  )
}
