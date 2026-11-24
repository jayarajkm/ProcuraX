import { Can } from '@/auth/Can'
import { AIAnalyticsView } from '@/components/analytics/AIAnalyticsView'
import { EmptyState } from '@/components/EmptyState'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'

export function AIAnalyticsPage() {
  return (
    <>
      <PageHeader title="AI Analytics" description="Usage of the chatbots, agent, tools, approvals, ML models and documents, counted from persisted history." />
      <Can permission="ml:read" fallback={<Card><EmptyState title="Not available for your role" description="AI Analytics requires the ml:read permission." /></Card>}>
        <AIAnalyticsView />
      </Can>
    </>
  )
}
