import { cva, type VariantProps } from 'class-variance-authority'
import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

const badgeVariants = cva('inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap', {
  variants: {
    tone: {
      neutral: 'border-slate-200 bg-slate-100 text-slate-700',
      blue: 'border-blue-200 bg-blue-50 text-blue-700',
      green: 'border-emerald-200 bg-emerald-50 text-emerald-700',
      amber: 'border-amber-200 bg-amber-50 text-amber-800',
      red: 'border-red-200 bg-red-50 text-red-700',
      purple: 'border-violet-200 bg-violet-50 text-violet-700',
    },
  },
  defaultVariants: { tone: 'neutral' },
})
export type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>['tone']>
export interface BadgeProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}
export const Badge = ({ className, tone, ...p }: BadgeProps) => <span className={cn(badgeVariants({ tone }), className)} {...p} />
