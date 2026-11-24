import * as D from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface DrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  subtitle?: ReactNode
  actions?: ReactNode
  children: ReactNode
  width?: string
}

/** Right-hand side panel used for detail views. */
export function Drawer({ open, onOpenChange, title, subtitle, actions, children, width = 'max-w-2xl' }: DrawerProps) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-slate-900/40" />
        <D.Content className={cn('fixed right-0 top-0 z-40 flex h-full w-full flex-col border-l bg-card shadow-2xl focus:outline-none', width)}>
          <div className="flex items-start justify-between gap-4 border-b px-5 py-4">
            <div className="min-w-0">
              <D.Title className="truncate text-lg font-semibold">{title}</D.Title>
              <D.Description asChild><div className="mt-1 text-sm text-muted-foreground">{subtitle ?? <span className="sr-only">Details</span>}</div></D.Description>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {actions}
              <D.Close className="rounded-md p-1.5 text-muted-foreground hover:bg-muted" aria-label="Close panel"><X className="h-4 w-4" /></D.Close>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-5">{children}</div>
        </D.Content>
      </D.Portal>
    </D.Root>
  )
}
