import { Lock } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { AuditTab, AgentToolsTab } from '@/components/admin/AdminAgentAudit'
import { IntentsTab, PolicyTab, PromptsTab, ProvidersTab, RulesTab } from '@/components/admin/AdminConfigTabs'
import { AIAnalyticsView } from '@/components/analytics/AIAnalyticsView'
import { EmptyState } from '@/components/EmptyState'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Spinner } from '@/components/Skeletons'

export function AdminPage() {
  const { can, loading } = useAuth()
  if (loading) return <div className="flex justify-center py-12"><Spinner /></div>
  if (!can('admin:manage')) {
    return (
      <>
        <PageHeader title="AI Administration" />
        <Card><EmptyState icon={<Lock className="h-6 w-6" />} title="Administrator only" description="AI Administration needs the admin:manage permission. Ask an administrator for access." /></Card>
      </>
    )
  }
  return (
    <>
      <PageHeader title="AI Administration" description="Providers, policy values, chatbot rules, prompts, agent limits and tools, with an audit trail. Every change is recorded in the audit log." />
      <Tabs defaultValue="providers">
        <TabsList className="flex-wrap">
          {[['providers', 'Providers'], ['policy', 'Policy values'], ['rules', 'Rules'], ['intents', 'Intents'], ['prompts', 'Prompts'], ['agent', 'Agent & Tools'], ['audit', 'Audit log'], ['analytics', 'AI Analytics']]
            .map(([v, l]) => <TabsTrigger key={v} value={v}>{l}</TabsTrigger>)}
        </TabsList>
        <TabsContent value="providers"><ProvidersTab /></TabsContent>
        <TabsContent value="policy"><PolicyTab /></TabsContent>
        <TabsContent value="rules"><RulesTab /></TabsContent>
        <TabsContent value="intents"><IntentsTab /></TabsContent>
        <TabsContent value="prompts"><PromptsTab /></TabsContent>
        <TabsContent value="agent"><AgentToolsTab /></TabsContent>
        <TabsContent value="audit"><AuditTab /></TabsContent>
        <TabsContent value="analytics"><AIAnalyticsView /></TabsContent>
      </Tabs>
    </>
  )
}
