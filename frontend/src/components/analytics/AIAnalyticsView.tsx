import { useState, type ReactNode } from 'react'
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/ErrorState'
import { Select } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useAIAnalytics } from '@/hooks/api'
import { fmtNumber, titleCase } from '@/lib/format'

const num = (v: unknown) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v))
const fmtSecs = (v: unknown) => { const n = num(v); return n == null ? '—' : n >= 120 ? `${(n / 60).toFixed(1)} min` : `${n.toFixed(1)} s` }

function ChartCard({ title, empty, children, label }: { title: string; empty: boolean; children: ReactNode; label: string }) {
  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent>
        {empty ? <EmptyState title="No data in this window" description="Nothing has been recorded for this yet." />
          : <div className="h-64" role="img" aria-label={label}><ResponsiveContainer width="100%" height="100%">{children as React.ReactElement}</ResponsiveContainer></div>}
      </CardContent>
    </Card>
  )
}

export function AIAnalyticsView() {
  const [days, setDays] = useState(30)
  const { data, isLoading, error, refetch } = useAIAnalytics(days)
  const picker = (
    <div className="mb-4 flex items-center gap-2">
      <label htmlFor="an-days" className="text-sm text-muted-foreground">Window (applies to questions, per-day and agent executions)</label>
      <Select id="an-days" className="h-8 w-auto" value={days} onChange={(e) => setDays(Number(e.target.value))}>
        {[7, 30, 90, 365].map((d) => <option key={d} value={d}>Last {d} days</option>)}
      </Select>
    </div>
  )
  if (error && !data) return <Card><ErrorState error={error} onRetry={() => void refetch()} /></Card>
  if (isLoading || !data) return <div className="grid gap-4 lg:grid-cols-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-72" />)}</div>
  const bots = data.messages_by_bot.map((b) => ({ ...b, label: b.name.replace(/ (Chatbot|Assistant)$/, '') }))
  const totalQuestions = data.messages_by_bot.reduce((a, b) => a + b.questions, 0)
  const tools = data.tool_usage.map((t) => ({ ...t, ok: t.calls - t.errors }))
  const grid = <CartesianGrid strokeDasharray="3 3" vertical={false} />
  return (
    <div className="space-y-4">
      {picker}
      {data.note && <p role="note" className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">{data.note}{totalQuestions === 0 ? ' No questions have been recorded in this window.' : ''}</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Questions per bot" label="Bar chart of questions per chatbot" empty={totalQuestions === 0}>
          <BarChart data={bots} margin={{ left: 0, right: 8 }}>{grid}<XAxis dataKey="label" fontSize={11} interval={0} /><YAxis allowDecimals={false} fontSize={11} /><Tooltip /><Bar dataKey="questions" name="Questions" fill="#2563eb" radius={[4, 4, 0, 0]} /></BarChart>
        </ChartCard>
        <ChartCard title="Questions per day" label="Line chart of questions per day" empty={data.questions_per_day.length === 0}>
          <LineChart data={data.questions_per_day} margin={{ left: 0, right: 12 }}>{grid}<XAxis dataKey="day" fontSize={11} /><YAxis allowDecimals={false} fontSize={11} /><Tooltip /><Line type="monotone" dataKey="n" name="Questions" stroke="#2563eb" strokeWidth={2} dot /></LineChart>
        </ChartCard>
        <ChartCard title="Agent executions by status" label="Bar chart of agent executions by status" empty={data.agent_executions_by_status.length === 0}>
          <BarChart data={data.agent_executions_by_status.map((s) => ({ ...s, label: titleCase(s.status) }))}>{grid}<XAxis dataKey="label" fontSize={11} /><YAxis allowDecimals={false} fontSize={11} /><Tooltip /><Bar dataKey="n" name="Executions" fill="#e11d48" radius={[4, 4, 0, 0]} /></BarChart>
        </ChartCard>
        <ChartCard title="Tool usage (all time)" label="Stacked bar chart of agent tool calls and errors" empty={tools.length === 0}>
          <BarChart data={tools} layout="vertical" margin={{ left: 10, right: 12 }}><CartesianGrid horizontal={false} strokeDasharray="3 3" /><XAxis type="number" allowDecimals={false} fontSize={11} /><YAxis type="category" dataKey="tool_name" width={150} fontSize={11} /><Tooltip /><Legend />
            <Bar dataKey="ok" name="Calls without error" stackId="a" fill="#10b981" /><Bar dataKey="errors" name="Errors" stackId="a" fill="#ef4444" /></BarChart>
        </ChartCard>
        <ChartCard title="Documents by status" label="Bar chart of documents by status" empty={data.documents_by_status.length === 0}>
          <BarChart data={data.documents_by_status.map((s) => ({ ...s, label: titleCase(s.status) }))}>{grid}<XAxis dataKey="label" fontSize={11} /><YAxis allowDecimals={false} fontSize={11} /><Tooltip /><Bar dataKey="n" name="Documents" fill="#d97706" radius={[4, 4, 0, 0]} /></BarChart>
        </ChartCard>
        <ChartCard title="ML predictions per model version" label="Bar chart of ML predictions per model version" empty={data.ml_predictions_by_model.length === 0}>
          <BarChart data={data.ml_predictions_by_model.map((m) => ({ ...m, label: `${titleCase(m.name)} ${m.version}` }))}>{grid}<XAxis dataKey="label" fontSize={10} interval={0} tick={false} /><YAxis allowDecimals={false} fontSize={11} /><Tooltip /><Bar dataKey="predictions" name="Predictions" fill="#059669" radius={[4, 4, 0, 0]} /></BarChart>
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="overflow-hidden">
          <CardHeader><CardTitle>Agent approvals</CardTitle></CardHeader>
          {data.approvals.length === 0 ? <EmptyState title="No approvals recorded" description="No agent action has needed a human decision yet." /> : (
            <table className="w-full text-sm" aria-label="Approvals">
              <thead className="bg-muted/60 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-4 py-2">Status</th><th className="px-4 py-2 text-right">Count</th><th className="px-4 py-2 text-right">Avg time to decide</th></tr></thead>
              <tbody className="divide-y">{data.approvals.map((a) => <tr key={a.status}><td className="px-4 py-2">{titleCase(a.status)}</td><td className="px-4 py-2 text-right tabular-nums">{fmtNumber(a.n)}</td><td className="px-4 py-2 text-right tabular-nums">{fmtSecs(a.avg_seconds_to_decide)}</td></tr>)}</tbody>
            </table>
          )}
        </Card>
        <Card className="overflow-hidden">
          <CardHeader><CardTitle>ML model versions</CardTitle></CardHeader>
          {data.ml_predictions_by_model.length === 0 ? <EmptyState title="No model versions registered" /> : (
            <table className="w-full text-sm" aria-label="ML predictions">
              <thead className="bg-muted/60 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-4 py-2">Model</th><th className="px-4 py-2">Version</th><th className="px-4 py-2 text-right">Predictions</th><th className="px-4 py-2 text-right">Avg confidence</th></tr></thead>
              <tbody className="divide-y">{data.ml_predictions_by_model.map((m) => {
                const c = num(m.avg_confidence)
                return <tr key={`${m.name}-${m.version}`}><td className="px-4 py-2">{titleCase(m.name)}</td><td className="px-4 py-2 font-mono text-xs">{m.version}</td><td className="px-4 py-2 text-right tabular-nums">{fmtNumber(m.predictions)}</td><td className="px-4 py-2 text-right tabular-nums">{c == null ? '—' : c.toFixed(3)}</td></tr>
              })}</tbody>
            </table>
          )}
        </Card>
      </div>
    </div>
  )
}
