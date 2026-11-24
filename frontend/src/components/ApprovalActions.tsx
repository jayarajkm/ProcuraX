import { Check, ShieldAlert, X } from 'lucide-react'
import { useState } from 'react'
import { useAuth } from '@/auth/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useDecideApproval } from '@/hooks/api'

/**
 * Approve / Reject controls for a pending agent approval.
 * Users without `agent:approve` see an explanatory message instead of buttons (the API enforces this too).
 */
export function ApprovalActions({ approvalId, onDecided }: { approvalId: string; onDecided?: () => void }) {
  const { can } = useAuth()
  const decide = useDecideApproval()
  const [comment, setComment] = useState('')
  if (!can('agent:approve')) {
    return <p className="flex items-center gap-1.5 text-sm text-amber-800"><ShieldAlert className="h-4 w-4" />Awaiting approval by a Procurement Manager/Administrator.</p>
  }
  const go = (approve: boolean) => decide.mutate({ id: approvalId, approve, comment: comment.trim() }, { onSuccess: () => onDecided?.() })
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input aria-label="Decision comment" className="h-8 w-56" placeholder="Comment (optional)" value={comment} onChange={(e) => setComment(e.target.value)} disabled={decide.isPending} />
      <Button size="sm" onClick={() => go(true)} disabled={decide.isPending}><Check className="h-4 w-4" />Approve</Button>
      <Button size="sm" variant="destructive" onClick={() => go(false)} disabled={decide.isPending}><X className="h-4 w-4" />Reject</Button>
    </div>
  )
}
