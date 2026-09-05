'use client'

import * as React from 'react'
import { Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { cn } from 'cn'

export function ThemeToggle({ className }: { className?: string }) {
  const { setTheme, resolvedTheme } = useTheme()
  const [mounted, setMounted] = React.useState(false)

  React.useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return (
      <div
        className={cn(
          'inline-flex size-8 items-center justify-center rounded-md text-nav-foreground/60',
          className
        )}
        aria-hidden="true"
      >
        <span className="size-4" />
      </div>
    )
  }

  const isDark = resolvedTheme === 'dark'

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
      aria-label={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
      className={cn(
        'group relative inline-flex size-8 items-center justify-center rounded-md text-nav-foreground/80 transition-all duration-200',
        'hover:bg-white/10 hover:text-nav-foreground active:scale-95 cursor-pointer',
        'outline-none focus-visible:ring-2 focus-visible:ring-nav-foreground/60',
        className
      )}
    >
      <Sun
        className={cn(
          'size-4 transition-all duration-300 ease-in-out',
          isDark
            ? 'rotate-0 scale-100 text-amber-400 group-hover:rotate-45'
            : '-rotate-90 scale-0 text-amber-500'
        )}
      />
      <Moon
        className={cn(
          'absolute size-4 transition-all duration-300 ease-in-out',
          isDark
            ? 'rotate-90 scale-0 text-indigo-300'
            : 'rotate-0 scale-100 text-sky-200 group-hover:-rotate-12'
        )}
      />
      <span className="sr-only">Toggle theme</span>
    </button>
  )
}
