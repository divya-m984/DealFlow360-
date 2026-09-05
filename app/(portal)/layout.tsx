// OWNER: D1.  The CUSTOMER PORTAL shell — deliberately a different application.
// PS §7: "a real, separate, restricted view, not just another internal screen
// with a different label."  Nothing from components/nav.ts NAV appears here.
'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { PORTAL_NAV } from '@/components/nav'

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
    router.refresh()
  }

  return (
    <div className="flex min-h-svh flex-col">
      <header className="bg-sky-500 text-white">
        <div className="flex items-center gap-1 px-4 py-2">
          <span className="mr-4 font-semibold">DealFlow360</span>
          {PORTAL_NAV.map((item) => (
            <Link key={item.href} href={item.href}
              className={`rounded-md px-3 py-1.5 text-sm ${
                pathname === item.href ? 'bg-slate-900' : 'hover:bg-sky-600'
              }`}>
              {item.label}
            </Link>
          ))}
          <button onClick={logout} className="ml-auto rounded-md px-2 py-1 text-sm hover:bg-sky-600">
            Log out
          </button>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  )
}
