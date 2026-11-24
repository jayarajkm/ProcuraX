// Mirrors backend PO_TRANSITIONS / PO_TRANSITION_PERMISSION (services/procurement.py).
export const PO_TRANSITIONS: Record<string, string[]> = {
  draft: ['pending_approval', 'cancelled'],
  pending_approval: ['approved', 'draft', 'cancelled'],
  approved: ['sent', 'cancelled'],
  sent: ['partially_received', 'received', 'cancelled'],
  partially_received: ['received', 'cancelled'],
  received: [],
  cancelled: [],
}
export const PO_TRANSITION_PERMISSION: Record<string, string> = { approved: 'po:approve' }
export const PO_STATUSES = Object.keys(PO_TRANSITIONS)

/** Transitions the given permission set may perform from `status`. Requires po:write for any change. */
export function allowedTransitions(status: string, can: (p: string) => boolean): string[] {
  if (!can('po:write')) return []
  return (PO_TRANSITIONS[status] ?? []).filter((to) => {
    const perm = PO_TRANSITION_PERMISSION[to]
    return !perm || can(perm)
  })
}

export const TRANSITION_LABEL: Record<string, string> = {
  pending_approval: 'Submit for approval', approved: 'Approve', draft: 'Return to draft', cancelled: 'Cancel order',
  sent: 'Mark as sent', partially_received: 'Mark partially received', received: 'Mark received',
}
