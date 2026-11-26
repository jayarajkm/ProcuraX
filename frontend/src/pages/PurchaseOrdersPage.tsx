import { zodResolver } from '@hookform/resolvers/zod'
import { Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useFieldArray, useForm, useWatch } from 'react-hook-form'
import { z } from 'zod'
import { Can } from '@/auth/Can'
import { useAuth } from '@/auth/AuthContext'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { DataTable, type Column } from '@/components/DataTable'
import { Drawer } from '@/components/Drawer'
import { ErrorState } from '@/components/ErrorState'
import { ListCard } from '@/components/ListToolbar'
import { PageHeader } from '@/components/PageHeader'
import { Pagination } from '@/components/Pagination'
import { SearchInput } from '@/components/SearchInput'
import { KeyValue } from '@/components/Sections'
import { DetailSkeleton } from '@/components/Skeletons'
import { StatusBadge } from '@/components/StatusBadge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Input, Select } from '@/components/ui/input'
import { Field } from '@/components/ui/label'
import { useChangePOStatus, useCreatePO, usePO, usePOs, useProductLookup, useSupplierLookup, useSupplierProducts, useWarehouseLookup } from '@/hooks/api'
import { useListState } from '@/hooks/useListState'
import { fmtDate, fmtDateTime, fmtMoney, fmtNumber } from '@/lib/format'
import type { PO } from '@/lib/types'
import { allowedTransitions, PO_STATUSES, TRANSITION_LABEL } from './purchaseOrderRules'
import { titleCase } from '@/lib/format'

const poSchema = z.object({
  supplier_id: z.string().min(1, 'Choose a supplier'),
  warehouse_id: z.string().min(1, 'Choose a warehouse'),
  expected_delivery_date: z.string(),
  lines: z.array(z.object({
    product_id: z.string().min(1, 'Choose a product'),
    quantity: z.string().refine((v) => /^\d+$/.test(v) && Number(v) > 0, 'Whole number above 0'),
  })).min(1, 'Add at least one line'),
})
type POForm = z.infer<typeof poSchema>
const TAX_RATE_ESTIMATE = 0.1 // display-only estimate; the server computes the authoritative totals

function CreatePODialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const suppliers = useSupplierLookup()
  const warehouses = useWarehouseLookup()
  const create = useCreatePO()
  const { register, control, handleSubmit, reset, setValue, formState: { errors } } = useForm<POForm>({
    resolver: zodResolver(poSchema), defaultValues: { supplier_id: '', warehouse_id: '', expected_delivery_date: '', lines: [{ product_id: '', quantity: '1' }] },
  })
  const { fields, append, remove } = useFieldArray({ control, name: 'lines' })
  const supplierId = useWatch({ control, name: 'supplier_id' })
  const lines = useWatch({ control, name: 'lines' })
  const offered = useSupplierProducts(supplierId || undefined)
  const price = new Map((offered.data ?? []).map((p) => [p.product_id, Number(p.unit_price)]))
  useEffect(() => { if (open) reset({ supplier_id: '', warehouse_id: '', expected_delivery_date: '', lines: [{ product_id: '', quantity: '1' }] }) }, [open, reset])

  const subtotal = (lines ?? []).reduce((s, l) => s + (price.get(l.product_id) ?? 0) * (Number(l.quantity) || 0), 0)
  const submit = handleSubmit(async (v) => {
    try {
      await create.mutateAsync({
        supplier_id: v.supplier_id, warehouse_id: v.warehouse_id, expected_delivery_date: v.expected_delivery_date || null,
        lines: v.lines.map((l) => ({ product_id: l.product_id, quantity: Number(l.quantity) })),
      })
      onOpenChange(false)
    } catch { /* toast by hook */ }
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="New purchase order" className="max-w-2xl" description="Creates a draft order using the supplier's catalogue prices."
      footer={<><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={() => void submit()} disabled={create.isPending}>{create.isPending ? 'Creating…' : 'Create purchase order'}</Button></>}>
      <form onSubmit={(e) => { e.preventDefault(); void submit() }} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Supplier" htmlFor="po-supplier" error={errors.supplier_id?.message}>
            <Select id="po-supplier" {...register('supplier_id', { onChange: () => setValue('lines', [{ product_id: '', quantity: '1' }]) })}>
              <option value="">Select supplier…</option>{suppliers.list.filter((s) => s.is_active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
          <Field label="Warehouse" htmlFor="po-wh" error={errors.warehouse_id?.message}>
            <Select id="po-wh" {...register('warehouse_id')}><option value="">Select warehouse…</option>{warehouses.list.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select>
          </Field>
          <Field label="Expected delivery" htmlFor="po-date" hint="Optional"><Input id="po-date" type="date" {...register('expected_delivery_date')} /></Field>
        </div>
        <div className="space-y-2">
          <div className="text-sm font-medium">Lines</div>
          {!supplierId && <p className="text-sm text-muted-foreground">Select a supplier to choose from the products they offer.</p>}
          {supplierId && offered.isLoading && <p className="text-sm text-muted-foreground">Loading supplier products…</p>}
          {supplierId && offered.data && offered.data.length === 0 && <p className="text-sm text-destructive">This supplier offers no products.</p>}
          {supplierId && fields.map((f, i) => (
            <div key={f.id} className="grid grid-cols-[1fr_6rem_6rem_2.25rem] items-start gap-2">
              <div>
                <Select aria-label={`Line ${i + 1} product`} {...register(`lines.${i}.product_id`)}>
                  <option value="">Select product…</option>{offered.data?.map((p) => <option key={p.product_id} value={p.product_id}>{p.sku} · {p.product_name} ({fmtMoney(p.unit_price)})</option>)}
                </Select>
                {errors.lines?.[i]?.product_id && <p role="alert" className="mt-1 text-xs text-destructive">{errors.lines[i]?.product_id?.message}</p>}
              </div>
              <div>
                <Input aria-label={`Line ${i + 1} quantity`} inputMode="numeric" {...register(`lines.${i}.quantity`)} />
                {errors.lines?.[i]?.quantity && <p role="alert" className="mt-1 text-xs text-destructive">{errors.lines[i]?.quantity?.message}</p>}
              </div>
              <div className="pt-2 text-right text-sm tabular-nums">{fmtMoney((price.get(lines?.[i]?.product_id ?? '') ?? 0) * (Number(lines?.[i]?.quantity) || 0))}</div>
              <Button variant="ghost" size="icon" aria-label={`Remove line ${i + 1}`} disabled={fields.length === 1} onClick={() => remove(i)}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
          {errors.lines?.message && <p role="alert" className="text-xs text-destructive">{errors.lines.message}</p>}
          {supplierId && <Button variant="outline" size="sm" onClick={() => append({ product_id: '', quantity: '1' })}><Plus className="h-4 w-4" /> Add line</Button>}
        </div>
        <div className="rounded-md bg-muted/60 p-3 text-sm">
          <div className="flex justify-between"><span>Subtotal (estimate)</span><span className="tabular-nums">{fmtMoney(subtotal)}</span></div>
          <div className="flex justify-between font-semibold"><span>Total incl. ~{TAX_RATE_ESTIMATE * 100}% tax (estimate)</span><span className="tabular-nums">{fmtMoney(subtotal * (1 + TAX_RATE_ESTIMATE))}</span></div>
          <p className="mt-1 text-xs text-muted-foreground">Final prices and totals are calculated by the server when the order is created.</p>
        </div>
      </form>
    </Dialog>
  )
}

function PODrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data: po, isLoading, error, refetch } = usePO(id ?? undefined)
  const { can } = useAuth()
  const suppliers = useSupplierLookup()
  const warehouses = useWarehouseLookup()
  const products = useProductLookup()
  const change = useChangePOStatus()
  const [confirm, setConfirm] = useState<string | null>(null)
  const transitions = po ? allowedTransitions(po.status, can) : []

  const apply = (to: string) => { if (po) change.mutate({ id: po.id, to_status: to }, { onSettled: () => setConfirm(null) }) }

  return (
    <>
      <Drawer open={!!id} onOpenChange={(o) => !o && onClose()} title={po?.po_number ?? 'Purchase order'} subtitle={po && <StatusBadge status={po.status} />}>
        {isLoading ? <DetailSkeleton /> : error || !po ? <ErrorState error={error} onRetry={() => void refetch()} /> : (
          <div className="space-y-6">
            {transitions.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {transitions.map((to) => (
                  <Button key={to} size="sm" variant={to === 'cancelled' ? 'destructive' : to === 'approved' ? 'default' : 'outline'} disabled={change.isPending}
                    onClick={() => (to === 'cancelled' ? setConfirm(to) : apply(to))}>{TRANSITION_LABEL[to] ?? titleCase(to)}</Button>
                ))}
              </div>
            )}
            {po.status === 'pending_approval' && !can('po:approve') && <p className="text-xs text-muted-foreground">Approving requires the po:approve permission.</p>}
            <KeyValue items={[
              { label: 'Supplier', value: suppliers.name(po.supplier_id) }, { label: 'Warehouse', value: warehouses.name(po.warehouse_id) },
              { label: 'Order date', value: fmtDate(po.order_date) }, { label: 'Expected delivery', value: fmtDate(po.expected_delivery_date) },
              { label: 'Actual delivery', value: fmtDate(po.actual_delivery_date) },
            ]} />
            <section>
              <h3 className="mb-2 text-sm font-semibold">Lines</h3>
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/60 text-xs uppercase text-muted-foreground"><tr><th className="px-3 py-2 text-left">Product</th><th className="px-3 py-2 text-right">Qty</th><th className="px-3 py-2 text-right">Received</th><th className="px-3 py-2 text-right">Unit price</th><th className="px-3 py-2 text-right">Line total</th></tr></thead>
                  <tbody className="divide-y">
                    {po.lines.map((l) => (
                      <tr key={l.id}>
                        <td className="px-3 py-2"><div className="font-medium">{products.name(l.product_id)}</div><div className="font-mono text-xs text-muted-foreground">{products.sku(l.product_id)}</div></td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmtNumber(l.quantity)}</td><td className="px-3 py-2 text-right tabular-nums">{fmtNumber(l.quantity_received)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(l.unit_price)}</td><td className="px-3 py-2 text-right tabular-nums">{fmtMoney(l.line_total)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="text-sm">
                    <tr><td colSpan={4} className="px-3 py-1.5 text-right text-muted-foreground">Subtotal</td><td className="px-3 py-1.5 text-right tabular-nums">{fmtMoney(po.subtotal)}</td></tr>
                    <tr><td colSpan={4} className="px-3 py-1.5 text-right text-muted-foreground">Tax</td><td className="px-3 py-1.5 text-right tabular-nums">{fmtMoney(po.tax_amount)}</td></tr>
                    <tr className="font-semibold"><td colSpan={4} className="px-3 py-1.5 text-right">Total</td><td className="px-3 py-1.5 text-right tabular-nums">{fmtMoney(po.total_amount)}</td></tr>
                  </tfoot>
                </table>
              </div>
            </section>
            <section>
              <h3 className="mb-3 text-sm font-semibold">Status history</h3>
              <ol className="relative space-y-4 border-l pl-5">
                {[...po.history].sort((a, b) => a.changed_at.localeCompare(b.changed_at)).map((h, i) => (
                  <li key={i} className="relative">
                    <span className="absolute -left-[26px] top-1 h-2.5 w-2.5 rounded-full border-2 border-card bg-primary ring-1 ring-primary" />
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      {h.from_status && <><StatusBadge status={h.from_status} /><span className="text-muted-foreground">→</span></>}<StatusBadge status={h.to_status} />
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">{fmtDateTime(h.changed_at)}{h.note ? ` · ${h.note}` : ''}</div>
                  </li>
                ))}
              </ol>
            </section>
          </div>
        )}
      </Drawer>
      <ConfirmDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)} destructive title="Cancel purchase order"
        description={<>Cancel <strong>{po?.po_number}</strong>? Cancelled orders cannot be reopened.</>} confirmLabel="Cancel order" loading={change.isPending}
        onConfirm={() => confirm && apply(confirm)} />
    </>
  )
}

export function PurchaseOrdersPage() {
  const ls = useListState({ status: '', supplier_id: '' }, { sort: 'order_date', order: 'desc' })
  const params = { ...ls.params, status: ls.filters.status || undefined, supplier_id: ls.filters.supplier_id || undefined }
  const { data, isLoading, error, refetch } = usePOs(params)
  const suppliers = useSupplierLookup()
  const warehouses = useWarehouseLookup()
  const [selected, setSelected] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  const columns: Column<PO>[] = [
    { key: 'po', header: 'PO number', sortKey: 'po_number', cell: (p) => <span className="font-medium">{p.po_number}{p.order_type === 'consignment' && <Badge tone="purple" className="ml-2" title="Vendor-owned stock; cost is incurred when used">Consignment</Badge>}</span> },
    { key: 'supplier', header: 'Supplier', cell: (p) => suppliers.name(p.supplier_id) },
    { key: 'wh', header: 'Warehouse', cell: (p) => warehouses.name(p.warehouse_id) },
    { key: 'status', header: 'Status', cell: (p) => <StatusBadge status={p.status} /> },
    { key: 'date', header: 'Order date', sortKey: 'order_date', cell: (p) => fmtDate(p.order_date) },
    { key: 'exp', header: 'Expected', sortKey: 'expected', cell: (p) => fmtDate(p.expected_delivery_date) },
    { key: 'total', header: 'Total', sortKey: 'total', align: 'right', cell: (p) => fmtMoney(p.total_amount) },
  ]
  return (
    <>
      <PageHeader title="Purchase Orders" description="Orders placed with suppliers and their lifecycle."
        actions={<Can permission="po:write"><Button onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" /> New purchase order</Button></Can>} />
      <ListCard filters={<>
        <SearchInput value={ls.q} onChange={ls.setQ} placeholder="Search PO number" />
        <Select aria-label="Status filter" className="w-full sm:w-48" value={ls.filters.status} onChange={(e) => ls.setFilter('status', e.target.value)}>
          <option value="">All statuses</option>{PO_STATUSES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
        </Select>
        <Select aria-label="Supplier filter" className="w-full sm:w-56" value={ls.filters.supplier_id} onChange={(e) => ls.setFilter('supplier_id', e.target.value)}>
          <option value="">All suppliers</option>{suppliers.list.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
      </>}>
        <DataTable columns={columns} rows={data?.items} rowKey={(p) => p.id} loading={isLoading} error={error} onRetry={() => void refetch()}
          sort={ls.sort} order={ls.order} onSort={ls.toggleSort} onRowClick={(p) => setSelected(p.id)} emptyTitle="No purchase orders found" />
        {data && <Pagination page={data.page} pageSize={data.page_size} total={data.total} onPageChange={ls.setPage} onPageSizeChange={ls.setPageSize} />}
      </ListCard>
      <PODrawer id={selected} onClose={() => setSelected(null)} />
      <CreatePODialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  )
}
