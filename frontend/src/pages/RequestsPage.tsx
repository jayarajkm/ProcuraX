import { zodResolver } from '@hookform/resolvers/zod'
import { Check, Plus, Search, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Controller, useFieldArray, useForm } from 'react-hook-form'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { z } from 'zod'
import { Can } from '@/auth/Can'
import { useAuth } from '@/auth/AuthContext'
import { DataTable, type Column } from '@/components/DataTable'
import { Drawer } from '@/components/Drawer'
import { ErrorState } from '@/components/ErrorState'
import { ListCard } from '@/components/ListToolbar'
import { PageHeader } from '@/components/PageHeader'
import { Pagination } from '@/components/Pagination'
import { KeyValue } from '@/components/Sections'
import { DetailSkeleton } from '@/components/Skeletons'
import { StatusBadge } from '@/components/StatusBadge'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Input, Select, Textarea } from '@/components/ui/input'
import { Field } from '@/components/ui/label'
import { useApprovals, useConvertRequest, useCreateRequest, useDecideRequest, useProductLookup, useProducts, useRequest, useRequests, useSubmitRequest, useSupplierLookup } from '@/hooks/api'
import { useListState } from '@/hooks/useListState'
import { fmtDate, fmtDateTime, fmtNumber, titleCase } from '@/lib/format'
import type { PurchaseRequest } from '@/lib/types'

const REQUEST_STATUSES = ['draft', 'submitted', 'pending_approval', 'approved', 'rejected', 'converted']
const PRIORITIES = ['low', 'medium', 'high', 'urgent']

const requestSchema = z.object({
  priority: z.string(),
  justification: z.string().trim().min(1, 'Justification is required'),
  requested_delivery_date: z.string(),
  lines: z.array(z.object({
    product_id: z.string().min(1, 'Search and choose a product'),
    product_label: z.string(),
    suggested_supplier_id: z.string(),
    quantity: z.string().refine((v) => /^\d+$/.test(v) && Number(v) > 0, 'Whole number above 0'),
  })).min(1, 'Add at least one line'),
})
type RequestForm = z.infer<typeof requestSchema>

function ProductPicker({ value, label, onPick, invalid }: { value: string; label: string; onPick: (id: string, label: string) => void; invalid?: boolean }) {
  const [text, setText] = useState(label)
  const [term, setTerm] = useState('')
  const [open, setOpen] = useState(false)
  useEffect(() => { setText(label) }, [label])
  useEffect(() => {
    const t = setTimeout(() => setTerm(text.trim()), 250)
    return () => clearTimeout(t)
  }, [text])
  const { data, isFetching } = useProducts({ q: open && term.length >= 2 ? term : undefined, page_size: 8, active: true })
  const showResults = open && term.length >= 2
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
      <Input aria-label="Product search" aria-invalid={invalid} className="pl-8" placeholder="Search product name or SKU" value={text}
        onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => { setText(e.target.value); setOpen(true); if (value) onPick('', '') }} />
      {showResults && (
        <ul role="listbox" className="absolute z-50 mt-1 max-h-56 w-full overflow-auto rounded-md border bg-card py-1 text-sm shadow-lg">
          {isFetching && !data ? <li className="px-3 py-2 text-muted-foreground">Searching…</li> : data?.items.length === 0 ? <li className="px-3 py-2 text-muted-foreground">No matching products</li> :
            data?.items.map((p) => (
              <li key={p.id} role="option" aria-selected={p.id === value}>
                <button type="button" className="w-full px-3 py-1.5 text-left hover:bg-accent" onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { const l = `${p.sku} · ${p.name}`; onPick(p.id, l); setText(l); setOpen(false) }}>
                  <span className="font-mono text-xs text-muted-foreground">{p.sku}</span> {p.name}
                </button>
              </li>
            ))}
        </ul>
      )}
    </div>
  )
}

function CreateRequestDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const suppliers = useSupplierLookup()
  const create = useCreateRequest()
  const blankLine = { product_id: '', product_label: '', suggested_supplier_id: '', quantity: '1' }
  const { register, control, handleSubmit, reset, formState: { errors } } = useForm<RequestForm>({
    resolver: zodResolver(requestSchema), defaultValues: { priority: 'medium', justification: '', requested_delivery_date: '', lines: [blankLine] },
  })
  const { fields, append, remove } = useFieldArray({ control, name: 'lines' })
  useEffect(() => { if (open) reset({ priority: 'medium', justification: '', requested_delivery_date: '', lines: [blankLine] }) }, [open, reset]) // eslint-disable-line react-hooks/exhaustive-deps
  const submit = handleSubmit(async (v) => {
    try {
      await create.mutateAsync({
        priority: v.priority, justification: v.justification.trim(), requested_delivery_date: v.requested_delivery_date || null,
        lines: v.lines.map((l) => ({ product_id: l.product_id, quantity: Number(l.quantity), suggested_supplier_id: l.suggested_supplier_id || null })),
      })
      onOpenChange(false)
    } catch { /* toast by hook */ }
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="New procurement request" className="max-w-3xl" description="Saved as a draft. Submit it for approval from the request details."
      footer={<><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={() => void submit()} disabled={create.isPending}>{create.isPending ? 'Creating…' : 'Create request'}</Button></>}>
      <form onSubmit={(e) => { e.preventDefault(); void submit() }} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Priority" htmlFor="rq-prio"><Select id="rq-prio" {...register('priority')}>{PRIORITIES.map((p) => <option key={p} value={p}>{titleCase(p)}</option>)}</Select></Field>
          <Field label="Requested delivery date" htmlFor="rq-date" hint="Optional"><Input id="rq-date" type="date" {...register('requested_delivery_date')} /></Field>
        </div>
        <Field label="Justification" htmlFor="rq-just" error={errors.justification?.message}><Textarea id="rq-just" {...register('justification')} /></Field>
        <div className="space-y-2">
          <div className="text-sm font-medium">Lines</div>
          {fields.map((f, i) => (
            <div key={f.id} className="grid grid-cols-1 items-start gap-2 rounded-md border p-2 sm:grid-cols-[1fr_11rem_5.5rem_2.25rem]">
              <div>
                <Controller control={control} name={`lines.${i}.product_id`} render={({ field }) => (
                  <Controller control={control} name={`lines.${i}.product_label`} render={({ field: lab }) => (
                    <ProductPicker value={field.value} label={lab.value} invalid={!!errors.lines?.[i]?.product_id}
                      onPick={(id, label) => { field.onChange(id); lab.onChange(label) }} />
                  )} />
                )} />
                {errors.lines?.[i]?.product_id && <p role="alert" className="mt-1 text-xs text-destructive">{errors.lines[i]?.product_id?.message}</p>}
              </div>
              <Select aria-label={`Line ${i + 1} supplier`} {...register(`lines.${i}.suggested_supplier_id`)}>
                <option value="">Supplier (optional)</option>{suppliers.list.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
              <div>
                <Input aria-label={`Line ${i + 1} quantity`} inputMode="numeric" {...register(`lines.${i}.quantity`)} />
                {errors.lines?.[i]?.quantity && <p role="alert" className="mt-1 text-xs text-destructive">{errors.lines[i]?.quantity?.message}</p>}
              </div>
              <Button variant="ghost" size="icon" aria-label={`Remove line ${i + 1}`} disabled={fields.length === 1} onClick={() => remove(i)}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
          {errors.lines?.message && <p role="alert" className="text-xs text-destructive">{errors.lines.message}</p>}
          <Button variant="outline" size="sm" onClick={() => append(blankLine)}><Plus className="h-4 w-4" /> Add line</Button>
        </div>
      </form>
    </Dialog>
  )
}

function RequestDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data: r, isLoading, error, refetch } = useRequest(id ?? undefined)
  const approvals = useApprovals(id ?? undefined)
  const { can } = useAuth()
  const products = useProductLookup()
  const suppliers = useSupplierLookup()
  const submit = useSubmitRequest()
  const decide = useDecideRequest()
  const convert = useConvertRequest()
  const navigate = useNavigate()
  const [comment, setComment] = useState('')
  useEffect(() => { setComment('') }, [id])
  const busy = submit.isPending || decide.isPending || convert.isPending

  const canSubmit = r?.status === 'draft' && can('request:write')
  const canDecide = r?.status === 'pending_approval' && can('request:approve')
  const canConvert = r?.status === 'approved' && can('po:write')

  return (
    <Drawer open={!!id} onOpenChange={(o) => !o && onClose()} title={r?.request_number ?? 'Request'} subtitle={r && <span className="flex items-center gap-2"><StatusBadge status={r.status} /><StatusBadge status={r.priority} /></span>}>
      {isLoading ? <DetailSkeleton /> : error || !r ? <ErrorState error={error} onRetry={() => void refetch()} /> : (
        <div className="space-y-6">
          {(canSubmit || canConvert) && (
            <div className="flex flex-wrap gap-2">
              {canSubmit && <Button size="sm" disabled={busy} onClick={() => submit.mutate(r.id)}>Submit for approval</Button>}
              {canConvert && <Button size="sm" disabled={busy} onClick={() => convert.mutate(r.id, { onSuccess: (po) => toast.success(`Converted to ${po.po_number}`, { action: { label: 'View orders', onClick: () => navigate('/purchase-orders') } }) })}>Convert to purchase order</Button>}
            </div>
          )}
          {canDecide && (
            <div className="space-y-2 rounded-md border bg-muted/40 p-3">
              <Field label="Decision comment" htmlFor="decision-comment" hint="Optional for approval, recommended for rejection"><Textarea id="decision-comment" className="min-h-[60px]" value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
              <div className="flex gap-2">
                <Button size="sm" disabled={busy} onClick={() => decide.mutate({ id: r.id, action: 'approve', comment })}><Check className="h-4 w-4" /> Approve</Button>
                <Button size="sm" variant="destructive" disabled={busy} onClick={() => decide.mutate({ id: r.id, action: 'reject', comment })}><X className="h-4 w-4" /> Reject</Button>
              </div>
            </div>
          )}
          {r.status === 'pending_approval' && !can('request:approve') && <p className="text-xs text-muted-foreground">Approving or rejecting requires the request:approve permission.</p>}
          <KeyValue items={[
            { label: 'Created', value: fmtDateTime(r.created_at) }, { label: 'Requested delivery', value: fmtDate(r.requested_delivery_date) },
            { label: 'Justification', value: r.justification },
          ]} />
          <section>
            <h3 className="mb-2 text-sm font-semibold">Lines</h3>
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/60 text-xs uppercase text-muted-foreground"><tr><th className="px-3 py-2 text-left">Product</th><th className="px-3 py-2 text-left">Suggested supplier</th><th className="px-3 py-2 text-right">Qty</th></tr></thead>
                <tbody className="divide-y">
                  {r.lines.map((l) => (
                    <tr key={l.id}>
                      <td className="px-3 py-2"><div className="font-medium">{products.name(l.product_id)}</div><div className="font-mono text-xs text-muted-foreground">{products.sku(l.product_id)}</div></td>
                      <td className="px-3 py-2">{suppliers.name(l.suggested_supplier_id)}</td><td className="px-3 py-2 text-right tabular-nums">{fmtNumber(l.quantity)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section>
            <h3 className="mb-3 text-sm font-semibold">Approval history</h3>
            {approvals.isLoading ? <DetailSkeleton /> : approvals.error ? <ErrorState error={approvals.error} onRetry={() => void approvals.refetch()} /> : !approvals.data?.length ? <p className="text-sm text-muted-foreground">No approval activity yet.</p> : (
              <ol className="relative space-y-4 border-l pl-5">
                {approvals.data.map((a, i) => (
                  <li key={i} className="relative">
                    <span className="absolute -left-[26px] top-1 h-2.5 w-2.5 rounded-full border-2 border-card bg-primary ring-1 ring-primary" />
                    <div className="flex items-center gap-2 text-sm"><StatusBadge status={a.action} /></div>
                    {a.comment && <p className="mt-1 text-sm">{a.comment}</p>}
                    <div className="mt-0.5 text-xs text-muted-foreground">{fmtDateTime(a.acted_at)}{a.actor_id ? ` · user ${a.actor_id.slice(0, 8)}` : ''}</div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      )}
    </Drawer>
  )
}

export function RequestsPage() {
  const ls = useListState({ status: '' })
  const params = { page: ls.page, page_size: ls.pageSize, status: ls.filters.status || undefined }
  const { data, isLoading, error, refetch } = useRequests(params)
  const [searchParams, setSearchParams] = useSearchParams()
  const [selected, setSelected] = useState<string | null>(searchParams.get('open'))
  const [createOpen, setCreateOpen] = useState(false)

  useEffect(() => {
    if (searchParams.has('open')) { setSelected(searchParams.get('open')); setSearchParams({}, { replace: true }) }
  }, [searchParams, setSearchParams])

  const columns: Column<PurchaseRequest>[] = [
    { key: 'num', header: 'Request', cell: (r) => <span className="font-medium">{r.request_number}</span> },
    { key: 'just', header: 'Justification', className: 'max-w-xs', cell: (r) => <span className="line-clamp-1">{r.justification}</span> },
    { key: 'prio', header: 'Priority', cell: (r) => <StatusBadge status={r.priority} /> },
    { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
    { key: 'lines', header: 'Lines', align: 'right', cell: (r) => r.lines.length },
    { key: 'delivery', header: 'Requested for', cell: (r) => fmtDate(r.requested_delivery_date) },
    { key: 'created', header: 'Created', cell: (r) => fmtDate(r.created_at) },
  ]
  return (
    <>
      <PageHeader title="Procurement Requests" description="Internal purchase requests and their approval workflow."
        actions={<Can permission="request:write"><Button onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" /> New request</Button></Can>} />
      <ListCard filters={
        <Select aria-label="Status filter" className="w-full sm:w-52" value={ls.filters.status} onChange={(e) => ls.setFilter('status', e.target.value)}>
          <option value="">All statuses</option>{REQUEST_STATUSES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
        </Select>}>
        <DataTable columns={columns} rows={data?.items} rowKey={(r) => r.id} loading={isLoading} error={error} onRetry={() => void refetch()} onRowClick={(r) => setSelected(r.id)}
          emptyTitle="No requests found" />
        {data && <Pagination page={data.page} pageSize={data.page_size} total={data.total} onPageChange={ls.setPage} onPageSizeChange={ls.setPageSize} />}
      </ListCard>
      <RequestDrawer id={selected} onClose={() => setSelected(null)} />
      <CreateRequestDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  )
}
