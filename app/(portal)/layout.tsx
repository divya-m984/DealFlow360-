// OWNER: D1.  The CUSTOMER PORTAL shell — deliberately a different application.
// PS §7: "a real, separate, restricted view, not just another internal screen
// with a different label."  Nothing from components/nav.ts NAV appears here.
'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { PORTAL_NAV } from '@/components/nav'
import { ThemeToggle } from '@/components/theme-toggle'

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
    router.refresh()
  }

  return (
    <div className="flex min-h-svh flex-col bg-background text-foreground">
      <header className="bg-nav text-nav-foreground">
        <div className="flex items-center gap-2 px-4 py-2">
          <span className="mr-4 font-semibold tracking-tight">DealFlow360</span>
          {PORTAL_NAV.map((item) => (
            <Link key={item.href} href={item.href}
              className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                pathname === item.href ? 'bg-nav-active text-white' : 'hover:bg-white/10'
              }`}>
              {item.label}
            </Link>
          ))}
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <button onClick={logout} className="rounded-md px-2.5 py-1 text-sm text-nav-foreground/80 hover:bg-white/10 hover:text-nav-foreground transition-colors cursor-pointer">
              Log out
            </button>
          </div>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  )
}
