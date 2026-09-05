// OWNER: D4.  Reporting aggregates (screen 15, optional).
// Phase 0 stub — created so this file is never created twice. See OWNERSHIP.md.
//
// PS §A7 filters: Period · Sales Team/Rep · Approval Status · Product/Category.
// Sales Team/Rep reads sales_team and app_user.team_id — both seeded.
import { fail } from '@/lib/api'

export const runtime = 'nodejs'

export async function GET() {
  return fail('Not implemented yet — owner: D4', 501)
}
