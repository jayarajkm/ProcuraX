import { Loader2, Sparkles } from 'lucide-react'
import { Link } from 'react-router-dom'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/ErrorState'
import { Badge, type BadgeTone } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useInsights, useInsightsNarrative } from '@/hooks/api'
import type { InsightItem, InsightNarrative } from '@/lib/types'

const SEVERITY: Record<string, BadgeTone> = { high: 'red', medium: 'amber', low: 'blue' }

export function InsightList({ items }: { items: InsightItem[] }) {
  if (items.length === 0) return <EmptyState title="No notable issues" description="The deterministic rules found nothing to flag right now." />
  return (
    <ul className="divide-y">
      {items.map((i, idx) => (
        <li key={`${i.title}-${idx}`} className="flex flex-col gap-1 px-5 py-3 text-sm sm:flex-row sm:items-start sm:gap-3">
          <Badge tone={SEVERITY[i.severity] ?? 'neutral'} className="w-fit shrink-0 uppercase">{i.severity}</Badge>
          <div className="min-w-0 flex-1">
            <div className="font-medium">{i.title}</div>
            <p className="text-muted-foreground">{i.detail}</p>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span>Source: <span className="font-mono">{i.source}</span></span>
              {i.link && <Link to={i.link} className="font-medium text-primary hover:underline">View details</Link>}
            </div>
          </div>
        </li>
      ))}
    </ul>
  )
}

export function NarrativeBlock({ narrative }: { narrative: InsightNarrative }) {
  if (narrative.text) {
    return (
      <div className="rounded-md border border-violet-200 bg-violet-50 p-3 text-sm text-violet-950" data-testid="narrative-text">
        <p>{narrative.text}</p>
        {narrative.model && <p className="mt-1 text-xs text-violet-700">Written by {narrative.model}</p>}
      </div>
    )
  }
  return <p role="note" className="rounded-md bg-muted/60 p-3 text-sm text-muted-foreground" data-testid="narrative-reason">{narrative.reason ?? 'No narrative was produced.'}</p>
}

export function InsightsPanel() {
  const { data, isLoading, error, refetch } = useInsights()
  const gen = useInsightsNarrative()
  const narrative = gen.data?.narrative ?? null
  return (
    <Card className="mt-6 overflow-hidden">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle>Insights</CardTitle>
        <Button variant="outline" size="sm" onClick={() => gen.mutate()} disabled={gen.isPending || isLoading}>
          {gen.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}Generate narrative summary
        </Button>
      </CardHeader>
      <p className="px-5 pb-3 text-xs text-muted-foreground">
        The insight list is computed from the database by deterministic rules. The narrative summary is written by an LLM from those same facts, only when you click the button.
      </p>
      {(gen.isPending || narrative || gen.error) && (
        <CardContent>
          {gen.isPending ? <p role="status" className="text-sm text-muted-foreground">Asking the LLM provider… this can take several seconds.</p>
            : gen.error ? <p role="alert" className="text-sm text-destructive">{gen.error.message}</p>
            : narrative ? <NarrativeBlock narrative={narrative} /> : null}
        </CardContent>
      )}
      <div className="border-t">
        {isLoading ? <CardContent className="pt-4"><Skeleton className="h-24" /></CardContent>
          : error && !data ? <ErrorState error={error} onRetry={() => void refetch()} title="Could not load insights" />
          : <InsightList items={data?.items ?? []} />}
      </div>
      {data && <p className="border-t px-5 py-2 text-xs text-muted-foreground">Generated from: {data.generated_from}</p>}
    </Card>
  )
}
