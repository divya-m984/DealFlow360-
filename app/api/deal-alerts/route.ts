// OWNER: D1.  Deal Health — the alert list behind screen 14.
// Phase 0 stub — created so this file is never created twice. See OWNERSHIP.md.
//
// Reads deal_alert.  Screen 14 RENDERS these rows; it does not derive alerts
// from quotation columns, so unresolved rows must exist in the seed or the
// screen is empty.  D3 is blocked on this endpoint.
import { fail } from '@/lib/api'

export const runtime = 'nodejs'

export async function GET() {
  return fail('Not implemented yet — owner: D1', 501)
}
