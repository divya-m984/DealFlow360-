// OWNER: D2.  One product — general info, variants, pricelist items (screen 17).
// Phase 0 stub — created so this file is never created twice. See OWNERSHIP.md.
//
// product.recurring_iff_subscription is a CHECK: is_subscription is true IFF
// recurring_cycle is set.  Reject the impossible pair here, not in Postgres —
// a raw constraint error is not a message a user can act on.
import { fail } from '@/lib/api'

export const runtime = 'nodejs'

export async function GET() {
  return fail('Not implemented yet — owner: D2', 501)
}
