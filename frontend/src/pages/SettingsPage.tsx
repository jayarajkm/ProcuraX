import { PageHeader } from '@/components/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { KeyValue } from '@/components/Sections'
import { useAuth } from '@/auth/AuthContext'

export function SettingsPage() {
  const { user } = useAuth()
  if (!user) return null
  const groups = user.permissions.reduce<Record<string, string[]>>((acc, p) => {
    const [res] = p.split(':')
    ;(acc[res] ||= []).push(p)
    return acc
  }, {})
  return (
    <>
      <PageHeader title="Settings" description="Read-only profile of the signed-in user." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Profile</CardTitle></CardHeader>
          <CardContent>
            <KeyValue items={[
              { label: 'Full name', value: user.full_name },
              { label: 'Email', value: user.email },
              { label: 'User ID', value: <code className="text-xs">{user.id}</code> },
              { label: 'Roles', value: <div className="flex flex-wrap gap-1">{user.roles.map((r) => <Badge key={r} tone="blue">{r}</Badge>)}</div> },
            ]} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Permissions ({user.permissions.length})</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {Object.entries(groups).map(([res, perms]) => (
              <div key={res}>
                <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{res}</div>
                <div className="flex flex-wrap gap-1">{perms.map((p) => <Badge key={p}>{p}</Badge>)}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </>
  )
}
