import type { ReactNode } from 'react'
import { Card } from './ui/card'

/** Card wrapper: filter bar on top, table/content below. */
export function ListCard({ filters, children }: { filters?: ReactNode; children: ReactNode }) {
  return (
    <Card className="overflow-hidden">
      {filters && <div className="flex flex-wrap items-center gap-2 border-b p-3">{filters}</div>}
      {children}
    </Card>
  )
}
