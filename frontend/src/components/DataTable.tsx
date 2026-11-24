import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { EmptyState } from './EmptyState'
import { ErrorState } from './ErrorState'
import { TableSkeleton } from './Skeletons'

export interface Column<T> {
  key: string
  header: string
  cell: (row: T) => ReactNode
  /** Backend sort key; omit for non-sortable columns. */
  sortKey?: string
  className?: string
  align?: 'left' | 'right'
}

export interface DataTableProps<T> {
  columns: Column<T>[]
  rows: T[] | undefined
  rowKey: (row: T) => string
  loading?: boolean
  error?: unknown
  onRetry?: () => void
  sort?: string
  order?: 'asc' | 'desc'
  onSort?: (sortKey: string) => void
  onRowClick?: (row: T) => void
  emptyTitle?: string
  emptyDescription?: string
  emptyAction?: ReactNode
}

export function DataTable<T>({ columns, rows, rowKey, loading, error, onRetry, sort, order, onSort, onRowClick, emptyTitle, emptyDescription, emptyAction }: DataTableProps<T>) {
  if (error && !rows) return <ErrorState error={error} onRetry={onRetry} />
  if (loading && !rows) return <TableSkeleton cols={Math.min(columns.length, 6)} />
  if (!rows || rows.length === 0) return <EmptyState title={emptyTitle ?? 'No results'} description={emptyDescription ?? 'Try adjusting your search or filters.'} action={emptyAction} />
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            {columns.map((c) => {
              const active = c.sortKey && sort === c.sortKey
              return (
                <th key={c.key} scope="col" aria-sort={active ? (order === 'desc' ? 'descending' : 'ascending') : undefined}
                  className={cn('whitespace-nowrap px-4 py-2.5 font-medium', c.align === 'right' ? 'text-right' : 'text-left', c.className)}>
                  {c.sortKey && onSort ? (
                    <button type="button" onClick={() => onSort(c.sortKey as string)} className="inline-flex items-center gap-1 uppercase hover:text-foreground">
                      {c.header}
                      {active ? (order === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 opacity-40" />}
                    </button>
                  ) : c.header}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((row) => (
            <tr key={rowKey(row)} onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cn('transition-colors', onRowClick && 'cursor-pointer hover:bg-accent/50')}>
              {columns.map((c) => (
                <td key={c.key} className={cn('px-4 py-2.5 align-middle', c.align === 'right' && 'text-right tabular-nums', c.className)}>{c.cell(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
