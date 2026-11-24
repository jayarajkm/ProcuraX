import { Bot, BrainCircuit, Cpu, FileSearch, ListChecks, MessagesSquare, Workflow, type LucideIcon } from 'lucide-react'

export interface BotStyle { icon: LucideIcon; label: string; text: string; bg: string; border: string; bar: string; ring: string }

// Static class names so Tailwind can see them.
export const BOT_STYLES: Record<string, BotStyle> = {
  rule_based: { icon: ListChecks, label: 'Rules', text: 'text-slate-700', bg: 'bg-slate-100', border: 'border-t-slate-500', bar: 'bg-slate-500', ring: 'ring-slate-300' },
  nlp: { icon: MessagesSquare, label: 'NLP', text: 'text-sky-700', bg: 'bg-sky-100', border: 'border-t-sky-500', bar: 'bg-sky-500', ring: 'ring-sky-300' },
  ml: { icon: Cpu, label: 'ML', text: 'text-emerald-700', bg: 'bg-emerald-100', border: 'border-t-emerald-500', bar: 'bg-emerald-500', ring: 'ring-emerald-300' },
  generative: { icon: BrainCircuit, label: 'Generative', text: 'text-violet-700', bg: 'bg-violet-100', border: 'border-t-violet-500', bar: 'bg-violet-500', ring: 'ring-violet-300' },
  rag: { icon: FileSearch, label: 'RAG', text: 'text-amber-700', bg: 'bg-amber-100', border: 'border-t-amber-500', bar: 'bg-amber-500', ring: 'ring-amber-300' },
  agentic: { icon: Workflow, label: 'Agentic', text: 'text-rose-700', bg: 'bg-rose-100', border: 'border-t-rose-500', bar: 'bg-rose-500', ring: 'ring-rose-300' },
}
export const botStyle = (slug: string): BotStyle =>
  BOT_STYLES[slug] ?? { icon: Bot, label: slug, text: 'text-slate-700', bg: 'bg-slate-100', border: 'border-t-slate-500', bar: 'bg-slate-500', ring: 'ring-slate-300' }
