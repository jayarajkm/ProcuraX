import { Loader2, Send } from 'lucide-react'
import { useRef, useState } from 'react'
import { useAuth } from '@/auth/AuthContext'
import { BOT_NAMES, CompareCard, CompareSummary, type BotRun } from '@/components/compare/CompareCard'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/input'
import { compareBot } from '@/hooks/api'
import { COMPARE_BOTS } from '@/lib/types'
import { botStyle } from '@/components/chat/chatbotStyles'

export const EXAMPLES = ['Which products need to be reordered?', 'Show my open purchase orders', 'What is the purchase approval threshold?']
type Runs = Record<string, BotRun>
const idle = (): Runs => Object.fromEntries(COMPARE_BOTS.map((s) => [s, { phase: 'idle' } as BotRun]))

export function ComparePage() {
  const { can } = useAuth()
  const [question, setQuestion] = useState('')
  const [included, setIncluded] = useState<Record<string, boolean>>(() => Object.fromEntries(COMPARE_BOTS.map((s) => [s, true])))
  const [runs, setRuns] = useState<Runs>(idle)
  const runId = useRef(0)
  const running = Object.values(runs).some((r) => r.phase === 'running')
  const chosen = COMPARE_BOTS.filter((s) => included[s])

  const start = (q = question) => {
    const message = q.trim()
    if (!message || chosen.length === 0 || running) return
    const id = ++runId.current
    const startedAt = Date.now()
    setRuns(Object.fromEntries(COMPARE_BOTS.map((s) => [s, chosen.includes(s) ? { phase: 'running', startedAt } : { phase: 'idle' }])) as Runs)
    // Independent, parallel requests: each card fills in as its own request returns.
    chosen.forEach((slug) => {
      void compareBot(slug, message).then((result) => {
        if (runId.current !== id) return
        setRuns((cur) => ({ ...cur, [slug]: { phase: 'done', startedAt, result } }))
      })
    })
  }

  const anyStarted = COMPARE_BOTS.some((s) => runs[s].phase !== 'idle')
  return (
    <>
      <PageHeader title="Chatbot Comparison" description="Ask one question and see how all six chatbot techniques answer it, side by side." />
      <div role="note" className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        Honest note: the first five bots are read-only. The Agentic bot may create a persisted execution (visible in Agent Workspace) that can stop awaiting human approval, but it never commits a business action on its own. The comparison does not store chat sessions.
      </div>
      {!can('chat:use') && <div role="alert" className="mb-4 rounded-md border bg-muted/50 p-3 text-sm text-muted-foreground">Your role does not have chat:use, so the bots will refuse to answer.</div>}
      <Card className="mb-6">
        <CardContent className="space-y-3 pt-5">
          <label htmlFor="compare-q" className="text-sm font-medium">Your question</label>
          <Textarea id="compare-q" rows={2} maxLength={2000} value={question} placeholder="Ask a procurement question…" onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) start() }} />
          <div className="flex flex-wrap gap-2" aria-label="Example questions">
            {EXAMPLES.map((ex) => (
              <button key={ex} type="button" disabled={running} onClick={() => setQuestion(ex)} className="rounded-full border bg-card px-3 py-1 text-xs hover:bg-muted disabled:opacity-50">{ex}</button>
            ))}
          </div>
          <fieldset className="flex flex-wrap gap-x-4 gap-y-2">
            <legend className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Bots to include</legend>
            {COMPARE_BOTS.map((s) => (
              <label key={s} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={included[s]} disabled={running} onChange={(e) => setIncluded((c) => ({ ...c, [s]: e.target.checked }))} />
                <span className={botStyle(s).text}>{BOT_NAMES[s]}</span>
                {(s === 'agentic' || s === 'generative' || s === 'rag') && <span className="text-xs text-muted-foreground">{s === 'agentic' ? '(can take minutes)' : '(LLM, slower)'}</span>}
              </label>
            ))}
          </fieldset>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => start()} disabled={!question.trim() || chosen.length === 0 || running}>
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}{running ? 'Running…' : `Compare ${chosen.length} bot${chosen.length === 1 ? '' : 's'}`}
            </Button>
            {chosen.length === 0 && <span className="text-xs text-muted-foreground">Select at least one bot.</span>}
            {running && <span className="text-xs text-muted-foreground">Requests run in parallel; LLM and agent bots can take up to a few minutes.</span>}
          </div>
        </CardContent>
      </Card>

      {anyStarted && (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {COMPARE_BOTS.filter((s) => runs[s].phase !== 'idle').map((s) => <CompareCard key={s} slug={s} run={runs[s]} />)}
          </div>
          <Card className="mt-6 overflow-hidden">
            <CardHeader><CardTitle>Summary comparison</CardTitle></CardHeader>
            <CompareSummary rows={COMPARE_BOTS.map((s) => ({ slug: s, run: runs[s], included: included[s] }))} />
            <p className="border-t px-4 py-2 text-xs text-muted-foreground">Confidence values mean different things per technique (see each card) and are not comparable across bots. A dash means the technique produced none.</p>
          </Card>
        </>
      )}
    </>
  )
}
