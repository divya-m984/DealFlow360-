// OWNER: Integrator.  Screen 1 — Login.
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  AlertCircle, ArrowRight, Building2, Eye, EyeOff, Loader2, Lock, Mail,
  ShieldCheck, User, Wallet,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

// Seeded logins, all with password demo1234.  Shown on the login screen
// because four people and a judge all need to switch identity quickly.
const DEMO = [
  { email: 'rep@dealflow.app', label: 'Sales Rep', icon: User },
  { email: 'manager@dealflow.app', label: 'Sales Manager', icon: ShieldCheck },
  { email: 'finance@dealflow.app', label: 'Finance', icon: Wallet },
  { email: 'admin@dealflow.app', label: 'Admin', icon: Building2 },
  { email: 'buyer@acme.example', label: 'Customer portal', icon: ArrowRight },
] as const

const DEMO_PASSWORD = 'demo1234'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
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
    <div>
      <div className="mb-7">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Welcome back</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Internal users and customers use the same entry point.
        </p>
      </div>

      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <div className="relative">
            <Mail className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="email" type="email" autoComplete="email" required
              placeholder="you@company.com"
              className="pl-9"
              value={email} onChange={(e) => setEmail(e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <div className="relative">
            <Lock className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="password" type={showPassword ? 'text' : 'password'}
              autoComplete="current-password" required
              placeholder="••••••••"
              className="pr-10 pl-9"
              value={password} onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              className="absolute top-1/2 right-1 -translate-y-1/2 rounded-sm p-1.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </div>

        {error && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <span>{error}</span>
          </p>
        )}

        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Signing in…
            </>
          ) : (
            'Log In'
          )}
        </Button>
      </form>

      <div className="my-6 flex items-center gap-3">
        <span className="h-px flex-1 bg-border" />
        <span className="text-xs text-muted-foreground">Or use a demo account</span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <div className="grid gap-1.5">
        {DEMO.map(({ email: addr, label, icon: Icon }) => {
          const active = email === addr
          return (
            <button
              key={addr}
              type="button"
              onClick={() => { setEmail(addr); setPassword(DEMO_PASSWORD); setError(null) }}
              className={`group flex items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors ${
                active
                  ? 'border-primary/40 bg-primary/5'
                  : 'border-border hover:border-primary/30 hover:bg-muted/60'
              }`}
            >
              <span
                className={`grid size-7 shrink-0 place-items-center rounded-md transition-colors ${
                  active
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground group-hover:text-foreground'
                }`}
              >
                <Icon className="size-3.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm leading-tight font-medium">{label}</span>
                <span className="block truncate font-mono text-xs text-muted-foreground">
                  {addr}
                </span>
              </span>
            </button>
          )
        })}
      </div>

      <p className="mt-4 text-center text-xs text-muted-foreground">
        All demo accounts use the password{' '}
        <code className="rounded bg-muted px-1 py-0.5 font-mono text-foreground">
          {DEMO_PASSWORD}
        </code>
      </p>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        No account?{' '}
        <Link href="/signup" className="font-medium text-primary underline-offset-4 hover:underline">
          Sign up
        </Link>
      </p>
    </div>
  )
}
