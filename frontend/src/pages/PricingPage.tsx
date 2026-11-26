import { useEffect, useState } from 'react'
import { useAuth } from '@/auth/AuthContext'
import { ErrorState } from '@/components/ErrorState'
import { PageHeader } from '@/components/PageHeader'
import { SearchInput } from '@/components/SearchInput'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input, Select } from '@/components/ui/input'
import { Field } from '@/components/ui/label'
import { useCustomers, useProducts, useQuote, useSalesBreaks, useSaveSalesBreaks } from '@/hooks/api'
import { activeTier, nextBreakHint, validateTiers, type TierDraft } from '@/lib/distribution'
import { fmtMoney, fmtNumber } from '@/lib/format'

function QuotePanel({ product, customer }: { product: string; customer: string }) {
  const [qtyText, setQtyText] = useState('100')
  const qty = /^\d+$/.test(qtyText) ? Number(qtyText) : 0
  const { data, isLoading, error, refetch } = useQuote(product, qty, customer)
  const active = data ? activeTier(data.sell_breaks, qty) : null
  const hint = data ? nextBreakHint(qty, data.next_sell_break) : null
  return (
    <Card><CardContent className="space-y-4">
      <h2 className="font-semibold">Quote</h2>
      <Field label="Quantity" htmlFor="quote-qty" error={qty < 1 ? 'Enter a whole number of 1 or more' : undefined}>
        <Input id="quote-qty" inputMode="numeric" className="w-40" value={qtyText} onChange={(e) => setQtyText(e.target.value)} />
      </Field>
      {qty >= 1 && (error ? <ErrorState error={error} onRetry={() => void refetch()} /> : isLoading || !data ? <p className="text-sm text-muted-foreground">Calculating…</p> : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <div><p className="text-xs uppercase text-muted-foreground">Sell price / unit</p><p className="text-xl font-semibold">{fmtMoney(data.sell_unit_price)}</p><p className="text-xs text-muted-foreground">Total {fmtMoney(data.sell_total)}</p></div>
            <div><p className="text-xs uppercase text-muted-foreground">Cost / unit</p><p className="text-xl font-semibold">{fmtMoney(data.cost_unit_price)}</p><p className="text-xs text-muted-foreground">{data.supplier_name ?? 'No supplier'}{data.cost_total ? ` · ${fmtMoney(data.cost_total)}` : ''}</p></div>
            <div><p className="text-xs uppercase text-muted-foreground">Margin</p><p className="text-xl font-semibold">{fmtMoney(data.margin)}</p><p className={`text-xs ${data.margin_pct !== null && data.margin_pct < 0 ? 'text-destructive' : 'text-muted-foreground'}`}>{data.margin_pct === null ? '—' : `${data.margin_pct.toFixed(1)}%`}</p></div>
          </div>
          {hint && <p className="rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-800">{hint}</p>}
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-muted-foreground"><tr><th className="py-1 text-left">From qty</th><th className="py-1 text-right">Unit price</th><th /></tr></thead>
            <tbody className="divide-y">
              <tr className={!active ? 'bg-blue-50' : ''}><td className="py-1.5">1</td><td className="py-1.5 text-right">{fmtMoney(data.sell_breaks.length && data.sell_breaks[0].min_qty === 1 ? data.sell_breaks[0].unit_price : data.list_price)}</td><td className="pl-2">{!active && <Badge tone="blue">Applies</Badge>}</td></tr>
              {data.sell_breaks.filter((t) => t.min_qty > 1).map((t) => (
                <tr key={t.min_qty} className={active?.min_qty === t.min_qty ? 'bg-blue-50' : ''}>
                  <td className="py-1.5">{fmtNumber(t.min_qty)}+</td><td className="py-1.5 text-right">{fmtMoney(t.unit_price)}</td>
                  <td className="pl-2">{active?.min_qty === t.min_qty && <Badge tone="blue">Applies</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ))}
    </CardContent></Card>
  )
}

function TierEditor({ product, customer }: { product: string; customer: string }) {
  const { can } = useAuth()
  const { data, isLoading, error, refetch } = useSalesBreaks(product, customer)
  const save = useSaveSalesBreaks()
  const [rows, setRows] = useState<TierDraft[]>([])
  useEffect(() => { if (data) setRows(data.breaks.map((b) => ({ min_qty: String(b.min_qty), unit_price: String(b.unit_price) }))) }, [data])
  const problem = validateTiers(rows)
  const set = (i: number, k: keyof TierDraft, v: string) => setRows((r) => r.map((x, j) => (j === i ? { ...x, [k]: v } : x)))
  return (
    <Card><CardContent className="space-y-3">
      <div><h2 className="font-semibold">Sales price breaks</h2>
        <p className="text-xs text-muted-foreground">{customer ? 'Contract tiers for this customer (replace list tiers when present).' : 'List tiers used when a customer has no contract tiers.'} List price {data ? fmtMoney(data.list_price) : '…'}.</p></div>
      {error ? <ErrorState error={error} onRetry={() => void refetch()} /> : isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : (
        <>
          {rows.length === 0 && <p className="text-sm text-muted-foreground">No tiers: the base price applies at every quantity.</p>}
          {rows.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input aria-label={`Tier ${i + 1} minimum quantity`} inputMode="numeric" className="w-28" placeholder="Min qty" value={r.min_qty} disabled={!can('product:write')} onChange={(e) => set(i, 'min_qty', e.target.value)} />
              <Input aria-label={`Tier ${i + 1} unit price`} inputMode="decimal" className="w-32" placeholder="Unit price" value={r.unit_price} disabled={!can('product:write')} onChange={(e) => set(i, 'unit_price', e.target.value)} />
              {can('product:write') && <Button variant="ghost" size="sm" onClick={() => setRows((x) => x.filter((_, j) => j !== i))}>Remove</Button>}
            </div>
          ))}
          {problem && rows.length > 0 && <p role="alert" className="text-sm text-destructive">{problem}</p>}
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={!can('product:write') || rows.length >= 12} onClick={() => setRows((r) => [...r, { min_qty: '', unit_price: '' }])}>Add tier</Button>
            <Button size="sm" disabled={!can('product:write') || !!problem || save.isPending}
              onClick={() => save.mutate({ product, customer, breaks: rows.map((r) => ({ min_qty: Number(r.min_qty), unit_price: Number(r.unit_price) })) })}>{save.isPending ? 'Saving…' : 'Save tiers'}</Button>
          </div>
          {!can('product:write') && <p className="text-xs text-muted-foreground">You need product write access to edit tiers.</p>}
        </>
      )}
    </CardContent></Card>
  )
}

export function PricingPage() {
  const [q, setQ] = useState('')
  const [product, setProduct] = useState('')
  const [customer, setCustomer] = useState('')
  const products = useProducts({ q: q || undefined, page_size: 25 })
  const customers = useCustomers()
  return (
    <>
      <PageHeader title="Pricing & Breaks" description="Quantity price breaks: what we charge, what it costs us, and the margin at each quantity." />
      <Card className="mb-4"><CardContent className="flex flex-wrap items-end gap-3">
        <Field label="Find product"><SearchInput value={q} onChange={setQ} placeholder="Search product or SKU" /></Field>
        <Field label="Product" htmlFor="pricing-product">
          <Select id="pricing-product" className="w-full sm:w-80" value={product} onChange={(e) => setProduct(e.target.value)}>
            <option value="">Select a product…</option>{products.data?.items.map((p) => <option key={p.id} value={p.id}>{p.sku} — {p.name}</option>)}
          </Select>
        </Field>
        <Field label="Customer" htmlFor="pricing-customer">
          <Select id="pricing-customer" className="w-full sm:w-64" value={customer} onChange={(e) => setCustomer(e.target.value)}>
            <option value="">List price (no customer)</option>{customers.data?.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.segment.replace('_', ' ')})</option>)}
          </Select>
        </Field>
      </CardContent></Card>
      {!product ? <Card><p className="p-8 text-center text-sm text-muted-foreground">Choose a product to see quotes and edit its price breaks.</p></Card> : (
        <div className="grid gap-4 lg:grid-cols-2"><QuotePanel product={product} customer={customer} /><TierEditor product={product} customer={customer} /></div>
      )}
    </>
  )
}
