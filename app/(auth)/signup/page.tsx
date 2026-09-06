// OWNER: Integrator.  Screen 1 — Signup.  Creates an internal sales_rep.
'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { AlertCircle, Check, Eye, EyeOff, Loader2, Lock, Mail, User } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

// Deliberately loose — the server is the authority on what it will accept.
// This only decides whether we show the green tick next to the field.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Four bars, four things worth asking for.  Length counts twice because it is
// the only one that actually matters, and the meter should not read "strong"
// off three character classes in an eight-character password.
function strengthOf(pw: string) {
  if (!pw) return { score: 0, label: '', tone: '' }
  let score = 0
  if (pw.length >= 8) score++
  if (pw.length >= 12) score++
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++
  if (/\d/.test(pw) || /[^A-Za-z0-9]/.test(pw)) score++
  const meta = [
    { label: 'Too short', tone: 'bg-destructive' },
    { label: 'Weak', tone: 'bg-destructive' },
    { label: 'Fair', tone: 'bg-chart-3' },
    { label: 'Good', tone: 'bg-chart-2' },
    { label: 'Strong', tone: 'bg-chart-2' },
  ][score]
  return { score, ...meta }
}

export default function SignupPage() {
  const router = useRouter()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const strength = useMemo(() => strengthOf(password), [password])
  const emailOk = EMAIL.test(email)
  const canSubmit = fullName.trim().length > 0 && emailOk && password.length >= 8 && !busy

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const res = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fullName, email, password }),
    })
    const body = await res.json()
    setBusy(false)
    if (!res.ok) return setError(body?.error?.message ?? 'Signup failed')
    router.push('/')
    router.refresh()
  }

  return (
    <div>
      <div className="mb-7">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Create an account</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          New accounts are created as a{' '}
          <span className="font-medium text-foreground">Sales Rep</span>.
        </p>
      </div>

      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="fullName">Full name</Label>
          <div className="relative">
            <User className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="fullName" required autoComplete="name" placeholder="Priya Raman"
              className="pl-9"
              value={fullName} onChange={(e) => setFullName(e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <div className="relative">
            <Mail className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="email" type="email" autoComplete="email" required
              placeholder="you@company.com"
              className="pr-9 pl-9"
              value={email} onChange={(e) => setEmail(e.target.value)}
            />
            {emailOk && (
              <Check className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-chart-2" />
            )}
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <div className="relative">
            <Lock className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="password" type={showPassword ? 'text' : 'password'}
              autoComplete="new-password" required minLength={8}
              placeholder="At least 8 characters"
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

          {/* The meter replaces the old static "At least 8 characters" line —
              same guidance, but it responds, so it reads as feedback rather
              than as fine print. */}
          <div className="flex items-center gap-2 pt-0.5">
            <div className="flex flex-1 gap-1" aria-hidden>
              {[0, 1, 2, 3].map((i) => (
                <span
                  key={i}
                  className={`h-1 flex-1 rounded-full transition-colors ${
                    i < strength.score ? strength.tone : 'bg-border'
                  }`}
                />
              ))}
            </div>
            <span className="w-20 shrink-0 text-right text-xs whitespace-nowrap text-muted-foreground" aria-live="polite">
              {password ? strength.label : 'Min. 8 chars'}
            </span>
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

        <Button type="submit" className="w-full" disabled={!canSubmit}>
          {busy ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Creating…
            </>
          ) : (
            'Sign Up'
          )}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Already have an account?{' '}
        <Link href="/login" className="font-medium text-primary underline-offset-4 hover:underline">
          Log in
        </Link>
      </p>
    </div>
  )
}
