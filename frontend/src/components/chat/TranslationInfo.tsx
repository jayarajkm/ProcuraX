import { AlertTriangle, ChevronDown, Languages } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { useLanguageInfo } from '@/hooks/useLanguage'
import type { Translation } from '@/lib/types'
import { cn } from '@/lib/utils'

const isNonEnglish = (language?: string | null, t?: Translation | null) => !!language && language !== 'en' && !!t
const hasError = (t: Translation) => !!(t.input_translation_error || t.output_translation_error)

/** Plain-words description of translation.mode. Unknown modes are shown verbatim, never guessed. */
export function modeText(mode: string | undefined, languageName: string): string | null {
  if (mode === 'llm_native') return `The LLM answered directly in ${languageName}.`
  if (mode === 'deterministic_bot_with_llm_translation') return `The deterministic bot answered in English and the LLM translated the reply into ${languageName}.`
  return mode ?? null
}

/** Per-message disclosure badge (+ visible amber warning when a translation step failed). Renders nothing for English. */
export function TranslationNotice({ language, translation }: { language?: string | null; translation?: Translation | null }) {
  // hooks live in the inner component so English / legacy messages never touch the query client
  if (!isNonEnglish(language, translation) || !translation) return null
  return <NoticeInner language={language} translation={translation} />
}
function NoticeInner({ language, translation }: { language?: string | null; translation: Translation }) {
  const { nameOf } = useLanguageInfo()
  const name = nameOf(language)
  const failed = hasError(translation)
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5" dir="ltr" data-testid="translation-notice">
      {translation.mode === 'deterministic_bot_with_llm_translation' && <Badge tone="blue"><Languages className="h-3 w-3" />Translated by LLM</Badge>}
      {translation.mode === 'llm_native' && <Badge tone="purple"><Languages className="h-3 w-3" />Answered in {name}</Badge>}
      {failed && <Badge tone="amber" role="alert"><AlertTriangle className="h-3 w-3" />Translation unavailable — showing English</Badge>}
    </div>
  )
}

/** "Language & translation" body: only fields that exist. */
export function TranslationSection({ language, translation }: { language?: string | null; translation?: Translation | null }) {
  if (!isNonEnglish(language, translation) || !translation) return null
  return <SectionInner language={language} translation={translation} />
}
function SectionInner({ language, translation }: { language?: string | null; translation: Translation }) {
  const { nameOf } = useLanguageInfo()
  const [showOrig, setShowOrig] = useState(false)
  const t = translation
  const name = nameOf(language)
  const mode = modeText(t.mode, name)
  return (
    <div dir="ltr" className="space-y-2" data-testid="translation-section">
      <div className="font-semibold uppercase tracking-wide text-[10px] text-muted-foreground">Language &amp; translation</div>
      {hasError(t) && (
        <div role="alert" className="rounded border border-amber-300 bg-amber-50 p-2 text-amber-900">
          <div className="flex items-center gap-1.5 font-semibold"><AlertTriangle className="h-3.5 w-3.5" />Translation unavailable — showing English</div>
          {t.input_translation_error && <p className="mt-1 break-words">Question translation: {t.input_translation_error}</p>}
          {t.output_translation_error && <p className="mt-1 break-words">Reply translation: {t.output_translation_error}</p>}
        </div>
      )}
      <p><span className="text-muted-foreground">Language:</span> {name}</p>
      {mode && <p>{mode}</p>}
      {t.input_translated_to_english && <p><span className="text-muted-foreground">English question used:</span> “{t.input_translated_to_english}”</p>}
      {t.original_reply && (
        <div>
          <button type="button" aria-expanded={showOrig} onClick={() => setShowOrig((o) => !o)} className="flex items-center gap-1 font-medium text-primary hover:underline">
            {showOrig ? 'Hide original English reply' : 'Show original English reply'}<ChevronDown className={cn('h-3.5 w-3.5 transition-transform', showOrig && 'rotate-180')} />
          </button>
          {showOrig && <p className="mt-1 whitespace-pre-wrap break-words rounded border bg-card p-2" data-testid="original-reply">{t.original_reply}</p>}
        </div>
      )}
      {!!t.not_translated?.length && <p className="text-muted-foreground">Stays in English: {t.not_translated.join(', ').replace(/_/g, ' ')}.</p>}
      {t.note && <p className="text-muted-foreground">{t.note}</p>}
    </div>
  )
}

/** Compact collapsible version for cards that have no "Response details" panel (comparison). */
export function TranslationDisclosure({ language, translation }: { language?: string | null; translation?: Translation | null }) {
  const [open, setOpen] = useState(false)
  if (!isNonEnglish(language, translation)) return null
  return (
    <div>
      <TranslationNotice language={language} translation={translation} />
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="mt-2 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground">
        Language &amp; translation <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
      </button>
      {open && <div className="mt-1 rounded-md border bg-muted/30 p-2 text-xs"><TranslationSection language={language} translation={translation} /></div>}
    </div>
  )
}
