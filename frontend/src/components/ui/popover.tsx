import * as P from '@radix-ui/react-popover'
import type { ComponentPropsWithoutRef } from 'react'
import { cn } from '@/lib/utils'

export const Popover = P.Root
export const PopoverTrigger = P.Trigger
export const PopoverContent = ({ className, sideOffset = 6, ...p }: ComponentPropsWithoutRef<typeof P.Content>) => (
  <P.Portal>
    <P.Content sideOffset={sideOffset} className={cn('z-50 w-80 rounded-md border bg-card p-4 text-sm shadow-lg focus:outline-none', className)} {...p} />
  </P.Portal>
)
