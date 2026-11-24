const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const moneyCompact = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 2 })
const num = new Intl.NumberFormat('en-US')

export const fmtMoney = (v: string | number | null | undefined) =>
  v === null || v === undefined || v === '' ? '—' : money.format(Number(v))
export const fmtMoneyCompact = (v: string | number) => moneyCompact.format(Number(v))
export const fmtNumber = (v: number | string | null | undefined) =>
  v === null || v === undefined ? '—' : num.format(Number(v))
export const fmtPercent = (v: number | null | undefined) =>
  v === null || v === undefined ? '—' : `${(v * 100).toFixed(0)}%`

export function fmtDate(v: string | null | undefined) {
  if (!v) return '—'
  const d = new Date(v.length === 10 ? `${v}T00:00:00` : v)
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}
export function fmtDateTime(v: string | null | undefined) {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime())
    ? v
    : d.toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
export const titleCase = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
