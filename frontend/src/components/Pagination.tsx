import { ChevronLeft, ChevronRight } from 'lucide-react'
import { fmtNumber } from '@/lib/format'
import { Button } from './ui/button'
import { Select } from './ui/input'

export interface PaginationProps {
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
  onPageSizeChange?: (size: number) => void
}

export function Pagination({ page, pageSize, total, onPageChange, onPageSizeChange }: PaginationProps) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(total, page * pageSize)
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-sm">
      <span className="text-muted-foreground">{fmtNumber(from)}–{fmtNumber(to)} of {fmtNumber(total)}</span>
      <div className="flex items-center gap-2">
        {onPageSizeChange && (
          <Select aria-label="Rows per page" className="h-8 w-auto" value={pageSize} onChange={(e) => onPageSizeChange(Number(e.target.value))}>
            {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n} / page</option>)}
          </Select>
        )}
        <Button variant="outline" size="icon" className="h-8 w-8" aria-label="Previous page" disabled={page <= 1} onClick={() => onPageChange(page - 1)}><ChevronLeft className="h-4 w-4" /></Button>
        <span className="min-w-[5rem] text-center text-muted-foreground">Page {page} / {pages}</span>
        <Button variant="outline" size="icon" className="h-8 w-8" aria-label="Next page" disabled={page >= pages} onClick={() => onPageChange(page + 1)}><ChevronRight className="h-4 w-4" /></Button>
      </div>
    </div>
  )
}
