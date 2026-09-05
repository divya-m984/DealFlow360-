// OWNER: D1.
//
// LAW 1 — an approval belongs to a VERSION, not to a quotation.
//
// approval_request is keyed UNIQUE (quotation_id, quotation_version, level).
// A quotation is approved if and only if the levels it REQUIRES have approved
// rows AT ITS CURRENT VERSION.
//
// There is no is_approved column and there must never be one.  A boolean flag
// is a second source of truth, and the only thing defending it is somebody
// remembering to reset it after an edit — which nobody does at hour 19.
// Keying to the version makes an edit orphan its own approval. There is no
// flag to forget.

import type { PoolClient } from 'pg'
import { audit } from './quotation'
import type { ApprovalLevel, ApprovalRequest, ApprovalStatus } from './types/quotation'

/**
 * The ONLY correct way to ask "is this approved?".  Three things it has to get
 * right, each of which is a bug if you simplify it:
 *
 *  1. A LOW-risk quotation has ZERO approval_request rows and is approved
 *     anyway.  Both `requires_*` are false, so both clauses short-circuit to
 *     true.  Anything built on "an approved row exists" breaks §9 step 3 —
 *     the "no approval needed, straight to fulfilment" branch.
 *
 *  2. Check the levels REQUIRED, not the rows PRESENT.  "Every row present is
 *     approved" reads as fully approved on a HIGH quotation where the manager
 *     has signed and the finance row does not exist yet.
 *
 *  3. A `rejected` or `returned` row blocks approval even if the other level
 *     approved.
 */
export async function isApproved(c: PoolClient, quotationId: number): Promise<boolean> {
  const { rows } = await c.query<{ is_approved: boolean }>(
    `SELECT
       (NOT q.requires_manager OR EXISTS (
          SELECT 1 FROM approval_request a
           WHERE a.quotation_id = q.id AND a.quotation_version = q.version
             AND a.level = 'sales_manager' AND a.status = 'approved'))
       AND
       (NOT q.requires_finance OR EXISTS (
          SELECT 1 FROM approval_request a
           WHERE a.quotation_id = q.id AND a.quotation_version = q.version
             AND a.level = 'finance' AND a.status = 'approved'))
       AND NOT EXISTS (
          SELECT 1 FROM approval_request a
           WHERE a.quotation_id = q.id AND a.quotation_version = q.version
             AND a.status IN ('rejected','returned'))
       AS is_approved
     FROM quotation q
     WHERE q.id = $1`,
    [quotationId],
  )
  if (rows.length === 0) throw new Error(`Quotation ${quotationId} not found`)
  return rows[0].is_approved
}

/**
 * Create the approval chain for the quotation's CURRENT version.
 *
 * Called on submit, and again after any edit that bumped the version — the old
 * version's rows are left exactly where they are.  They are not deleted and
 * not updated; they simply stop being current.  That history is what screen 6
 * renders as the audit trail, and it is the clearest evidence that the
 * orphaning is structural rather than a flag someone flipped.
 *
 * Idempotent: ON CONFLICT DO NOTHING against the (quotation, version, level)
 * key, so a double submit cannot duplicate a chain.
 */
export async function createApprovalChain(
  c: PoolClient,
  quotationId: number,
): Promise<ApprovalLevel[]> {
  const { rows } = await c.query<{
    version: number; requires_manager: boolean; requires_finance: boolean
  }>(
    `SELECT version, requires_manager, requires_finance FROM quotation WHERE id = $1`,
    [quotationId],
  )
  if (rows.length === 0) throw new Error(`Quotation ${quotationId} not found`)
  const { version, requires_manager, requires_finance } = rows[0]

  const levels: ApprovalLevel[] = []
  if (requires_manager) levels.push('sales_manager')
  if (requires_finance) levels.push('finance')

  // LOW risk: no levels, no rows, approved by construction.
  for (const [i, level] of levels.entries()) {
    await c.query(
      `INSERT INTO approval_request (quotation_id, quotation_version, level, seq, status, assigned_to_user_id)
       SELECT $1, $2, $3, $4, 'pending',
              (SELECT id FROM app_user
                WHERE role = $5::user_role AND is_active
                ORDER BY id LIMIT 1)
       ON CONFLICT (quotation_id, quotation_version, level) DO NOTHING`,
      [quotationId, version, level, i + 1, level === 'finance' ? 'finance' : 'sales_manager'],
    )
  }

  return levels
}

/**
 * Record one reviewer's decision.
 *
 * Finance cannot act before the manager has approved — the chain is ordered by
 * `seq`, and that ordering is enforced HERE, not merely by hiding a button.
 */
export async function actOnApproval(
  c: PoolClient,
  params: {
    approvalRequestId: number
    actorUserId: number
    status: Extract<ApprovalStatus, 'approved' | 'returned' | 'rejected'>
    note?: string
  },
): Promise<ApprovalRequest> {
  const { rows } = await c.query<ApprovalRequest & { q_version: number }>(
    `SELECT a.*, q.version AS q_version
       FROM approval_request a JOIN quotation q ON q.id = a.quotation_id
      WHERE a.id = $1 FOR UPDATE OF a`,
    [params.approvalRequestId],
  )
  const req = rows[0]
  if (!req) throw new Error('Approval request not found')

  // An approval belonging to a superseded version is dead. Acting on it would
  // resurrect an approval for terms nobody is looking at any more.
  if (req.quotation_version !== req.q_version) {
    throw new Error(
      'This approval is for an earlier version of the quotation. The terms have changed since — it must be re-submitted.',
    )
  }
  if (req.status !== 'pending') throw new Error(`Already ${req.status}`)

  if (req.level === 'finance') {
    const { rows: mgr } = await c.query<{ status: ApprovalStatus }>(
      `SELECT status FROM approval_request
        WHERE quotation_id = $1 AND quotation_version = $2 AND level = 'sales_manager'`,
      [req.quotation_id, req.quotation_version],
    )
    if (mgr[0] && mgr[0].status !== 'approved') {
      throw new Error('Finance cannot act until the sales manager has approved')
    }
  }

  const { rows: updated } = await c.query<ApprovalRequest>(
    `UPDATE approval_request
        SET status = $2, acted_by_user_id = $3, acted_at = now(), note = $4
      WHERE id = $1 RETURNING *`,
    [params.approvalRequestId, params.status, params.actorUserId, params.note ?? null],
  )

  // PS §A3: user, timestamp AND reason, on every approval, rejection and edit.
  await audit(c, 'quotation', req.quotation_id, params.status, params.actorUserId, params.note, {
    level: req.level,
    quotation_version: req.quotation_version,
  })

  return updated[0]
}
