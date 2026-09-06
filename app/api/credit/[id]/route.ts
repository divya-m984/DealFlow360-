// OWNER: D2.  CLAIMED.
//
// One customer's credit picture, recomputed the long way through
// lib/credit.ts — the same code path the ORDER CONFIRMATION check uses.
//
// That is deliberate. The list route aggregates in SQL for speed; this one
// goes through the function that actually decides whether a deal is allowed.
// If the two ever disagree, the screen shows it, and the number that gets
// enforced is the one shown here.

import { tx } from '@/lib/db'
import { ok, fail, withAuth } from '@/lib/api'
import { getCreditProfile } from '@/lib/credit'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

const INTERNAL = ['sales_rep', 'sales_manager', 'finance', 'admin', 'super_admin', 'viewer'] as const

export const GET = withAuth<Ctx>([...INTERNAL], async (_req, _s, { params }) => {
  const id = Number((await params).id)
  if (!Number.isFinite(id)) return fail('Invalid customer id', 400)
  const profile = await tx(async (c) => getCreditProfile(c, id))
  if (!profile) return fail('No such customer.', 404)
  return ok(profile)
})
