// OWNER: D3.  The internal app shell — nav bar on all 16 internal screens.
// Phase 0 gives it a working minimum; D3 owns the design pass.
'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { NAV } from '@/components/nav'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [me, setMe] = useState<{ fullName: string; role: string } | null>(null)

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => b && setMe(b.data))
      .catch(() => {})
  }, [])

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
    router.refresh()
  }

  return (
    <div className="flex min-h-svh flex-col">
      <header className="bg-sky-500 text-white">
        <div className="flex flex-wrap items-center gap-1 px-4 py-2">
          <span className="mr-4 font-semibold">DealFlow360</span>
          {NAV.map((item) => {
            const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href)
            return (
              <Link key={item.href} href={item.href}
                className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                  active ? 'bg-slate-900 text-white' : 'hover:bg-sky-600'
                }`}>
                {item.label}
              </Link>
            )
          })}
          <div className="ml-auto flex items-center gap-3 text-sm">
            {me && <span className="opacity-90">{me.fullName} · {me.role}</span>}
            <button onClick={logout} className="rounded-md px-2 py-1 hover:bg-sky-600">Log out</button>
          </div>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  )
}
