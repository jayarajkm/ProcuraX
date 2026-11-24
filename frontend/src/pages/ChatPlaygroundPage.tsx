import { ArrowLeft, Info, Loader2, MessageSquarePlus, Send } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { ApprovalCallout } from '@/components/chat/ApprovalCallout'
import { botStyle } from '@/components/chat/chatbotStyles'
import { ResponseDetails } from '@/components/chat/ResponseDetails'
import { RichText } from '@/components/chat/RichText'
import { ErrorState } from '@/components/ErrorState'
import { DetailSkeleton } from '@/components/Skeletons'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Textarea } from '@/components/ui/input'
import { errorMessage } from '@/lib/api'
import { fetchChatMessages, useChatbot, useChatSessions, useSendChat } from '@/hooks/api'
import { fmtDateTime } from '@/lib/format'
import type { ChatMetadata } from '@/lib/types'
import { cn } from '@/lib/utils'
import { BotAvailability, LlmNotice } from './ChatbotsPage'

interface Msg { key: string; role: 'user' | 'assistant'; content: string; metadata?: ChatMetadata | null }

function Elapsed({ llm }: { llm: boolean }) {
  const [s, setS] = useState(0)
  useEffect(() => { const t = setInterval(() => setS((x) => x + 1), 1000); return () => clearInterval(t) }, [])
  return (
    <div role="status" aria-live="polite" className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      {llm ? `Waiting for the language model… ${s}s (this can take up to 2 minutes)` : `Thinking… ${s}s`}
    </div>
  )
}

export function ChatPlaygroundPage() {
  const { slug = '' } = useParams()
  // remount per bot so thread state never leaks between bots
  return <Playground key={slug} slug={slug} />
}

