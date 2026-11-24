import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2 } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { z } from 'zod'
import { useAuth } from '@/auth/AuthContext'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/label'
import { errorMessage } from '@/lib/api'
import { DEFAULT_PATH } from '@/config/nav'

const schema = z.object({ email: z.string().min(1, 'Email is required'), password: z.string().min(1, 'Password is required') })
type Values = z.infer<typeof schema>

export function LoginPage() {
  const { user, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [error, setError] = useState<string | null>(null)
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<Values>({ resolver: zodResolver(schema) })
  const from = (location.state as { from?: string } | null)?.from ?? DEFAULT_PATH

  if (user) return <Navigate to={from} replace />

  const onSubmit = handleSubmit(async (v) => {
    setError(null)
    try {
      await login(v.email.trim(), v.password)
      navigate(from, { replace: true })
    } catch (e) {
      setError(errorMessage(e))
    }
  })

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-blue-900 p-4">
      <Card className="w-full max-w-sm p-6">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-lg font-bold text-primary-foreground">P</div>
          <h1 className="text-xl font-semibold">ProcuraX AI</h1>
          <p className="text-sm text-muted-foreground">Sign in to your procurement workspace</p>
        </div>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <Field label="Email" htmlFor="email" error={errors.email?.message}>
            <Input id="email" type="email" autoComplete="username" {...register('email')} />
          </Field>
          <Field label="Password" htmlFor="password" error={errors.password?.message}>
            <Input id="password" type="password" autoComplete="current-password" {...register('password')} />
          </Field>
          {error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={isSubmitting}>{isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />} Sign in</Button>
        </form>
        <div className="mt-5 flex justify-center"><Badge tone="amber">Synthetic demo data</Badge></div>
      </Card>
    </div>
  )
}
