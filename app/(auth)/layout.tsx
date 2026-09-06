import { AuthArt } from '@/components/auth/auth-art'
import { ThemeToggle } from '@/components/theme-toggle'

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-svh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      {/* Left — brand panel.  Dropped entirely below lg: on a phone it would
          eat the fold and push the form off screen. */}
      <div className="relative hidden lg:block">
        <div className="absolute inset-0">
          <AuthArt />
        </div>

        <div className="relative flex h-full flex-col justify-between p-10 text-white">
          <div className="flex items-center gap-2.5">
            <span className="grid size-8 place-items-center rounded-lg bg-white/15 ring-1 ring-white/25 backdrop-blur-sm">
              <span className="text-sm font-semibold">DF</span>
            </span>
            <span className="text-base font-semibold tracking-tight">DealFlow360</span>
          </div>

          <div className="max-w-md">
            <h2 className="font-heading text-4xl leading-[1.1] font-semibold tracking-tight text-balance">
              Every discount,
              <br />
              accountable.
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-white/75">
              Quote to cash with the approval trail attached — margin guardrails,
              versioned sign-off, and a customer portal that feeds straight back
              into the chain.
            </p>
          </div>

          <div className="flex items-center gap-6 text-xs text-white/70">
            <span className="flex items-center gap-2">
              <span className="size-1.5 rounded-full bg-white/70" />
              Quotations
            </span>
            <span className="flex items-center gap-2">
              <span className="size-1.5 rounded-full bg-white/70" />
              Approvals
            </span>
            <span className="flex items-center gap-2">
              <span className="size-1.5 rounded-full bg-white/70" />
              Order to cash
            </span>
          </div>
        </div>
      </div>

      {/* Right — the form. */}
      <div className="relative flex items-center justify-center bg-background px-6 py-10">
        <div className="absolute top-4 right-4">
          <ThemeToggle className="text-foreground/75 hover:bg-muted" />
        </div>

        <div className="w-full max-w-sm">
          {/* Stands in for the brand panel once it is hidden. */}
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
              <span className="text-sm font-semibold">DF</span>
            </span>
            <span className="text-base font-semibold tracking-tight">DealFlow360</span>
          </div>

          {children}
        </div>
      </div>
    </div>
  )
}
