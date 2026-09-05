// OWNER: D1.  Portal — addressed by public_id uuid ONLY.
// Phase 0 stub — created so this file is never created twice. See OWNERSHIP.md.
import { fail } from '@/lib/api'

export const runtime = 'nodejs'

export async function GET() {
  return fail('Not implemented yet — owner: D1', 501)
}
