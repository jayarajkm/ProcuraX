import { zodResolver } from '@hookform/resolvers/zod'
import { History, Info, SlidersHorizontal } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { z } from 'zod'
import { Can } from '@/auth/Can'
import { DataTable, type Column } from '@/components/DataTable'
import { Drawer } from '@/components/Drawer'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/ErrorState'
import { ListCard } from '@/components/ListToolbar'
import { PageHeader } from '@/components/PageHeader'
import { Pagination } from '@/components/Pagination'
import { SearchInput } from '@/components/SearchInput'
import { DetailSkeleton } from '@/components/Skeletons'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Input, Select } from '@/components/ui/input'
import { Field } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAdjustInventory, useCreateRequest, useInventory, useMovements, useReorder, useWarehouses } from '@/hooks/api'
import { useListState } from '@/hooks/useListState'
import { fmtDateTime, fmtMoney, fmtNumber, titleCase } from '@/lib/format'
import type { InventoryRow, Recommendation } from '@/lib/types'

const adjustSchema = z.object({
  quantity: z.string().refine((v) => /^-?\d+$/.test(v.trim()) && Number(v) !== 0, 'Enter a non-zero whole number (negative to remove stock)'),
  reason: z.string().trim().min(1, 'A reason is required').max(80, 'Max 80 characters'),
})
type AdjustForm = z.infer<typeof adjustSchema>

function AdjustDialog({ row, onClose }: { row: InventoryRow | null; onClose: () => void }) {
  const adjust = useAdjustInventory()
  const { register, handleSubmit, reset, watch, formState: { errors } } = useForm<AdjustForm>({ resolver: zodResolver(adjustSchema), defaultValues: { quantity: '', reason: '' } })
  useEffect(() => { if (row) reset({ quantity: '', reason: '' }) }, [row, reset])
  const delta = Number(watch('quantity'))
  const preview = row && Number.isFinite(delta) ? row.quantity_on_hand + delta : null
  const submit = handleSubmit(async (v) => {
    if (!row) return
    try { await adjust.mutateAsync({ id: row.id, quantity: Number(v.quantity), reason: v.reason.trim() }); onClose() } catch { /* toast by hook */ }
  })
  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && onClose()} title="Adjust quantity" className="max-w-md"
      description={row ? `${row.product_name} at ${row.warehouse}` : undefined}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={() => void submit()} disabled={adjust.isPending}>{adjust.isPending ? 'Saving…' : 'Apply adjustment'}</Button></>}>
      {row && (
        <form onSubmit={(e) => { e.preventDefault(); void submit() }} className="space-y-4">
          <p className="text-sm text-muted-foreground">On hand: <strong>{fmtNumber(row.quantity_on_hand)}</strong> · Reserved: <strong>{fmtNumber(row.quantity_reserved)}</strong>
            {preview !== null && delta !== 0 && <> · After adjustment: <strong>{fmtNumber(preview)}</strong></>}</p>
          <Field label="Quantity change" htmlFor="adj-qty" error={errors.quantity?.message} hint="Signed: +50 adds stock, -10 removes stock"><Input id="adj-qty" inputMode="numeric" {...register('quantity')} /></Field>
          <Field label="Reason" htmlFor="adj-reason" error={errors.reason?.message}><Input id="adj-reason" placeholder="e.g. Cycle count correction" {...register('reason')} /></Field>
        </form>
      )}
    </Dialog>
  )
}

