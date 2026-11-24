import { zodResolver } from '@hookform/resolvers/zod'
import { Pencil, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
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
import { KeyValue } from '@/components/Sections'
import { DetailSkeleton } from '@/components/Skeletons'
import { StatusBadge } from '@/components/StatusBadge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Input, Select, Textarea } from '@/components/ui/input'
import { Field } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useCreateSupplier, useSupplierLookup, useSupplierPerformance, useSupplierPOs, useSupplierProducts, useSuppliers, useUpdateSupplier, useWarehouseLookup } from '@/hooks/api'
import { useListState } from '@/hooks/useListState'
import { fmtDate, fmtMoney, fmtNumber, fmtPercent } from '@/lib/format'
import type { Supplier } from '@/lib/types'

const supplierSchema = z.object({
  code: z.string().trim().min(1, 'Code is required').max(20, 'Max 20 characters'),
  name: z.string().trim().min(1, 'Name is required').max(200),
  contact_person: z.string(),
  email: z.string().trim().refine((v) => v === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Enter a valid email'),
  phone: z.string(),
  address: z.string(),
  country: z.string(),
  payment_terms: z.string().trim().min(1, 'Payment terms are required'),
  avg_lead_time_days: z.string().refine((v) => /^\d+$/.test(v) && Number(v) <= 365, 'Whole number of days, 0 to 365'),
  rating: z.string().refine((v) => v.trim() !== '' && Number(v) >= 0 && Number(v) <= 5, 'Rating must be between 0 and 5'),
  is_active: z.boolean(),
})
type SupplierForm = z.infer<typeof supplierSchema>

function SupplierDialog({ open, onOpenChange, supplier }: { open: boolean; onOpenChange: (o: boolean) => void; supplier: Supplier | null }) {
  const create = useCreateSupplier()
  const update = useUpdateSupplier()
  const blank: SupplierForm = { code: '', name: '', contact_person: '', email: '', phone: '', address: '', country: '', payment_terms: 'Net 30', avg_lead_time_days: '14', rating: '3.5', is_active: true }
  const { register, handleSubmit, reset, formState: { errors } } = useForm<SupplierForm>({ resolver: zodResolver(supplierSchema), defaultValues: blank })
  useEffect(() => {
    if (!open) return
    reset(supplier ? { ...supplier, avg_lead_time_days: String(supplier.avg_lead_time_days) } : blank)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, supplier, reset])
  const busy = create.isPending || update.isPending
  const submit = handleSubmit(async (v) => {
    const body = { ...v, name: v.name.trim(), email: v.email.trim() || null, avg_lead_time_days: Number(v.avg_lead_time_days), rating: Number(v.rating) }
    try {
      if (supplier) {
        const { code: _c, ...rest } = body
        void _c
        await update.mutateAsync({ id: supplier.id, body: rest })
      } else await create.mutateAsync({ ...body, code: body.code.trim() })
      onOpenChange(false)
    } catch { /* toast shown by hook */ }
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={supplier ? `Edit ${supplier.code}` : 'New supplier'} className="max-w-xl"
      footer={<><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={() => void submit()} disabled={busy}>{busy ? 'Saving…' : 'Save supplier'}</Button></>}>
      <form onSubmit={(e) => { e.preventDefault(); void submit() }} className="grid gap-4 sm:grid-cols-2">
        <Field label="Code" htmlFor="s-code" error={errors.code?.message} hint={supplier ? 'Code cannot be changed' : undefined}><Input id="s-code" disabled={!!supplier} {...register('code')} /></Field>
        <Field label="Name" htmlFor="s-name" error={errors.name?.message}><Input id="s-name" {...register('name')} /></Field>
        <Field label="Contact person" htmlFor="s-contact"><Input id="s-contact" {...register('contact_person')} /></Field>
        <Field label="Email" htmlFor="s-email" error={errors.email?.message}><Input id="s-email" type="email" {...register('email')} /></Field>
        <Field label="Phone" htmlFor="s-phone"><Input id="s-phone" {...register('phone')} /></Field>
        <Field label="Country" htmlFor="s-country"><Input id="s-country" {...register('country')} /></Field>
        <div className="sm:col-span-2"><Field label="Address" htmlFor="s-addr"><Textarea id="s-addr" className="min-h-[56px]" {...register('address')} /></Field></div>
        <Field label="Payment terms" htmlFor="s-terms" error={errors.payment_terms?.message}><Input id="s-terms" {...register('payment_terms')} /></Field>
        <Field label="Avg lead time (days)" htmlFor="s-lead" error={errors.avg_lead_time_days?.message}><Input id="s-lead" inputMode="numeric" {...register('avg_lead_time_days')} /></Field>
        <Field label="Rating (0-5)" htmlFor="s-rating" error={errors.rating?.message}><Input id="s-rating" inputMode="decimal" {...register('rating')} /></Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-blue-600" {...register('is_active')} /> Active</label>
      </form>
    </Dialog>
  )
}

function SupplierProductsTab({ id }: { id: string }) {
  const { data, isLoading, error, refetch } = useSupplierProducts(id)
  if (isLoading) return <DetailSkeleton />
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />
  if (!data?.length) return <EmptyState title="No products offered" />
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-muted/60 text-xs uppercase text-muted-foreground"><tr><th className="px-3 py-2 text-left">Product</th><th className="px-3 py-2 text-right">Price</th><th className="px-3 py-2 text-right">Lead time</th><th className="px-3 py-2 text-right">MOQ</th><th className="px-3 py-2" /></tr></thead>
        <tbody className="divide-y">
          {data.map((p) => (
            <tr key={p.product_id}>
              <td className="px-3 py-2"><div className="font-medium">{p.product_name}</div><div className="font-mono text-xs text-muted-foreground">{p.sku}</div></td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(p.unit_price)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{p.lead_time_days} d</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtNumber(p.min_order_qty)}</td>
              <td className="px-3 py-2">{p.is_preferred && <Badge tone="blue">Preferred</Badge>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function PerformanceTab({ id }: { id: string }) {
  const { data, isLoading, error, refetch } = useSupplierPerformance(id)
  if (isLoading) return <DetailSkeleton />
  if (error || !data) return <ErrorState error={error} onRetry={() => void refetch()} />
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        {[
          ['Rating', data.rating.toFixed(2)],
          ['On-time delivery rate', fmtPercent(data.on_time_rate)],
          ['Avg delay (days)', data.avg_delay_days === null ? '—' : String(data.avg_delay_days)],
          ['Orders received', fmtNumber(data.orders_received)],
          ['Total orders', fmtNumber(data.total_orders)],
        ].map(([l, v]) => (
          <div key={l} className="rounded-md border p-3"><div className="text-xs uppercase tracking-wide text-muted-foreground">{l}</div><div className="mt-1 text-xl font-semibold tabular-nums">{v}</div></div>
        ))}
      </div>
      {data.on_time_rate === null && <p className="text-sm text-muted-foreground">No received orders yet, so delivery metrics are not available.</p>}
    </div>
  )
}

function POHistoryTab({ id }: { id: string }) {
  const { data, isLoading, error, refetch } = useSupplierPOs(id)
  const wh = useWarehouseLookup()
  if (isLoading) return <DetailSkeleton />
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} title="Could not load orders" />
  if (!data?.length) return <EmptyState title="No purchase orders for this supplier" />
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-muted/60 text-xs uppercase text-muted-foreground"><tr><th className="px-3 py-2 text-left">PO</th><th className="px-3 py-2 text-left">Date</th><th className="px-3 py-2 text-left">Warehouse</th><th className="px-3 py-2 text-left">Status</th><th className="px-3 py-2 text-right">Total</th></tr></thead>
        <tbody className="divide-y">
          {data.map((p) => (
            <tr key={p.id}>
              <td className="px-3 py-2 font-medium">{p.po_number}</td><td className="px-3 py-2">{fmtDate(p.order_date)}</td><td className="px-3 py-2">{wh.name(p.warehouse_id)}</td>
              <td className="px-3 py-2"><StatusBadge status={p.status} /></td><td className="px-3 py-2 text-right tabular-nums">{fmtMoney(p.total_amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function SuppliersPage() {
  const ls = useListState({ country: '', active: '' }, { sort: 'name' })
  const params = { ...ls.params, country: ls.filters.country || undefined, active: ls.filters.active === '' ? undefined : ls.filters.active === 'true' }
  const { data, isLoading, error, refetch } = useSuppliers(params)
  const lookup = useSupplierLookup()
  const countries = Array.from(new Set(lookup.list.map((s) => s.country).filter(Boolean))).sort()

  const [selected, setSelected] = useState<Supplier | null>(null)
  const [editing, setEditing] = useState<Supplier | null>(null)
  const [formOpen, setFormOpen] = useState(false)

  // keep the drawer in sync after an edit
  useEffect(() => {
    if (!selected || !data) return
    const fresh = data.items.find((s) => s.id === selected.id)
    if (fresh && fresh !== selected) setSelected(fresh)
  }, [data, selected])

  const columns: Column<Supplier>[] = [
    { key: 'code', header: 'Code', sortKey: 'code', cell: (s) => <span className="font-mono text-xs">{s.code}</span> },
    { key: 'name', header: 'Name', sortKey: 'name', cell: (s) => <span className="font-medium">{s.name}</span> },
    { key: 'country', header: 'Country', sortKey: 'country', cell: (s) => s.country || '—' },
    { key: 'lead', header: 'Lead time', sortKey: 'lead_time', align: 'right', cell: (s) => `${s.avg_lead_time_days} d` },
    { key: 'rating', header: 'Rating', sortKey: 'rating', align: 'right', cell: (s) => Number(s.rating).toFixed(2) },
    { key: 'status', header: 'Status', cell: (s) => <StatusBadge status={s.is_active ? 'active' : 'inactive'} /> },
  ]

  return (
    <>
      <PageHeader title="Suppliers" description="Vendors, their catalogues and delivery performance."
        actions={<Can permission="supplier:write"><Button onClick={() => { setEditing(null); setFormOpen(true) }}><Plus className="h-4 w-4" /> New supplier</Button></Can>} />
      <ListCard filters={<>
        <SearchInput value={ls.q} onChange={ls.setQ} placeholder="Search name or code" />
        <Select aria-label="Country filter" className="w-full sm:w-44" value={ls.filters.country} onChange={(e) => ls.setFilter('country', e.target.value)}>
          <option value="">All countries</option>{countries.map((c) => <option key={c} value={c}>{c}</option>)}
        </Select>
        <Select aria-label="Active filter" className="w-full sm:w-36" value={ls.filters.active} onChange={(e) => ls.setFilter('active', e.target.value)}>
          <option value="">All statuses</option><option value="true">Active</option><option value="false">Inactive</option>
        </Select>
      </>}>
        <DataTable columns={columns} rows={data?.items} rowKey={(s) => s.id} loading={isLoading} error={error} onRetry={() => void refetch()}
          sort={ls.sort} order={ls.order} onSort={ls.toggleSort} onRowClick={setSelected} emptyTitle="No suppliers found" />
        {data && <Pagination page={data.page} pageSize={data.page_size} total={data.total} onPageChange={ls.setPage} onPageSizeChange={ls.setPageSize} />}
      </ListCard>

      <Drawer open={!!selected} onOpenChange={(o) => !o && setSelected(null)} title={selected?.name ?? ''} subtitle={selected && <span className="font-mono">{selected.code}</span>}
        actions={selected && <Can permission="supplier:write"><Button size="sm" variant="outline" onClick={() => { setEditing(selected); setFormOpen(true) }}><Pencil className="h-4 w-4" /> Edit</Button></Can>}>
        {selected && (
          <Tabs defaultValue="profile" key={selected.id}>
            <TabsList>
              <TabsTrigger value="profile">Profile</TabsTrigger><TabsTrigger value="products">Products</TabsTrigger>
              <TabsTrigger value="performance">Performance</TabsTrigger><TabsTrigger value="orders">Purchase orders</TabsTrigger>
            </TabsList>
            <TabsContent value="profile">
              <KeyValue items={[
                { label: 'Status', value: <StatusBadge status={selected.is_active ? 'active' : 'inactive'} /> },
                { label: 'Rating', value: Number(selected.rating).toFixed(2) },
                { label: 'Contact', value: selected.contact_person }, { label: 'Email', value: selected.email },
                { label: 'Phone', value: selected.phone }, { label: 'Country', value: selected.country },
                { label: 'Payment terms', value: selected.payment_terms }, { label: 'Avg lead time', value: `${selected.avg_lead_time_days} days` },
                { label: 'Address', value: selected.address },
              ]} />
            </TabsContent>
            <TabsContent value="products"><SupplierProductsTab id={selected.id} /></TabsContent>
            <TabsContent value="performance"><PerformanceTab id={selected.id} /></TabsContent>
            <TabsContent value="orders"><POHistoryTab id={selected.id} /></TabsContent>
          </Tabs>
        )}
      </Drawer>
      <SupplierDialog open={formOpen} onOpenChange={setFormOpen} supplier={editing} />
    </>
  )
}
