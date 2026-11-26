import type { BreakOption, Ownership, ShortageAction, Tier } from '@/lib/types'

export interface TierDraft { min_qty: string; unit_price: string }

/** Mirrors backend rules: whole qty >= 1, price >= 0, unique qty, higher qty must not cost more per unit. Returns a message or null. */
export function validateTiers(rows: TierDraft[]): string | null {
  const parsed: { q: number; p: number }[] = []
  for (const [i, r] of rows.entries()) {
    const q = Number(r.min_qty), p = Number(r.unit_price)
    if (!/^\d+$/.test(r.min_qty.trim()) || q < 1) return `Row ${i + 1}: minimum quantity must be a whole number of 1 or more`
    if (r.unit_price.trim() === '' || !Number.isFinite(p) || p < 0) return `Row ${i + 1}: unit price must be 0 or more`
    parsed.push({ q, p })
  }
  if (new Set(parsed.map((x) => x.q)).size !== parsed.length) return 'Two tiers have the same minimum quantity'
  const s = [...parsed].sort((a, b) => a.q - b.q)
  for (let i = 0; i < s.length - 1; i++) if (s[i + 1].p > s[i].p) return 'A higher quantity tier must not cost more per unit than a lower one'
  return null
}

/** The tier that applies to qty: highest min_qty <= qty, or null below the first break. */
export function activeTier(tiers: Tier[], qty: number): Tier | null {
  let hit: Tier | null = null
  for (const t of [...tiers].sort((a, b) => a.min_qty - b.min_qty)) if (qty >= t.min_qty) hit = t
  return hit
}

const usd = (v: string | number) => `$${Number(v).toFixed(2)}`
const n = (v: number) => v.toLocaleString('en-US')

export function breakOptionText(b: BreakOption): string {
  return `buy ${n(b.min_qty)} for ${usd(b.unit_price)}/unit (saves ${usd(b.saving_per_unit)}/unit, +${n(b.extra_units)} units, +${usd(b.extra_cost)})`
}

export function nextBreakHint(current: number, next: Tier | null): string | null {
  return next ? `Buy ${n(next.min_qty - current)} more to get ${usd(next.unit_price)}/unit` : null
}

export const OWNERSHIP_LABEL: Record<Ownership, string> = { self: 'Own stock', vendor: 'Vendor-owned', customer: 'Customer-owned' }
export const OWNERSHIP_TONE: Record<Ownership, 'green' | 'purple' | 'amber'> = { self: 'green', vendor: 'purple', customer: 'amber' }
export const ACTION_LABEL: Record<ShortageAction, string> = { purchase: 'Purchase', consignment: 'Consignment', notify_customer: 'Notify customer', no_supplier: 'No supplier' }
export const ACTION_TONE: Record<ShortageAction, 'blue' | 'purple' | 'amber' | 'red'> = { purchase: 'blue', consignment: 'purple', notify_customer: 'amber', no_supplier: 'red' }
