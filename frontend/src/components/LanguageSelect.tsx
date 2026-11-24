import { Select } from '@/components/ui/input'
import { useLanguage } from '@/hooks/useLanguage'
import { cn } from '@/lib/utils'

/** Native select bound to the shared language preference. Changing it never triggers a request by itself. */
export function LanguageSelect({ id = 'response-language', label = 'Response language', disabled, className, hideLabel }: {
  id?: string; label?: string; disabled?: boolean; className?: string; hideLabel?: boolean
}) {
  const { languages, code, setCode, isLoading, error, refetch } = useLanguage()
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <label htmlFor={id} className={cn('text-xs font-medium text-muted-foreground', hideLabel && 'sr-only')}>{label}</label>
      <Select id={id} value={code} disabled={disabled || isLoading} onChange={(e) => setCode(e.target.value)} className="min-w-[12rem]">
        {languages.map((l) => <option key={l.code} value={l.code}>{l.native_name === l.name ? l.name : `${l.native_name} (${l.name})`}</option>)}
      </Select>
      {error && <p role="alert" className="text-xs text-destructive">Could not load languages (English only). <button type="button" className="underline" onClick={() => void refetch()}>Retry</button></p>}
    </div>
  )
}
