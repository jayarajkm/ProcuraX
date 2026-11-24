import * as T from '@radix-ui/react-tabs'
import type { ComponentPropsWithoutRef } from 'react'
import { cn } from '@/lib/utils'

export const Tabs = T.Root
export const TabsList = ({ className, ...p }: ComponentPropsWithoutRef<typeof T.List>) => (
  <T.List className={cn('flex gap-1 border-b', className)} {...p} />
)
export const TabsTrigger = ({ className, ...p }: ComponentPropsWithoutRef<typeof T.Trigger>) => (
  <T.Trigger
    className={cn('-mb-px border-b-2 border-transparent px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground data-[state=active]:border-primary data-[state=active]:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', className)}
    {...p}
  />
)
export const TabsContent = ({ className, ...p }: ComponentPropsWithoutRef<typeof T.Content>) => (
  <T.Content className={cn('pt-4 focus-visible:outline-none', className)} {...p} />
)
