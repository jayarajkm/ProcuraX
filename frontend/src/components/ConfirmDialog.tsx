import type { ReactNode } from 'react'
import { Button } from './ui/button'
import { Dialog } from './ui/dialog'

export interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (o: boolean) => void
  title: string
  description: ReactNode
  confirmLabel?: string
  destructive?: boolean
  loading?: boolean
  onConfirm: () => void
}

export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel = 'Confirm', destructive, loading, onConfirm }: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      className="max-w-md"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>Cancel</Button>
          <Button variant={destructive ? 'destructive' : 'default'} onClick={onConfirm} disabled={loading}>{loading ? 'Working…' : confirmLabel}</Button>
        </>
      }
    >
      <div className="text-sm text-muted-foreground">{description}</div>
    </Dialog>
  )
}
