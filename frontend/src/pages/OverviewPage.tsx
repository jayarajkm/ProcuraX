import { AlertTriangle, ClipboardList, DollarSign, Package, ShoppingCart, Timer, Truck, type LucideIcon } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { InsightsPanel } from '@/components/InsightsPanel'
import { ErrorState } from '@/components/ErrorState'
import { EmptyState } from '@/components/EmptyState'
import { PageHeader } from '@/components/PageHeader'
import { CardSkeleton } from '@/components/Skeletons'
import { Skeleton } from '@/components/ui/skeleton'
import { StatusBadge } from '@/components/StatusBadge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useOverview } from '@/hooks/api'
import { fmtDateTime, fmtMoney, fmtNumber, fmtPercent, titleCase } from '@/lib/format'
import { Link } from 'react-router-dom'

const STATUS_COLORS: Record<string, string> = {
  draft: '#94a3b8', pending_approval: '#f59e0b', approved: '#3b82f6', sent: '#8b5cf6',
  partially_received: '#06b6d4', received: '#10b981', cancelled: '#ef4444',
}

function StatCard({ label, value, icon: Icon, tone = 'text-primary bg-accent', to }: { label: string; value: string; icon: LucideIcon; tone?: string; to?: string }) {
  const body = (
    <Card className="h-full p-4 transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
        </div>
        <div className={`rounded-md p-2 ${tone}`}><Icon className="h-5 w-5" /></div>
      </div>
    </Card>
  )
  return to ? <Link to={to}>{body}</Link> : body
}

export function OverviewPage() {
  const { data, isLoading, error, refetch } = useOverview()

  if (error && !data) return (<><PageHeader title="Overview" /><Card><ErrorState error={error} onRetry={() => void refetch()} /></Card></>)

  const statusData = data ? Object.entries(data.po_status_breakdown).map(([status, count]) => ({ status, name: titleCase(status), count })) : []
  const perf = (data?.supplier_performance ?? []).map((s) => ({ ...s, onTimePct: s.on_time_rate === null ? null : Math.round(s.on_time_rate * 100) }))

  return (
    <>
      <PageHeader title="Overview" description="Live procurement KPIs computed from the database." />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {isLoading || !data ? Array.from({ length: 8 }).map((_, i) => <CardSkeleton key={i} />) : (
          <>
            <StatCard label="Total products" value={fmtNumber(data.total_products)} icon={Package} to="/products" />
            <StatCard label="Suppliers" value={fmtNumber(data.total_suppliers)} icon={Truck} to="/suppliers" />
            <StatCard label="Inventory value" value={fmtMoney(data.inventory_value)} icon={DollarSign} tone="text-emerald-700 bg-emerald-50" to="/inventory" />
            <StatCard label="Low-stock products" value={fmtNumber(data.low_stock_products)} icon={AlertTriangle} tone="text-red-700 bg-red-50" to="/inventory" />
            <StatCard label="Open purchase orders" value={fmtNumber(data.open_purchase_orders)} icon={ShoppingCart} to="/purchase-orders" />
            <StatCard label="Overdue purchase orders" value={fmtNumber(data.overdue_purchase_orders)} icon={Timer} tone="text-amber-700 bg-amber-50" to="/purchase-orders" />
            <StatCard label="Pending requests" value={fmtNumber(data.pending_purchase_requests)} icon={ClipboardList} to="/requests" />
            <StatCard label="Low-stock records" value={fmtNumber(data.low_stock_records)} icon={AlertTriangle} tone="text-red-700 bg-red-50" to="/inventory" />
          </>
        )}
      </div>

      <InsightsPanel />

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Purchase orders by status</CardTitle></CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-64" /> : statusData.length === 0 ? <EmptyState title="No purchase orders yet" /> : (
              <div className="h-64" role="img" aria-label="Donut chart of purchase orders by status">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={statusData} dataKey="count" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2}>
                      {statusData.map((d) => <Cell key={d.status} fill={STATUS_COLORS[d.status] ?? '#64748b'} />)}
                    </Pie>
                    <Tooltip />
                    <Legend verticalAlign="middle" align="right" layout="vertical" />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Supplier on-time delivery rate (top suppliers by volume)</CardTitle></CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-64" /> : perf.length === 0 ? <EmptyState title="No supplier data" /> : (
              <div className="h-64" role="img" aria-label="Bar chart of supplier on-time delivery rate">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={perf} layout="vertical" margin={{ left: 10, right: 16 }}>
                    <CartesianGrid horizontal={false} strokeDasharray="3 3" />
                    <XAxis type="number" domain={[0, 100]} unit="%" fontSize={11} />
                    <YAxis type="category" dataKey="name" width={130} fontSize={11} />
                    <Tooltip formatter={(v) => (v === null || v === undefined ? 'No received orders' : `${v}%`)} />
                    <Bar dataKey="onTimePct" name="On-time rate" fill="#2563eb" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader><CardTitle>Supplier performance</CardTitle></CardHeader>
          {isLoading ? <CardContent><Skeleton className="h-40" /></CardContent> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/60 text-xs uppercase text-muted-foreground">
                  <tr><th className="px-4 py-2 text-left">Supplier</th><th className="px-4 py-2 text-right">Rating</th><th className="px-4 py-2 text-right">Orders</th><th className="px-4 py-2 text-right">Received</th><th className="px-4 py-2 text-right">On-time</th></tr>
                </thead>
                <tbody className="divide-y">
                  {perf.map((s) => (
                    <tr key={s.id}>
                      <td className="px-4 py-2"><div className="font-medium">{s.name}</div><div className="text-xs text-muted-foreground">{s.code}</div></td>
                      <td className="px-4 py-2 text-right tabular-nums">{s.rating.toFixed(2)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{s.orders}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{s.received}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmtPercent(s.on_time_rate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Recent activity</CardTitle></CardHeader>
          {isLoading ? <CardContent><Skeleton className="h-40" /></CardContent> : (data?.recent_activity.length ?? 0) === 0 ? <EmptyState title="No recent activity" /> : (
            <ul className="divide-y">
              {data?.recent_activity.map((a, i) => (
                <li key={`${a.po_number}-${a.at}-${i}`} className="flex items-center justify-between gap-2 px-5 py-2.5 text-sm">
                  <div><span className="font-medium">{a.po_number}</span><div className="text-xs text-muted-foreground">{fmtDateTime(a.at)}</div></div>
                  <StatusBadge status={a.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  )
}
