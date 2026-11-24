import { AlertTriangle, ArrowRight, CheckCircle2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { botStyle } from '@/components/chat/chatbotStyles'
import { ErrorState } from '@/components/ErrorState'
import { PageHeader } from '@/components/PageHeader'
import { CardSkeleton } from '@/components/Skeletons'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { useChatbots } from '@/hooks/api'
import { cn } from '@/lib/utils'
import type { ChatbotType } from '@/lib/types'

export const LLM_NOT_CONFIGURED = 'LLM provider not configured — set a key in the server .env'

export function LlmNotice({ bot }: { bot: ChatbotType }) {
  if (!bot.requires_llm || bot.configured) return null
  return (
    <div role="status" className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{LLM_NOT_CONFIGURED}. The other chatbots (rule-based, NLP, ML) work without one.</span>
    </div>
  )
}

export function BotAvailability({ bot }: { bot: ChatbotType }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <Badge tone={bot.available ? 'green' : 'neutral'}>{bot.available ? 'Available' : 'Not available'}</Badge>
      {bot.requires_llm
        ? <Badge tone={bot.configured ? 'green' : 'amber'}>{bot.configured ? <><CheckCircle2 className="h-3 w-3" />LLM configured</> : 'LLM not configured'}</Badge>
        : <Badge tone="neutral">No LLM needed</Badge>}
    </div>
  )
}

export function ChatbotsPage() {
  const { data, isLoading, error, refetch } = useChatbots()
  return (
    <>
      <PageHeader title="AI Chatbots" description="Six assistants, six techniques: from fixed rules to a supervised agent. Each one explains how it produced every answer." />
      {error && !data ? <Card><ErrorState error={error} onRetry={() => void refetch()} /></Card> : isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <CardSkeleton key={i} />)}</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data?.map((bot) => {
            const s = botStyle(bot.slug)
            const Icon = s.icon
            return (
              <Card key={bot.slug} data-testid={`bot-card-${bot.slug}`} className={cn('flex flex-col gap-3 border-t-4 p-5', s.border)}>
                <div className="flex items-start gap-3">
                  <div className={cn('rounded-lg p-2.5', s.bg, s.text)}><Icon className="h-6 w-6" /></div>
                  <div className="min-w-0">
                    <h2 className="font-semibold">{bot.name}</h2>
                    <p className="text-sm text-muted-foreground">{bot.description}</p>
                  </div>
                </div>
                <BotAvailability bot={bot} />
                <LlmNotice bot={bot} />
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">How it works</div>
                  <p className="mt-0.5 text-sm">{bot.technology}</p>
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Use cases</div>
                  <div className="mt-1 flex flex-wrap gap-1.5">{bot.use_cases.map((u) => <span key={u} className={cn('rounded-full px-2 py-0.5 text-xs', s.bg, s.text)}>{u}</span>)}</div>
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Try asking</div>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4 text-sm text-muted-foreground">{bot.example_prompts.map((p) => <li key={p}>{p}</li>)}</ul>
                </div>
                <Link to={`/chatbots/${bot.slug}`} className={cn('mt-auto inline-flex items-center gap-1 pt-1 text-sm font-medium hover:underline', s.text)}>
                  Open playground <ArrowRight className="h-4 w-4" />
                </Link>
              </Card>
            )
          })}
        </div>
      )}
    </>
  )
}
