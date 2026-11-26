import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/auth/AuthContext'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { DataTable, type Column } from '@/components/DataTable'
import { ListCard } from '@/components/ListToolbar'
import { PageHeader } from '@/components/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Select } from '@/components/ui/input'
import { useCreateShortagePOs, useShortages, useWarehouses } from '@/hooks/api'
import { ACTION_LABEL, ACTION_TONE, OWNERSHIP_LABEL, OWNERSHIP_TONE, breakOptionText } from '@/lib/distribution'
import { fmtMoney, fmtNumber } from '@/lib/format'
import type { Shortage, ShortagePOResult } from '@/lib/types'

export function ReplenishmentPage() {
  const { can } = useAuth()
  const [warehouseId, setWarehouseId] = useState('')
  const [takeBreaks, setTakeBreaks] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [result, setResult] = useState<ShortagePOResult | null>(null)
  const { data: warehouses } = useWarehouses()
  const { data, isLoading, error, refetch } = useShortages(warehouseId || undefined, takeBreaks)
  const create = useCreateShortagePOs()
  const wh = warehouses?.find((w) => w.id === warehouseId)
  const customerOwned = wh?.ownership_type === 'customer'
  const actionable = (data ?? []).filter((r) => r.action === 'purchase' || r.action === 'consignment').length

  const run = () => create.mutate({ warehouse_id: warehouseId, take_price_breaks: takeBreaks }, {
    onSuccess: (r) => { setResult(r); setConfirm(false) }, onError: () => setConfirm(false),
  })

  const columns: Column<Shortage>[] = [
    { key: 'product', header: 'Product', cell: (r) => <div><div className="font-medium">{r.product_name}</div><div className="font-mono text-xs text-muted-foreground">{r.sku}</div></div> },
    { key: 'wh', header: 'Warehouse', cell: (r) => <div>{r.warehouse}<div><Badge tone={OWNERSHIP_TONE[r.ownership_type]}>{OWNERSHIP_LABEL[r.ownership_type]}</Badge></div></div> },
    { key: 'action', header: 'Action', cell: (r) => <div className="max-w-xs"><Badge tone={ACTION_TONE[r.action]}>{ACTION_LABEL[r.action]}</Badge>{r.reason && <p className="mt-1 text-xs text-muted-foreground">{r.reason}</p>}</div> },
    { key: 'needed', header: 'Needed', align: 'right', cell: (r) => fmtNumber(r.needed_quantity) },
    { key: 'qty', header: 'Order qty', align: 'right', cell: (r) => (r.action === 'purchase' || r.action === 'consignment' ? <strong>{fmtNumber(r.quantity)}</strong> : '—') },
    { key: 'price', header: 'Unit price', align: 'right', cell: (r) => fmtMoney(r.unit_price) },
    { key: 'total', header: 'Line total', align: 'right', cell: (r) => fmtMoney(r.line_total) },
    {
      key: 'break', header: 'Price break', cell: (r) => r.break_applied
        ? <Badge tone="green">Break applied</Badge>
        : r.break_option ? <span className="text-xs text-muted-foreground">{breakOptionText(r.break_option)}{r.break_option.cheaper_in_total ? ' — cheaper in total' : ''}</span> : <span className="text-muted-foreground">—</span>,
    },
  ]

  return (
    <>
      <PageHeader title="Replenishment" description="Warehouse shortages, who owns the stock, and the purchase orders that fix them." />
      {result && (
        <Card className="mb-4 border-emerald-300"><CardContent className="space-y-3">
          <h2 className="font-semibold">Created {result.created.length} draft purchase order{result.created.length === 1 ? "" : "s"}</h2>
          {result.created.length === 0 ? <p className="text-sm text-muted-foreground">No purchase orders were created.</p> : (
            <ul className="max-h-48 space-y-1 overflow-y-auto text-sm">
              {result.created.map((c) => (
                <li key={c.id}><Link className="font-medium text-primary hover:underline" to="/purchase-orders">{c.po_number}</Link> · {c.supplier_name} · {c.lines} line{c.lines === 1 ? '' : 's'} · {fmtMoney(c.total_amount)}
                  {c.order_type === 'consignment' && <Badge tone="purple" className="ml-2">Consignment</Badge>}</li>
              ))}
            </ul>
          )}
          {result.skipped.length > 0 && (
            <div><p className="text-sm font-medium">Skipped ({result.skipped.length})</p>
              <ul className="mt-1 space-y-1 text-xs text-muted-foreground">{result.skipped.slice(0, 5).map((s) => <li key={s.sku}><span className="font-mono">{s.sku}</span> — {s.reason}</li>)}
                {result.skipped.length > 5 && <li>…and {result.skipped.length - 5} more</li>}</ul></div>
          )}
        </CardContent></Card>
      )}

      <ListCard filters={<>
        <Select aria-label="Warehouse filter" className="w-full sm:w-64" value={warehouseId} onChange={(e) => { setWarehouseId(e.target.value); setResult(null) }}>
          <option value="">All warehouses</option>{warehouses?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </Select>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-blue-600" checked={takeBreaks} onChange={(e) => setTakeBreaks(e.target.checked)} /> Take price breaks</label>
        {can('po:write') && warehouseId && !customerOwned && (
          <Button className="ml-auto" disabled={actionable === 0 || create.isPending} onClick={() => setConfirm(true)}>Create POs for this warehouse</Button>
        )}
      </>}>
        {customerOwned && (
          <p className="border-b bg-amber-50 px-4 py-3 text-sm text-amber-900">
            This warehouse holds stock owned by <strong>{wh?.owner_name}</strong>. We cannot raise purchase orders for it — shortages are flagged so the customer can replenish.
          </p>
        )}
        {!warehouseId && can('po:write') && <p className="border-b px-4 py-2 text-xs text-muted-foreground">Select a single warehouse to create purchase orders for it.</p>}
        <DataTable columns={columns} rows={data} rowKey={(r) => `${r.product_id}-${r.warehouse_id}`} loading={isLoading} error={error} onRetry={() => void refetch()}
          emptyTitle="No shortages" emptyDescription="Stock levels are healthy for the selected warehouse." />
      </ListCard>

      <ConfirmDialog open={confirm} onOpenChange={setConfirm} title="Create purchase orders?" loading={create.isPending} confirmLabel="Create draft POs" onConfirm={run}
        description={<>Creates draft purchase orders at {wh?.name} for {actionable} shortage line{actionable === 1 ? '' : 's'}, grouped by supplier{takeBreaks ? ', buying up to the next price break where offered' : ''}. Drafts still need approval before they are sent.</>} />
    </>
  )
}