function Playground({ slug }: { slug: string }) {
  const bot = useChatbot(slug)
  const sessions = useChatSessions(slug)
  const send = useSendChat(slug)
  const [params] = useSearchParams()
  const [input, setInput] = useState(params.get('q') ?? '')
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastSent, setLastSent] = useState<string | null>(null)
  const [loadingHistory, setLoadingHistory] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)
  const seq = useRef(0)

  useEffect(() => { endRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' }) }, [msgs, send.isPending])

  const submit = (text: string) => {
    const message = text.trim()
    if (!message || send.isPending) return
    setError(null); setLastSent(message); setInput('')
    setMsgs((m) => [...m, { key: `u${seq.current++}`, role: 'user', content: message }])
    send.mutate({ message, session_id: sessionId }, {
      onSuccess: (r) => {
        setSessionId(r.session_id)
        setMsgs((m) => [...m, { key: r.message_id, role: 'assistant', content: r.reply, metadata: r.metadata }])
      },
      onError: (e) => setError(errorMessage(e)),
    })
  }

  const openSession = async (id: string) => {
    if (send.isPending) return
    setLoadingHistory(true); setError(null)
    try {
      const rows = await fetchChatMessages(id)
      setMsgs(rows.map((r) => ({ key: r.id, role: r.role === 'user' ? 'user' : 'assistant', content: r.content, metadata: r.metadata })))
      setSessionId(id)
    } catch (e) { toast.error(errorMessage(e)) } finally { setLoadingHistory(false) }
  }
  const newConversation = () => { if (send.isPending) return; setMsgs([]); setSessionId(null); setError(null); setLastSent(null) }

  if (bot.isLoading) return <DetailSkeleton />
  if (bot.error || !bot.data) return <Card><ErrorState error={bot.error} title="Chatbot not found" onRetry={() => void bot.refetch()} /></Card>
  const b = bot.data
  const s = botStyle(b.slug)
  const Icon = s.icon
  const disabled = !b.available || (b.requires_llm && !b.configured)

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link to="/chatbots" className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" />All chatbots</Link>
        <Card className={cn('border-t-4 p-4', s.border)}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className={cn('rounded-lg p-2.5', s.bg, s.text)}><Icon className="h-6 w-6" /></div>
              <div><h1 className="text-xl font-semibold">{b.name}</h1><p className="text-sm text-muted-foreground">{b.description}</p></div>
            </div>
            <BotAvailability bot={b} />
          </div>
          <details className="mt-3 rounded-md bg-muted/40 p-3 text-sm" open>
            <summary className="flex cursor-pointer items-center gap-1.5 font-medium"><Info className="h-4 w-4" />How it works</summary>
            <p className="mt-2">{b.technology}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">{b.use_cases.map((u) => <span key={u} className={cn('rounded-full px-2 py-0.5 text-xs', s.bg, s.text)}>{u}</span>)}</div>
          </details>
          <div className="mt-3"><LlmNotice bot={b} /></div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
        <Card className="flex max-h-[28rem] flex-col overflow-hidden lg:max-h-[38rem]">
          <div className="border-b p-3"><Button size="sm" className="w-full" onClick={newConversation} disabled={send.isPending}><MessageSquarePlus className="h-4 w-4" />New conversation</Button></div>
          <div className="flex-1 overflow-y-auto p-2" aria-label="Conversation history">
            {sessions.isLoading ? <p className="p-2 text-sm text-muted-foreground">Loading…</p>
              : sessions.error ? <p role="alert" className="p-2 text-sm text-destructive">Could not load history. <button className="underline" onClick={() => void sessions.refetch()}>Retry</button></p>
              : !sessions.data?.length ? <p className="p-2 text-sm text-muted-foreground">No earlier conversations.</p>
              : <ul className="space-y-1">{sessions.data.map((x) => (
                <li key={x.id}>
                  <button type="button" onClick={() => void openSession(x.id)} aria-current={x.id === sessionId}
                    className={cn('w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted', x.id === sessionId && 'bg-accent font-medium')}>
                    <div className="truncate">{x.title || 'Untitled conversation'}</div>
                    <div className="text-xs text-muted-foreground">{fmtDateTime(x.created_at)}</div>
                  </button>
                </li>))}</ul>}
          </div>
        </Card>

        <Card className="flex min-h-[28rem] flex-col">
          <div className="flex-1 space-y-4 overflow-y-auto p-4 lg:max-h-[32rem]" aria-label="Conversation" aria-live="polite">
            {loadingHistory ? <DetailSkeleton /> : msgs.length === 0 ? (
              <div className="py-6 text-center">
                <p className="text-sm text-muted-foreground">Start a conversation, or click an example:</p>
                <div className="mt-3 flex flex-wrap justify-center gap-2">
                  {b.example_prompts.map((p) => (
                    <button key={p} type="button" disabled={disabled || send.isPending} onClick={() => submit(p)}
                      className={cn('rounded-full border px-3 py-1.5 text-left text-sm hover:bg-muted disabled:opacity-50', s.text)}>{p}</button>
                  ))}
                </div>
              </div>
            ) : msgs.map((m) => (
              <div key={m.key} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
                <div className={cn('max-w-[90%] rounded-lg px-3.5 py-2.5 text-sm', m.role === 'user' ? 'bg-primary text-primary-foreground' : 'border bg-card')}>
                  <div className="break-words"><RichText text={m.content} /></div>
                  {m.role === 'assistant' && m.metadata && <><ApprovalCallout metadata={m.metadata} /><ResponseDetails metadata={m.metadata} /></>}
                </div>
              </div>
            ))}
            {send.isPending && <div className="flex justify-start"><div className="rounded-lg border bg-card px-3.5 py-2.5"><Elapsed llm={b.requires_llm} /></div></div>}
            {error && (
              <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                <span>{error}</span>
                {lastSent && <Button size="sm" variant="outline" onClick={() => submit(lastSent)}>Retry</Button>}
              </div>
            )}
            <div ref={endRef} />
          </div>
          <form className="flex items-end gap-2 border-t p-3" onSubmit={(e) => { e.preventDefault(); submit(input) }}>
            <Textarea aria-label="Message" className="min-h-[44px] flex-1 resize-none" rows={2} maxLength={2000} value={input} disabled={disabled}
              placeholder={disabled ? 'This chatbot is not available' : 'Type your message… (Enter to send, Shift+Enter for a new line)'}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(input) } }} />
            <Button type="submit" disabled={disabled || send.isPending || !input.trim()}><Send className="h-4 w-4" />Send</Button>
          </form>
        </Card>
      </div>
    </div>
  )
}
