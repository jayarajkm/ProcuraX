import { Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Input } from './ui/input'

/** Debounced search box: calls onChange 300ms after typing stops. */
export function SearchInput({ value, onChange, placeholder = 'Search…', className }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  const [local, setLocal] = useState(value)
  useEffect(() => { setLocal(value) }, [value])
  useEffect(() => {
    if (local === value) return
    const t = setTimeout(() => onChange(local), 300)
    return () => clearTimeout(t)
  }, [local, value, onChange])
  return (
    <div className={`relative ${className ?? 'w-full sm:w-64'}`}>
      <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
      <Input aria-label={placeholder} className="pl-8" value={local} placeholder={placeholder} onChange={(e) => setLocal(e.target.value)} />
    </div>
  )
}
