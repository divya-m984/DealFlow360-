// OWNER: D1.  Portal read of one quotation, by public_id.
// Phase 0 stub — created so this file is never created twice. See OWNERSHIP.md.
//
// MUST re-check session.customerId === quotation.customer_id on every request.
// Role alone is not enough — that only proves they are *a* portal user.
import { fail } from '@/lib/api'

export const runtime = 'nodejs'

export async function GET() {
  return fail('Not implemented yet — owner: D1', 501)
}