function MovementsDrawer({ row, onClose }: { row: InventoryRow | null; onClose: () => void }) {
  const { data, isLoading, error, refetch } = useMovements(row?.id)
  return (
    <Drawer open={!!row} onOpenChange={(o) => !o && onClose()} title="Movement history" width="max-w-lg"
      subtitle={row && `${row.product_name} · ${row.warehouse}`}>
      {isLoading ? <DetailSkeleton /> : error ? <ErrorState error={error} onRetry={() => void refetch()} /> : !data?.length ? <EmptyState title="No movements recorded" /> : (
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-muted-foreground"><tr><th className="py-2 text-left">When</th><th className="py-2 text-left">Type</th><th className="py-2 text-right">Qty</th><th className="py-2 pl-3 text-left">Reference</th></tr></thead>
          <tbody className="divide-y">
            {data.map((m) => (
              <tr key={m.id}>
                <td className="py-2 pr-2 text-xs">{fmtDateTime(m.occurred_at)}</td><td className="py-2">{titleCase(m.movement_type)}</td>
                <td className={`py-2 text-right tabular-nums ${m.quantity < 0 ? 'text-destructive' : 'text-emerald-700'}`}>{m.quantity > 0 ? '+' : ''}{fmtNumber(m.quantity)}</td>
                <td className="py-2 pl-3 text-muted-foreground">{m.reference}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Drawer>
  )
}

function StockTab() {
  const ls = useListState({ warehouse_id: '', low_stock: '' })
  const params = { ...ls.params, sort: undefined, order: undefined, warehouse_id: ls.filters.warehouse_id || undefined, low_stock: ls.filters.low_stock === 'true' ? true : undefined }
  const { data, isLoading, error, refetch } = useInventory(params)
  const { data: warehouses } = useWarehouses()
  const [adjusting, setAdjusting] = useState<InventoryRow | null>(null)
  const [history, setHistory] = useState<InventoryRow | null>(null)

  const columns: Column<InventoryRow>[] = [
    { key: 'product', header: 'Product', cell: (r) => <div><div className="font-medium">{r.product_name}</div><div className="font-mono text-xs text-muted-foreground">{r.sku}</div></div> },
    { key: 'wh', header: 'Warehouse', cell: (r) => r.warehouse },
    { key: 'onhand', header: 'On hand', align: 'right', cell: (r) => fmtNumber(r.quantity_on_hand) },
    { key: 'avail', header: 'Available', align: 'right', cell: (r) => fmtNumber(r.available) },
    { key: 'proj', header: 'Projected', align: 'right', cell: (r) => fmtNumber(r.projected) },
    { key: 'cover', header: 'Days of cover', align: 'right', cell: (r) => (r.days_of_cover === null ? '—' : r.days_of_cover.toFixed(1)) },
    { key: 'reorder', header: 'Reorder lvl', align: 'right', cell: (r) => fmtNumber(r.reorder_level) },
    { key: 'status', header: 'Status', cell: (r) => (r.low_stock ? <Badge tone="red">Low stock</Badge> : <Badge tone="green">In stock</Badge>) },
    {
      key: 'actions', header: '', align: 'right', cell: (r) => (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="icon" aria-label={`Movement history for ${r.sku}`} title="Movement history" onClick={() => setHistory(r)}><History className="h-4 w-4" /></Button>
          <Can permission="inventory:write"><Button variant="ghost" size="icon" aria-label={`Adjust quantity for ${r.sku}`} title="Adjust quantity" onClick={() => setAdjusting(r)}><SlidersHorizontal className="h-4 w-4" /></Button></Can>
        </div>
      ),
    },
  ]
  return (
    <>
      <ListCard filters={<>
        <SearchInput value={ls.q} onChange={ls.setQ} placeholder="Search product or SKU" />
        <Select aria-label="Warehouse filter" className="w-full sm:w-52" value={ls.filters.warehouse_id} onChange={(e) => ls.setFilter('warehouse_id', e.target.value)}>
          <option value="">All warehouses</option>{warehouses?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </Select>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-blue-600" checked={ls.filters.low_stock === 'true'} onChange={(e) => ls.setFilter('low_stock', e.target.checked ? 'true' : '')} /> Low stock only</label>
      </>}>
        <DataTable columns={columns} rows={data?.items} rowKey={(r) => r.id} loading={isLoading} error={error} onRetry={() => void refetch()} emptyTitle="No inventory records" />
        {data && <Pagination page={data.page} pageSize={data.page_size} total={data.total} onPageChange={ls.setPage} onPageSizeChange={ls.setPageSize} />}
      </ListCard>
      <AdjustDialog row={adjusting} onClose={() => setAdjusting(null)} />
      <MovementsDrawer row={history} onClose={() => setHistory(null)} />
    </>
  )
}

function FormulaPopover() {
  return (
    <Popover>
      <PopoverTrigger asChild><Button variant="ghost" size="sm" aria-label="How recommendations are calculated"><Info className="h-4 w-4" /> Formula</Button></PopoverTrigger>
      <PopoverContent className="w-96">
        <p className="mb-2 font-medium">How recommendations are calculated</p>
        <ul className="space-y-1.5 font-mono text-xs">
          <li>available = on_hand − reserved</li>
          <li>projected = available + on_order</li>
          <li>days_of_cover = available / avg_daily_demand</li>
          <li>reorder qty = ceil(avg_daily_demand × (lead_time + review_days) + safety_stock − projected)</li>
        </ul>
      </PopoverContent>
    </Popover>
  )
}

function ReorderTab() {
  const [warehouseId, setWarehouseId] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const { data, isLoading, error, refetch } = useReorder(warehouseId || undefined)
  const { data: warehouses } = useWarehouses()
  const create = useCreateRequest(true)
  const navigate = useNavigate()
  const [pendingKey, setPendingKey] = useState<string | null>(null)

  const rows = data ?? []
  const pageRows = useMemo(() => rows.slice((page - 1) * pageSize, page * pageSize), [rows, page, pageSize])
  const keyOf = (r: Recommendation) => `${r.product_id}-${r.warehouse}`

  const createRequest = (r: Recommendation) => {
    setPendingKey(keyOf(r))
    create.mutate({
      justification: `Reorder recommendation: ${r.product_name} at ${r.warehouse} (available ${r.available}, projected ${r.projected}).`,
      priority: 'medium',
      lines: [{ product_id: r.product_id, quantity: r.suggested_quantity, suggested_supplier_id: r.supplier_id }],
    }, {
      onSuccess: (req) => toast.success(`Draft request ${req.request_number} created`, { action: { label: 'View request', onClick: () => navigate(`/requests?open=${req.id}`) } }),
      onSettled: () => setPendingKey(null),
    })
  }

  const columns: Column<Recommendation>[] = [
    { key: 'product', header: 'Product', cell: (r) => <div><div className="font-medium">{r.product_name}</div><div className="font-mono text-xs text-muted-foreground">{r.sku}</div></div> },
    { key: 'wh', header: 'Warehouse', cell: (r) => r.warehouse },
    { key: 'avail', header: 'Available', align: 'right', cell: (r) => fmtNumber(r.available) },
    { key: 'proj', header: 'Projected', align: 'right', cell: (r) => fmtNumber(r.projected) },
    { key: 'cover', header: 'Days of cover', align: 'right', cell: (r) => (r.days_of_cover === null ? '—' : r.days_of_cover.toFixed(1)) },
    { key: 'qty', header: 'Suggested qty', align: 'right', cell: (r) => <strong>{fmtNumber(r.suggested_quantity)}</strong> },
    { key: 'sup', header: 'Suggested supplier', cell: (r) => (r.supplier_name ? <div><div>{r.supplier_name}</div><div className="text-xs text-muted-foreground">{r.lead_time_days} d · {fmtMoney(r.unit_price)}</div></div> : <span className="text-muted-foreground">None on file</span>) },
    {
      key: 'actions', header: '', align: 'right', cell: (r) => (
        <Can permission="request:write">
          <Button size="sm" variant="outline" disabled={pendingKey === keyOf(r)} onClick={() => createRequest(r)}>{pendingKey === keyOf(r) ? 'Creating…' : 'Create purchase request'}</Button>
        </Can>
      ),
    },
  ]
  return (
    <ListCard filters={<>
      <Select aria-label="Warehouse filter" className="w-full sm:w-52" value={warehouseId} onChange={(e) => { setWarehouseId(e.target.value); setPage(1) }}>
        <option value="">All warehouses</option>{warehouses?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
      </Select>
      <FormulaPopover />
    </>}>
      <DataTable columns={columns} rows={data ? pageRows : undefined} rowKey={keyOf} loading={isLoading} error={error} onRetry={() => void refetch()}
        emptyTitle="No reorder recommendations" emptyDescription="Stock levels are healthy for the selected warehouse." />
      {data && <Pagination page={page} pageSize={pageSize} total={rows.length} onPageChange={setPage} onPageSizeChange={(n) => { setPageSize(n); setPage(1) }} />}
    </ListCard>
  )
}

export function InventoryPage() {
  return (
    <>
      <PageHeader title="Inventory" description="Stock positions by warehouse and replenishment guidance." />
      <Tabs defaultValue="stock">
        <TabsList><TabsTrigger value="stock">Stock</TabsTrigger><TabsTrigger value="reorder">Reorder recommendations</TabsTrigger></TabsList>
        <TabsContent value="stock"><StockTab /></TabsContent>
        <TabsContent value="reorder"><ReorderTab /></TabsContent>
      </Tabs>
    </>
  )
}
