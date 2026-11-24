import { zodResolver } from '@hookform/resolvers/zod'
import { Pencil, Plus, Tags, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { Can } from '@/auth/Can'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { DataTable, type Column } from '@/components/DataTable'
import { Drawer } from '@/components/Drawer'
import { ListCard } from '@/components/ListToolbar'
import { PageHeader } from '@/components/PageHeader'
import { Pagination } from '@/components/Pagination'
import { SearchInput } from '@/components/SearchInput'
import { KeyValue } from '@/components/Sections'
import { StatusBadge } from '@/components/StatusBadge'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Input, Select, Textarea } from '@/components/ui/input'
import { Field } from '@/components/ui/label'
import { useCategories, useCreateCategory, useCreateProduct, useDeleteProduct, useProducts, useUpdateProduct } from '@/hooks/api'
import { useListState } from '@/hooks/useListState'
import { fmtDateTime, fmtMoney } from '@/lib/format'
import type { Product } from '@/lib/types'

const productSchema = z.object({
  sku: z.string().trim().min(1, 'SKU is required').max(40, 'Max 40 characters'),
  name: z.string().trim().min(1, 'Name is required').max(200, 'Max 200 characters'),
  description: z.string(),
  category_id: z.string().min(1, 'Choose a category'),
  manufacturer: z.string(),
  unit_of_measure: z.string().trim().min(1, 'Unit of measure is required'),
  unit_price: z.string().refine((v) => v.trim() !== '' && !Number.isNaN(Number(v)) && Number(v) >= 0, 'Enter a price of 0 or more'),
  is_active: z.boolean(),
})
type ProductForm = z.infer<typeof productSchema>

const categorySchema = z.object({ name: z.string().trim().min(1, 'Name is required').max(120), description: z.string() })
type CategoryForm = z.infer<typeof categorySchema>

