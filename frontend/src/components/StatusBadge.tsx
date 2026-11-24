import { titleCase } from '@/lib/format'
import { Badge, type BadgeTone } from './ui/badge'

export const STATUS_TONES: Record<string, BadgeTone> = {
  // purchase orders
  draft: 'neutral', pending_approval: 'amber', approved: 'blue', sent: 'purple', partially_received: 'amber',
  received: 'green', cancelled: 'red',
  // requests
  submitted: 'blue', rejected: 'red', converted: 'green',
  // priorities
  low: 'neutral', medium: 'blue', high: 'amber', urgent: 'red',
  // misc
  // agent executions / steps / approvals
  running: 'blue', awaiting_approval: 'amber', pending: 'amber', completed: 'green', failed: 'red', timed_out: 'red', ok: 'green', error: 'red', skipped: 'neutral',
  active: 'green', inactive: 'neutral', low_stock: 'red', in_stock: 'green',
}

export function statusTone(status: string): BadgeTone {
  return STATUS_TONES[status] ?? 'neutral'
}

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={statusTone(status)} data-tone={statusTone(status)}>{titleCase(status)}</Badge>
}
