import { CheckCircle2, ExternalLink, ShieldAlert } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/auth/AuthContext'
import { ApprovalActions } from '@/components/ApprovalActions'
import { useAgentExecution } from '@/hooks/api'
import { titleCase } from '@/lib/format'
import type { ChatMetadata } from '@/lib/types'

/** Shown under an agentic reply whose execution is paused for human approval. */
export function ApprovalCallout({ metadata }: { metadata: ChatMetadata }) {
  const [decided, setDecided] = useState(false)
  const ex = metadata.extra
  const { can } = useAuth()
  // The stored metadata is a snapshot; check the live status so old messages do not offer a stale Approve button.
  const live = useAgentExecution(can('agent:run') && ex?.execution_status === 'awaiting_approval' ? ex.execution_id : undefined)
  if (ex?.execution_status !== 'awaiting_approval' || !ex.execution_id) return null
  return (
    <div role="alert" className="mt-2 rounded-md border-2 border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      <div className="flex items-center gap-2 font-semibold"><ShieldAlert className="h-4 w-4" />Human approval required</div>
      <p className="mt-1">The agent paused before running a sensitive action. It cannot approve anything itself.</p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <Link to={`/agent?execution=${ex.execution_id}`} className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline">
          Open execution in Agent Workspace <ExternalLink className="h-3.5 w-3.5" />
        </Link>
        {live.data && live.data.status !== 'awaiting_approval'
          ? <span className="text-muted-foreground">Execution is now: {titleCase(live.data.status)}</span>
          : decided
          ? <span className="flex items-center gap-1 text-emerald-700"><CheckCircle2 className="h-4 w-4" />Decision recorded</span>
          : ex.approval_id && <ApprovalActions approvalId={ex.approval_id} onDecided={() => setDecided(true)} />}
      </div>
    </div>
  )
}
