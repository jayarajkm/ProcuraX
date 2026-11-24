import { AlertTriangle } from 'lucide-react'
import { errorMessage } from '@/lib/api'
import { Button } from './ui/button'

export function ErrorState({ error, onRetry, title = 'Something went wrong' }: { error?: unknown; onRetry?: () => void; title?: string }) {
  return (
    <div role="alert" className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <div className="rounded-full bg-red-50 p-3 text-destructive"><AlertTriangle className="h-6 w-6" /></div>
      <p className="font-medium">{title}</p>
      <p className="max-w-md text-sm text-muted-foreground">{error ? errorMessage(error) : 'The request failed.'}</p>
      {onRetry && <Button variant="outline" size="sm" onClick={onRetry}>Try again</Button>}
    </div>
  )
}
