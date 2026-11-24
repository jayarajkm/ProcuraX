import type { LabelHTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function Label({ className, ...p }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn('text-sm font-medium leading-none', className)} {...p} />
}

/** Label + control + error message wrapper for forms. */
export function Field({ label, error, htmlFor, children, hint }: { label: string; error?: string; htmlFor?: string; children: ReactNode; hint?: string }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
