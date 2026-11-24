import { Construction } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import type { NavItem } from '@/config/nav'

export function PlaceholderPage({ item }: { item: NavItem }) {
  return (
    <>
      <PageHeader title={item.label} />
      <Card className="flex flex-col items-center gap-3 px-6 py-16 text-center">
        <div className="rounded-full bg-accent p-3 text-accent-foreground"><Construction className="h-7 w-7" /></div>
        <h2 className="text-lg font-semibold">Not built yet</h2>
        <p className="max-w-md text-sm text-muted-foreground">
          {item.label} is planned for the <strong>next build phase</strong> of ProcuraX AI. {item.placeholder?.summary}
        </p>
        <p className="text-xs text-muted-foreground">This page is intentionally empty: no features are simulated.</p>
      </Card>
    </>
  )
}
