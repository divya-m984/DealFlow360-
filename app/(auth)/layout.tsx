// OWNER: Integrator.  Screen 1 shell — no app nav, this is pre-auth.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh flex-1 items-center justify-center bg-muted/30 p-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">DealFlow360</h1>
          <p className="text-sm text-muted-foreground">Sales operations platform</p>
        </div>
        {children}
      </div>
    </div>
  )
}
