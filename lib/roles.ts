// OWNER: D1.  CLAIMED — new path.
//
// ⚠ ADDED AFTER THE FREEZE. It fixes a bug in several lanes at once, which is
// why it is a shared file and not a workaround inside one route.
//
// ── WHAT WAS WRONG ───────────────────────────────────────────────────
// D2's jury-review-2 work added two labels to the Role union in lib/jwt.ts.
// Adding a label to an allow-listed system is SAFE by construction — a new
// role starts with no permissions anywhere, because there is no deny-list it
// could slip past. But "safe" and "correct" are different claims, and only the
// first one held:
//
//   super_admin  got 403 on /api/quotations, /api/approvals, /api/customers
//                and /api/deal-alerts. The one role permitted to wipe the
//                database could not open the pipeline it would be wiping —
//                and it is the account a judge is most likely to be handed.
//   viewer       could read orders, invoices and credit, but not quotations,
//                approvals, customers or deal alerts. A role whose entire
//                purpose is read-only access could not read the flagship
//                screen.
//
// Both came from one literal — ['sales_rep','sales_manager','finance','admin']
// — copied into route after route months before either role existed. A copy
// cannot be updated when the world changes; a name can. That is the whole
// reason this file exists.
//
// ── WHY TWO LISTS AND NOT ONE ────────────────────────────────────────
// READERS is WRITERS plus `viewer`, and `viewer` appears in exactly one of
// them. A route that uses READERS for its GET and WRITERS for its POST cannot
// accidentally hand a read-only role a write — the mistake is not available to
// make. A single "internal roles" list would have made it a one-word typo.
//
// `portal` is in neither, deliberately. It is not a less-privileged internal
// role, it is a different ladder entirely, and middleware.ts keeps the two
// apart. See the note on ROLE_RANK in lib/jwt.ts.
//
// No imports on purpose: string literals only, so this stays usable from the
// Edge runtime as well as from route handlers.

/** May change things. Every role here has some write surface. */
export const INTERNAL_WRITERS = [
  'sales_rep',
  'sales_manager',
  'finance',
  'admin',
  'super_admin',
] as const

/** May look at things. Superset of the writers — reading is never the narrower
 *  permission, and treating it as one is what produced the two bugs above. */
export const INTERNAL_READERS = [...INTERNAL_WRITERS, 'viewer'] as const
