import { MessageSquareText, Search } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/ErrorState'
import { PageHeader } from '@/components/PageHeader'
import { SimilarityBar } from '@/components/chat/ResponseDetails'
import { TableSkeleton } from '@/components/Skeletons'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input, Select } from '@/components/ui/input'
import { Field } from '@/components/ui/label'
import { useDocSearch } from '@/hooks/api'
import { titleCase } from '@/lib/format'
import { DOC_CATEGORIES } from './documentRules'

export function KnowledgePage() {
  const [text, setText] = useState('')
  const [submitted, setSubmitted] = useState('')
  const [topK, setTopK] = useState(5)
  const [minSim, setMinSim] = useState(0.3)
  const [category, setCategory] = useState('')
  const { data, isFetching, error, refetch } = useDocSearch({ q: submitted, top_k: topK, min_similarity: minSim, category: category || undefined })
  const navigate = useNavigate()
  const valid = text.trim().length >= 2

  return (
    <>
      <PageHeader title="Knowledge Center" description="Semantic search across indexed documents. Matches are ranked by embedding similarity, not keywords." />
      <Card className="mb-4">
        <CardContent>
          <form className="grid gap-4 md:grid-cols-[1fr_auto]" onSubmit={(e) => { e.preventDefault(); if (valid) setSubmitted(text.trim()) }}>
            <div className="space-y-4">
              <Field label="Search query" htmlFor="kc-q" hint="At least 2 characters.">
                <div className="relative"><Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input id="kc-q" className="pl-8" placeholder="e.g. Who must approve a purchase above $5,000?" value={text} onChange={(e) => setText(e.target.value)} /></div>
              </Field>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Results (top k)" htmlFor="kc-k">
                  <Select id="kc-k" value={topK} onChange={(e) => setTopK(Number(e.target.value))}>{[3, 5, 10, 15, 20].map((n) => <option key={n} value={n}>{n}</option>)}</Select>
                </Field>
                <Field label={`Minimum similarity: ${minSim.toFixed(2)}`} htmlFor="kc-s">
                  <input id="kc-s" type="range" min={0} max={1} step={0.05} value={minSim} onChange={(e) => setMinSim(Number(e.target.value))} className="h-9 w-full accent-primary" />
                </Field>
                <Field label="Category" htmlFor="kc-c">
                  <Select id="kc-c" value={category} onChange={(e) => setCategory(e.target.value)}><option value="">All</option>{DOC_CATEGORIES.map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}</Select>
                </Field>
              </div>
            </div>
            <div className="flex items-end"><Button type="submit" disabled={!valid || isFetching}><Search className="h-4 w-4" />{isFetching ? 'Searching…' : 'Search'}</Button></div>
          </form>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <Card>
          <CardHeader><CardTitle>Results{data ? ` (${data.results.length})` : ''}</CardTitle></CardHeader>
          {!submitted ? <EmptyState title="Search the knowledge base" description="Enter a question or topic above." />
            : error ? <ErrorState error={error} onRetry={() => void refetch()} />
            : isFetching && !data ? <TableSkeleton rows={4} cols={2} />
            : !data?.results.length ? <EmptyState title="No passages found" description="Nothing met the similarity threshold. Try lowering the minimum similarity or rewording the query." />
            : (
              <ul className="divide-y">
                {data.results.map((r, i) => (
                  <li key={`${r.document_id}-${r.chunk_index}`} className="space-y-1.5 p-4" data-testid="search-hit">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">{i + 1}. {r.title}{r.page != null && <span className="font-normal text-muted-foreground"> · page {r.page}</span>}</span>
                      <SimilarityBar value={r.similarity} />
                    </div>
                    <p className="text-xs text-muted-foreground">{r.filename} · chunk {r.chunk_index}</p>
                    <p className="whitespace-pre-wrap break-words text-sm">{r.content}</p>
                  </li>
                ))}
              </ul>
            )}
        </Card>
        <Card className="h-fit">
          <CardHeader><CardTitle>Ask the RAG chatbot</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="text-muted-foreground">Want a written answer instead of passages? The RAG chatbot retrieves the same passages and answers from them, with citations.</p>
            <Button disabled={!valid} className="w-full" onClick={() => navigate(`/chatbots/rag?q=${encodeURIComponent(text.trim())}`)}>
              <MessageSquareText className="h-4 w-4" />Ask the RAG chatbot
            </Button>
            {!valid && <p className="text-xs text-muted-foreground">Type a query above to prefill the chatbot.</p>}
          </CardContent>
        </Card>
      </div>
    </>
  )
}
