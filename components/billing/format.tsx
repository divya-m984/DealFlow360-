// OWNER: D2.
//
// Money formatting lives in D3's components/shared/money.tsx — this file used
// to duplicate it while that one was still a Phase 0 stub, and the duplicate is
// now gone.  What is left is the two helpers D3's file does not provide.

/** Quantities are numeric(12,3); "27.000" reads badly next to "27". */
export function qty(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '—'
  const n = Number(v)
  return Number.isFinite(n) ? String(n) : String(v)
}

/** A `date` column, already a YYYY-MM-DD string — see the type parser note in
 *  lib/db.ts for why it is not a JS Date. */
export function date(v: string | null | undefined): string {
  if (!v) return '—'
  return String(v).slice(0, 10)
}

/** A JS Date as YYYY-MM-DD in LOCAL time.  toISOString() converts to UTC and,
 *  east of Greenwich, returns the previous day — same trap as lib/db.ts. */
export function localDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
