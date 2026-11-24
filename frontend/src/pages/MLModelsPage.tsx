import { Loader2, RefreshCw, Send } from 'lucide-react'
import { useState } from 'react'
import { Can } from '@/auth/Can'
import { Probabilities } from '@/components/chat/ResponseDetails'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { DataTable, type Column } from '@/components/DataTable'
import { ErrorState } from '@/components/ErrorState'
import { ModelCard } from '@/components/ml/MLMetrics'
import { PageHeader } from '@/components/PageHeader'
import { CardSkeleton } from '@/components/Skeletons'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, Textarea } from '@/components/ui/input'
import { useClassify, useMLModels, useStockoutRisk, useTrainModels } from '@/hooks/api'
import { fmtDateTime, fmtNumber, fmtPercent, titleCase } from '@/lib/format'
import type { MLModel, StockoutItem } from '@/lib/types'

const SAMPLE = 'The shipment arrived two weeks late again'

function TryClassifier() {
  const [text, setText] = useState(SAMPLE)
  const classify = useClassify()
  const r = classify.data
  return (
    <Card>
      <CardHeader><CardTitle>Try it: classify a supplier message</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <Textarea aria-label="Message to classify" rows={3} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} />
        <Button onClick={() => classify.mutate(text.trim())} disabled={!text.trim() || classify.isPending}>{classify.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Classify</Button>
        {classify.error && <p role="alert" className="text-sm text-destructive">{classify.error.message}</p>}
        {r && (
          <div className="space-y-2 rounded-md border bg-muted/30 p-3" data-testid="classify-result">
            <div className="flex flex-wrap items-center gap-2"><Badge tone="green">{titleCase(r.label)}</Badge><span className="text-sm">confidence <strong className="tabular-nums">{fmtPercent(r.confidence)}</strong> <span className="text-muted-foreground">(model class probability)</span></span></div>
            <Probabilities probs={r.probabilities} />
            <p className="text-xs text-muted-foreground">Model: <span className="font-mono">{r.model}</span></p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function StockoutTable() {
  const [limit, setLimit] = useState(10)
  const [threshold, setThreshold] = useState(0.5)
  const { data, isLoading, error, refetch } = useStockoutRisk(limit, threshold)
  const columns: Column<StockoutItem>[] = [
    { key: 'sku', header: 'SKU', cell: (i) => <span className="font-mono text-xs">{i.sku}</span> },
    { key: 'name', header: 'Product', cell: (i) => i.product_name },
    { key: 'wh', header: 'Warehouse', cell: (i) => i.warehouse },
    { key: 'risk', header: 'Risk', align: 'right', cell: (i) => <Badge tone={i.risk_probability >= 0.8 ? 'red' : 'amber'}>{fmtPercent(i.risk_probability)}</Badge> },
    { key: 'avail', header: 'Available', align: 'right', cell: (i) => fmtNumber(i.available) },
    { key: 'proj', header: 'Projected', align: 'right', cell: (i) => fmtNumber(i.projected) },
    { key: 'dem', header: 'Pred. daily demand', align: 'right', cell: (i) => i.predicted_daily_demand.toFixed(2) },
    { key: 'lt', header: 'Lead time (d)', align: 'right', cell: (i) => i.lead_time_days ?? '—' },
    { key: 'rep', header: 'Suggested replenishment', align: 'right', cell: (i) => fmtNumber(i.suggested_replenishment) },
  ]
  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex-wrap">
        <div><CardTitle>Stockout risk scan (live inventory)</CardTitle>
          {data && <p className="mt-1 text-xs text-muted-foreground">{fmtNumber(data.flagged)} of {fmtNumber(data.scanned)} stock records flagged at threshold {data.threshold}. Models: {data.models.join(', ')}</p>}</div>
        <div className="flex items-center gap-2">
          <Select aria-label="Rows to show" className="h-8 w-auto" value={limit} onChange={(e) => setLimit(Number(e.target.value))}>{[10, 25, 50].map((n) => <option key={n} value={n}>Top {n}</option>)}</Select>
          <Select aria-label="Risk threshold" className="h-8 w-auto" value={threshold} onChange={(e) => setThreshold(Number(e.target.value))}>{[0.3, 0.5, 0.7, 0.9].map((n) => <option key={n} value={n}>Threshold {n}</option>)}</Select>
        </div>
      </CardHeader>
      <DataTable columns={columns} rows={data?.items} rowKey={(i) => `${i.sku}-${i.warehouse}`} loading={isLoading} error={error} onRetry={() => void refetch()} emptyTitle="No stock records above the threshold" />
    </Card>
  )
}

export function MLModelsPage() {
  const { data, isLoading, error, refetch } = useMLModels()
  const train = useTrainModels()
  const [confirm, setConfirm] = useState(false)
  const active = data?.filter((m) => m.is_active) ?? []
  const historyCols: Column<MLModel>[] = [
    { key: 'name', header: 'Model', cell: (m) => titleCase(m.name) },
    { key: 'version', header: 'Version', cell: (m) => <span className="font-mono text-xs">{m.version}</span> },
    { key: 'algo', header: 'Algorithm', cell: (m) => m.algorithm },
    { key: 'rows', header: 'Training rows', align: 'right', cell: (m) => fmtNumber(m.training_rows) },
    { key: 'at', header: 'Trained at', cell: (m) => fmtDateTime(m.trained_at) },
    { key: 'active', header: 'State', cell: (m) => <Badge tone={m.is_active ? 'green' : 'neutral'}>{m.is_active ? 'Active' : 'Superseded'}</Badge> },
  ]
  return (
    <>
      <PageHeader title="ML Models" description="Versioned scikit-learn models with their real evaluation metrics, trained on synthetic demo data."
        actions={<Can permission="ml:train"><Button variant="outline" onClick={() => setConfirm(true)} disabled={train.isPending}>{train.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}{train.isPending ? 'Training…' : 'Retrain models'}</Button></Can>} />
      {train.isPending && <div role="status" className="mb-4 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">Training new model versions. This can take a little while; the list refreshes automatically.</div>}
      <div className="space-y-6">
        {error && !data ? <Card><ErrorState error={error} onRetry={() => void refetch()} /></Card>
          : isLoading ? <><CardSkeleton /><CardSkeleton /></>
          : !active.length ? <Card><ErrorState title="No active models" error={new Error('No trained models are registered. A user with ml:train can retrain them.')} /></Card>
          : active.map((m) => <ModelCard key={m.id} model={m} />)}
        <div className="grid gap-4 xl:grid-cols-[28rem_1fr]">
          <TryClassifier />
          <StockoutTable />
        </div>
        <Card className="overflow-hidden">
          <CardHeader><CardTitle>Version history</CardTitle></CardHeader>
          <DataTable columns={historyCols} rows={data} rowKey={(m) => m.id} loading={isLoading} error={error} onRetry={() => void refetch()} emptyTitle="No registry entries" />
        </Card>
      </div>
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} title="Retrain all models?" confirmLabel="Retrain" loading={train.isPending}
        description="This trains new versions of the message classifier, demand forecaster and stockout-risk model on the current (synthetic) data. Existing versions are kept in the history, and the new versions become active. Chatbot answers that use these models will change."
        onConfirm={() => train.mutate(undefined, { onSettled: () => setConfirm(false) })} />
    </>
  )
}
