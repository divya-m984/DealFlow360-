// OWNER: D2.  Shared visual language for receivables.
//
// One component, two jobs: a credit-utilisation gauge and an ageing bar.
// Both are proportional bars, so putting them in one file keeps the colour
// scale identical between them — a receivable that is red in the ageing bar
// must not be amber in the gauge two inches away.
//
// The colour scale is the standard receivables one and is not decorative:
// current is neutral, 1–30 is fine, 31–60 is attention, 61–90 is a problem,
// 90+ is usually a write-off conversation. A finance person reads these
// colours faster than the numbers.

'use client'

import { Money } from '@/components/shared/money'

export const BUCKETS = [
  { key: 'current',  label: 'Current',  cls: 'bg-slate-400',   text: 'text-slate-600 dark:text-slate-400' },
  { key: 'd1_30',    label: '1–30 d',   cls: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-400' },
  { key: 'd31_60',   label: '31–60 d',  cls: 'bg-amber-500',   text: 'text-amber-700 dark:text-amber-400' },
  { key: 'd61_90',   label: '61–90 d',  cls: 'bg-orange-500',  text: 'text-orange-700 dark:text-orange-400' },
  { key: 'd90_plus', label: '90+ d',    cls: 'bg-red-500',     text: 'text-red-700 dark:text-red-400' },
] as const

export type Aging = Record<(typeof BUCKETS)[number]['key'], number>

/** A single stacked bar of the five ageing buckets, proportional to value. */
export function AgingBar({ aging, currency }: { aging: Aging; currency?: string }) {
  const total = BUCKETS.reduce((t, b) => t + Number(aging[b.key] ?? 0), 0)

  if (total <= 0) {
    return <p className="text-xs text-muted-foreground">Nothing outstanding.</p>
  }

  return (
    <div className="space-y-2">
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
        {BUCKETS.map((b) => {
          const v = Number(aging[b.key] ?? 0)
          if (v <= 0) return null
          return (
            <div
              key={b.key}
              className={`${b.cls} transition-all`}
              style={{ width: `${(v / total) * 100}%` }}
              title={`${b.label}: ${v}`}
            />
          )
        })}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {BUCKETS.map((b) => {
          const v = Number(aging[b.key] ?? 0)
          if (v <= 0) return null
          return (
            <span key={b.key} className="flex items-center gap-1.5 text-[11px]">
              <span className={`inline-block h-2 w-2 rounded-sm ${b.cls}`} />
              <span className="text-muted-foreground">{b.label}</span>
              <span className={`font-medium tabular-nums ${b.text}`}>
                <Money value={v} currency={currency} />
              </span>
            </span>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Credit utilisation. Deliberately allowed to render OVER 100% — clamping the
 * bar at full would make a breached account look identical to one sitting
 * exactly on its limit, and those are very different conversations.
 */
export function CreditGauge({
  exposure, limit, onHold, currency,
}: { exposure: number; limit: number | null; onHold: boolean; currency?: string }) {
  if (onHold) {
    return (
      <div className="space-y-1.5">
        <div className="h-2.5 w-full overflow-hidden rounded-full bg-red-500/20">
          <div className="h-full w-full animate-pulse bg-red-500" />
        </div>
        <p className="text-[11px] font-medium text-red-700 dark:text-red-400">
          ON CREDIT HOLD — no new order will confirm, whatever the headroom
        </p>
      </div>
    )
  }

  if (limit === null) {
    return (
      <div className="space-y-1.5">
        <div className="h-2.5 w-full rounded-full bg-muted" />
        <p className="text-[11px] text-muted-foreground">
          No credit limit set · exposure <Money value={exposure} currency={currency} />
        </p>
      </div>
    )
  }

  const pct = limit > 0 ? (exposure / limit) * 100 : exposure > 0 ? 999 : 0
  const over = pct > 100
  const tone =
    over ? 'bg-red-500' : pct >= 90 ? 'bg-orange-500' : pct >= 70 ? 'bg-amber-500' : 'bg-emerald-500'

  return (
    <div className="space-y-1.5">
      <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full ${tone} transition-all duration-500`}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
        {over && (
          // A hatched overflow strip, so 140% does not look like 100%.
          <div className="absolute inset-y-0 right-0 w-1/4 bg-[repeating-linear-gradient(45deg,transparent,transparent_3px,rgba(255,255,255,.45)_3px,rgba(255,255,255,.45)_6px)]" />
        )}
      </div>
      <p className="flex flex-wrap items-baseline gap-x-1.5 text-[11px]">
        <span className={`font-semibold tabular-nums ${over ? 'text-red-700 dark:text-red-400' : 'text-foreground'}`}>
          {Math.round(pct)}%
        </span>
        <span className="text-muted-foreground">of</span>
        <Money value={limit} currency={currency} className="text-muted-foreground" />
        <span className="text-muted-foreground">used ·</span>
        <span className={over ? 'font-medium text-red-700 dark:text-red-400' : 'text-muted-foreground'}>
          {over
            ? <><Money value={exposure - limit} currency={currency} /> over</>
            : <><Money value={limit - exposure} currency={currency} /> available</>}
        </span>
      </p>
    </div>
  )
}
