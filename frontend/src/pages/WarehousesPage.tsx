import { ErrorState } from '@/components/ErrorState'
import { PageHeader } from '@/components/PageHeader'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { useOwnershipSummary, useWarehouses } from '@/hooks/api'
import { OWNERSHIP_LABEL, OWNERSHIP_TONE } from '@/lib/distribution'
import { fmtNumber } from '@/lib/format'
import type { Ownership } from '@/lib/types'

const EXPLAIN: Record<Ownership, string> = {
  self: 'We own this stock. Shortages are replenished with normal purchase orders to the best supplier.',
  vendor: 'Consignment: the vendor owns the stock while it sits here. Only that vendor can replenish it; the cost is incurred when the stock is used, not on receipt.',
  customer: 'Held on behalf of a customer. It is their property, so we cannot buy it — a shortage is flagged for the customer to replenish.',
}

export function WarehousesPage() {
  const { data, isLoading, error, refetch } = useWarehouses()
  const summary = useOwnershipSummary()
  return (
    <>
      <PageHeader title="Warehouses" description="Where stock is held and who owns it." />
      <Card className="mb-4"><CardContent className="grid gap-3 text-sm md:grid-cols-3">
        {(['self', 'vendor', 'customer'] as Ownership[]).map((o) => (
          <div key={o}><Badge tone={OWNERSHIP_TONE[o]}>{OWNERSHIP_LABEL[o]}</Badge><p className="mt-1 text-muted-foreground">{EXPLAIN[o]}</p></div>
        ))}
      </CardContent></Card>
      {error ? <Card><ErrorState error={error} onRetry={() => void refetch()} /></Card> : isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-32 w-full" />)}</div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {data?.map((w) => {
            const o = w.ownership_type ?? 'self'
            const s = summary.data?.[w.id]
            return (
              <Card key={w.id}><CardContent className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div><h2 className="font-semibold">{w.name}</h2><p className="text-xs text-muted-foreground">{w.code} · {w.location}</p></div>
                  <Badge tone={OWNERSHIP_TONE[o]}>{OWNERSHIP_LABEL[o]}</Badge>
                </div>
                <p className="text-sm">Owner: <strong>{w.owner_name ?? 'Own stock'}</strong></p>
                <p className="text-sm text-muted-foreground">{s ? `${fmtNumber(s.skus)} SKUs · ${fmtNumber(s.units_on_hand)} units on hand` : summary.isLoading ? 'Loading stock…' : 'Stock summary unavailable'}</p>
              </CardContent></Card>
            )
          })}
        </div>
      )}
    </>
  )
}