export function CategoryDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated?: (id: string) => void }) {
  const create = useCreateCategory()
  const { register, handleSubmit, reset, formState: { errors } } = useForm<CategoryForm>({ resolver: zodResolver(categorySchema), defaultValues: { name: '', description: '' } })
  useEffect(() => { if (open) reset({ name: '', description: '' }) }, [open, reset])
  const submit = handleSubmit(async (v) => {
    const c = await create.mutateAsync(v).catch(() => null)
    if (c) { onCreated?.(c.id); onOpenChange(false) }
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="New category" className="max-w-md"
      footer={<><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={() => void submit()} disabled={create.isPending}>Create category</Button></>}>
      <form onSubmit={(e) => { e.preventDefault(); void submit() }} className="space-y-4">
        <Field label="Name" htmlFor="cat-name" error={errors.name?.message}><Input id="cat-name" {...register('name')} /></Field>
        <Field label="Description" htmlFor="cat-desc"><Textarea id="cat-desc" {...register('description')} /></Field>
      </form>
    </Dialog>
  )
}

function ProductDialog({ open, onOpenChange, product }: { open: boolean; onOpenChange: (o: boolean) => void; product: Product | null }) {
  const { data: categories } = useCategories()
  const create = useCreateProduct()
  const update = useUpdateProduct()
  const [catOpen, setCatOpen] = useState(false)
  const blank: ProductForm = { sku: '', name: '', description: '', category_id: '', manufacturer: '', unit_of_measure: 'each', unit_price: '0', is_active: true }
  const { register, handleSubmit, reset, setValue, formState: { errors } } = useForm<ProductForm>({ resolver: zodResolver(productSchema), defaultValues: blank })

  useEffect(() => {
    if (!open) return
    reset(product ? {
      sku: product.sku, name: product.name, description: product.description, category_id: product.category_id,
      manufacturer: product.manufacturer, unit_of_measure: product.unit_of_measure, unit_price: product.unit_price, is_active: product.is_active,
    } : blank)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, product, reset])

  const busy = create.isPending || update.isPending
  const submit = handleSubmit(async (v) => {
    const body = { ...v, name: v.name.trim(), unit_price: Number(v.unit_price) }
    try {
      if (product) {
        const { sku: _sku, ...rest } = body
        void _sku
        await update.mutateAsync({ id: product.id, body: rest })
      } else {
        await create.mutateAsync({ ...body, sku: body.sku.trim() })
      }
      onOpenChange(false)
    } catch { /* error toast shown by the mutation hook */ }
  })

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange} title={product ? `Edit ${product.sku}` : 'New product'} className="max-w-xl"
        footer={<><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={() => void submit()} disabled={busy}>{busy ? 'Saving…' : 'Save product'}</Button></>}>
        <form onSubmit={(e) => { e.preventDefault(); void submit() }} className="grid gap-4 sm:grid-cols-2">
          <Field label="SKU" htmlFor="p-sku" error={errors.sku?.message} hint={product ? 'SKU cannot be changed' : undefined}><Input id="p-sku" disabled={!!product} {...register('sku')} /></Field>
          <Field label="Name" htmlFor="p-name" error={errors.name?.message}><Input id="p-name" {...register('name')} /></Field>
          <Field label="Category" htmlFor="p-cat" error={errors.category_id?.message}>
            <div className="flex gap-2">
              <Select id="p-cat" {...register('category_id')}>
                <option value="">Select category…</option>
                {categories?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
              <Can permission="product:write"><Button variant="outline" size="icon" aria-label="New category" title="New category" onClick={() => setCatOpen(true)}><Plus className="h-4 w-4" /></Button></Can>
            </div>
          </Field>
          <Field label="Manufacturer" htmlFor="p-mfr"><Input id="p-mfr" {...register('manufacturer')} /></Field>
          <Field label="Unit price (USD)" htmlFor="p-price" error={errors.unit_price?.message}><Input id="p-price" inputMode="decimal" {...register('unit_price')} /></Field>
          <Field label="Unit of measure" htmlFor="p-uom" error={errors.unit_of_measure?.message}><Input id="p-uom" {...register('unit_of_measure')} /></Field>
          <div className="sm:col-span-2"><Field label="Description" htmlFor="p-desc"><Textarea id="p-desc" {...register('description')} /></Field></div>
          <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" className="h-4 w-4 accent-blue-600" {...register('is_active')} /> Active</label>
        </form>
      </Dialog>
      <CategoryDialog open={catOpen} onOpenChange={setCatOpen} onCreated={(id) => setValue('category_id', id, { shouldValidate: true })} />
    </>
  )
}

