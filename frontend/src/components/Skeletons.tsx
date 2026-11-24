import { Loader2 } from 'lucide-react'
import { Skeleton } from './ui/skeleton'

export const Spinner = () => <Loader2 aria-label="Loading" className="h-6 w-6 animate-spin text-primary" />

export function TableSkeleton({ rows = 8, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div role="status" aria-label="Loading data" className="space-y-2 p-4">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-4">
          {Array.from({ length: cols }).map((_, c) => <Skeleton key={c} className="h-6 flex-1" />)}
        </div>
      ))}
    </div>
  )
}

export const CardSkeleton = () => <Skeleton className="h-28 w-full" />

export function DetailSkeleton() {
  return (
    <div role="status" aria-label="Loading details" className="space-y-3">
      <Skeleton className="h-6 w-1/2" /><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-5/6" /><Skeleton className="h-32 w-full" />
    </div>
  )
}
