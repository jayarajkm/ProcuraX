import { useCallback, useMemo, useState } from 'react'
import type { ListParams } from '@/lib/types'

interface Options { sort?: string; order?: 'asc' | 'desc'; pageSize?: number }

/** Page/sort/search/filter state for server-paginated tables. Changing anything but the page resets to page 1. */
export function useListState<F extends Record<string, string | boolean | undefined>>(initialFilters: F, opts: Options = {}) {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSizeState] = useState(opts.pageSize ?? 25)
  const [sort, setSort] = useState<string | undefined>(opts.sort)
  const [order, setOrder] = useState<'asc' | 'desc'>(opts.order ?? 'asc')
  const [q, setQState] = useState('')
  const [filters, setFiltersState] = useState<F>(initialFilters)

  const toggleSort = useCallback((key: string) => {
    setPage(1)
    setSort((cur) => {
      if (cur === key) { setOrder((o) => (o === 'asc' ? 'desc' : 'asc')); return cur }
      setOrder('asc')
      return key
    })
  }, [])
  const setQ = useCallback((v: string) => { setQState(v); setPage(1) }, [])
  const setPageSize = useCallback((n: number) => { setPageSizeState(n); setPage(1) }, [])
  const setFilter = useCallback(<K extends keyof F>(k: K, v: F[K]) => { setFiltersState((f) => ({ ...f, [k]: v })); setPage(1) }, [])

  const params = useMemo<ListParams>(
    () => ({ page, page_size: pageSize, sort, order, q: q || undefined, ...filters }),
    [page, pageSize, sort, order, q, filters],
  )
  return { page, setPage, pageSize, setPageSize, sort, order, toggleSort, q, setQ, filters, setFilter, params }
}