export function ProductsPage() {
  const ls = useListState({ category_id: '', active: '' }, { sort: 'name' })
  const params = { ...ls.params, category_id: ls.filters.category_id || undefined, active: ls.filters.active === '' ? undefined : ls.filters.active === 'true' }
  const { data, isLoading, error, refetch, isFetching } = useProducts(params)
  const { data: categories } = useCategories()
  const del = useDeleteProduct()

  const [selected, setSelected] = useState<Product | null>(null)
  const [editing, setEditing] = useState<Product | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [catOpen, setCatOpen] = useState(false)
  const [toDelete, setToDelete] = useState<Product | null>(null)

  const openCreate = () => { setEditing(null); setFormOpen(true) }
  const openEdit = (p: Product) => { setEditing(p); setFormOpen(true) }

  const columns: Column<Product>[] = [
    { key: 'sku', header: 'SKU', sortKey: 'sku', cell: (p) => <span className="font-mono text-xs">{p.sku}</span> },
    { key: 'name', header: 'Name', sortKey: 'name', cell: (p) => <span className="font-medium">{p.name}</span> },
    { key: 'category', header: 'Category', cell: (p) => p.category.name },
    { key: 'price', header: 'Unit price', sortKey: 'unit_price', align: 'right', cell: (p) => fmtMoney(p.unit_price) },
    { key: 'status', header: 'Status', cell: (p) => <StatusBadge status={p.is_active ? 'active' : 'inactive'} /> },
    {
      key: 'actions', header: '', align: 'right', cell: (p) => (
        <Can permission="product:write">
          <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
            <Button variant="ghost" size="icon" aria-label={`Edit ${p.sku}`} onClick={() => openEdit(p)}><Pencil className="h-4 w-4" /></Button>
            <Button variant="ghost" size="icon" aria-label={`Delete ${p.sku}`} onClick={() => setToDelete(p)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
          </div>
        </Can>
      ),
    },
  ]

  return (
    <>
      <PageHeader title="Products" description="Catalogue of items you buy and stock."
        actions={<Can permission="product:write"><Button variant="outline" onClick={() => setCatOpen(true)}><Tags className="h-4 w-4" /> New category</Button><Button onClick={openCreate}><Plus className="h-4 w-4" /> New product</Button></Can>} />
      <ListCard filters={<>
        <SearchInput value={ls.q} onChange={ls.setQ} placeholder="Search name or SKU" />
        <Select aria-label="Category filter" className="w-full sm:w-48" value={ls.filters.category_id} onChange={(e) => ls.setFilter('category_id', e.target.value)}>
          <option value="">All categories</option>
          {categories?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Select aria-label="Active filter" className="w-full sm:w-36" value={ls.filters.active} onChange={(e) => ls.setFilter('active', e.target.value)}>
          <option value="">All statuses</option><option value="true">Active</option><option value="false">Inactive</option>
        </Select>
        {isFetching && !isLoading && <span className="text-xs text-muted-foreground">Updating…</span>}
      </>}>
        <DataTable columns={columns} rows={data?.items} rowKey={(p) => p.id} loading={isLoading} error={error} onRetry={() => void refetch()}
          sort={ls.sort} order={ls.order} onSort={ls.toggleSort} onRowClick={setSelected} emptyTitle="No products found" />
        {data && <Pagination page={data.page} pageSize={data.page_size} total={data.total} onPageChange={ls.setPage} onPageSizeChange={ls.setPageSize} />}
      </ListCard>

      <Drawer open={!!selected} onOpenChange={(o) => !o && setSelected(null)} title={selected?.name ?? ''} width="max-w-lg"
        subtitle={selected && <span className="font-mono">{selected.sku}</span>}
        actions={selected && <Can permission="product:write"><Button size="sm" variant="outline" onClick={() => { openEdit(selected); setSelected(null) }}><Pencil className="h-4 w-4" /> Edit</Button></Can>}>
        {selected && (
          <KeyValue items={[
            { label: 'Status', value: <StatusBadge status={selected.is_active ? 'active' : 'inactive'} /> },
            { label: 'Category', value: selected.category.name },
            { label: 'Unit price', value: fmtMoney(selected.unit_price) },
            { label: 'Unit of measure', value: selected.unit_of_measure },
            { label: 'Manufacturer', value: selected.manufacturer },
            { label: 'Description', value: selected.description },
            { label: 'Created', value: fmtDateTime(selected.created_at) },
            { label: 'Updated', value: fmtDateTime(selected.updated_at) },
          ]} />
        )}
      </Drawer>

      <ProductDialog open={formOpen} onOpenChange={setFormOpen} product={editing} />
      <CategoryDialog open={catOpen} onOpenChange={setCatOpen} />
      <ConfirmDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)} destructive title="Delete product"
        description={<>Delete <strong>{toDelete?.name}</strong> ({toDelete?.sku})? This cannot be undone. Products that are referenced by orders, requests or inventory cannot be deleted.</>}
        confirmLabel="Delete" loading={del.isPending}
        onConfirm={() => { if (toDelete) del.mutate(toDelete.id, { onSettled: () => setToDelete(null) }) }} />
    </>
  )
}
