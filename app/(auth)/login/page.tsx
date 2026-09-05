// OWNER: Integrator.  Screen 1 — Login.
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

// Seeded logins, all with password demo1234.  Shown on the login screen
// because four people and a judge all need to switch identity quickly.
const DEMO = [
  ['rep@dealflow.app', 'Sales Rep'],
  ['manager@dealflow.app', 'Sales Manager'],
  ['finance@dealflow.app', 'Finance'],
  ['admin@dealflow.app', 'Admin'],
  ['buyer@acme.example', 'Customer portal'],
] as const

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    const body = await res.json()
    setBusy(false)
    if (!res.ok) return setError(body?.error?.message ?? 'Login failed')
    // Portal users land on their quotation; internal users on the dashboard.
    router.push(body.data.role === 'portal' ? '/portal' : '/')
    router.refresh()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Log in</CardTitle>
        <CardDescription>Internal users and customers use the same entry point.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" autoComplete="email" required
              value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" autoComplete="current-password" required
              value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>

          {error && (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? 'Signing in…' : 'Log In'}
          </Button>
        </form>

        <div className="mt-6 border-t pt-4">
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            Demo accounts — password <code className="font-mono">demo1234</code>
          </p>
          <div className="grid gap-1">
            {DEMO.map(([addr, label]) => (
              <button key={addr} type="button"
                onClick={() => { setEmail(addr); setPassword('demo1234') }}
                className="flex items-center justify-between rounded px-2 py-1 text-left text-xs hover:bg-muted">
                <span className="font-mono">{addr}</span>
                <span className="text-muted-foreground">{label}</span>
              </button>
            ))}
          </div>
        </div>

        <p className="mt-4 text-center text-sm text-muted-foreground">
          No account? <Link href="/signup" className="underline underline-offset-4">Sign up</Link>
        </p>
      </CardContent>
    </Card>
  )
}
