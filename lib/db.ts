// OWNER: Integrator.  FROZEN after Phase 0.
//
// pg is imported ONLY inside app/api/**.  Never from a page or a component.

import { Pool, types, type PoolClient } from 'pg'

// pg returns bigint (OID 20) as a STRING to avoid precision loss.  Every id in
// this schema is `bigint GENERATED ALWAYS AS IDENTITY`, so without this every
// id arrives as "1" rather than 1 — and a strict comparison like
// `session.customerId === quotation.customer_id` is then ALWAYS false.
// That check is how the portal is row-scoped (PS §7), so this matters.
// Our ids are nowhere near 2^53; parsing to a number is safe.
types.setTypeParser(types.builtins.INT8, (v) => parseInt(v, 10))

// NOTE: numeric (OID 1700) is deliberately LEFT as a string.  It carries money,
// and parsing it to a float would reintroduce the rounding error that
// numeric(14,2) exists to prevent.  Format it for display; never parseFloat it
// and write it back.

// Next's hot reload re-evaluates modules on every recompile.  Without this
// cache you get a new Pool per recompile and exhaust Postgres connections by
// mid-evening — with four dev servers running, sooner.
const g = globalThis as unknown as { _dfPool?: Pool }

export const db: Pool =
  g._dfPool ??
  (g._dfPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
  }))

/** Run a query, get rows back. */
export async function q<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
  const res = await db.query(sql, params)
  return res.rows as T[]
}

/** Run a query, get the first row or null. */
export async function one<T = any>(sql: string, params: unknown[] = []): Promise<T | null> {
  const rows = await q<T>(sql, params)
  return rows[0] ?? null
}

/**
 * Wrap writes in a transaction.  Use this for ANYTHING that writes more than
 * one row — money and state must never be half-written.
 *
 *   await tx(async (c) => {
 *     await c.query('UPDATE quotation_line SET ...', [...])
 *     await recomputeQuotation(c, id)
 *   })
 */
export async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await db.connect()
  try {
    await c.query('BEGIN')
    const out = await fn(c)
    await c.query('COMMIT')
    return out
  } catch (e) {
    await c.query('ROLLBACK')
    throw e
  } finally {
    c.release()
  }
}
