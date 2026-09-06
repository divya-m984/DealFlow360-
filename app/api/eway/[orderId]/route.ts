// OWNER: D2.  CLAIMED — new path.
//
// GET  — is an e-way bill required for this order, and Part A pre-filled from
//        data the system already holds.
// POST — file it. Part A alone, or Part A + Part B together when the vehicle
//        is known. The validity clock starts with Part B.
//
// One bill PER WAREHOUSE, not per order. A split shipment is two physical
// movements from two states, and each lorry needs its own document — which
// is exactly why the allocator's warehouse split matters here and not only
// on a cost report.

import { z } from 'zod'
import { q, one, tx } from '@/lib/db'
import { ok, fail, withAuth, parseBody, BusinessRuleError } from '@/lib/api'
import { evaluateEway, ewayValidityDays, ewayValidUntil } from '@/lib/eway'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ orderId: string }> }

const INTERNAL = ['sales_rep', 'sales_manager', 'finance', 'admin', 'super_admin', 'viewer'] as const
const FILE_ROLES = ['finance', 'admin'] as const

/** Consignment value per despatching warehouse, plus both ends' place of
 *  supply. One row per lorry. */
async function movements(orderId: number) {
  return q(
    `SELECT w.id            AS warehouse_id,
            w.code          AS warehouse_code,
            w.name          AS warehouse_name,
            w.state_code    AS from_state_code,
            w.state_name    AS from_state_name,
            cu.state_code   AS to_state_code,
            cu.state_name   AS to_state_name,
            cu.name         AS customer_name,
            cu.gstin        AS customer_gstin,
            o.number        AS order_number,
            -- Consignment value is the goods actually on THIS lorry: the
            -- allocated quantity at this warehouse, at the line's net rate.
            SUM(fa.qty * (sol.net_amount / NULLIF(sol.qty, 0)))::numeric(14,2) AS consignment_value,
            string_agg(DISTINCT p.sku, ', ' ORDER BY p.sku) AS skus,
            MAX(eb.id) AS existing_bill_id
       FROM fulfillment_allocation fa
       JOIN sales_order_line sol ON sol.id = fa.order_line_id
       JOIN sales_order o        ON o.id = sol.order_id
       JOIN customer cu          ON cu.id = o.customer_id
       JOIN warehouse w          ON w.id = fa.warehouse_id
       JOIN product p            ON p.id = sol.product_id
       LEFT JOIN eway_bill eb    ON eb.order_id = o.id
                                AND eb.from_warehouse_id = w.id
                                AND eb.cancelled_at IS NULL
      WHERE o.id = $1 AND fa.status <> 'cancelled'
      GROUP BY w.id, w.code, w.name, w.state_code, w.state_name,
               cu.state_code, cu.state_name, cu.name, cu.gstin, o.number
      ORDER BY w.code`,
    [orderId],
  )
}

export const GET = withAuth<Ctx>([...INTERNAL], async (_req, _s, { params }) => {
  const orderId = Number((await params).orderId)
  if (!Number.isFinite(orderId)) return fail('Invalid order id', 400)

  const order = await one(`SELECT id, number FROM sales_order WHERE id = $1`, [orderId])
  if (!order) return fail('No such order.', 404)

  const rows = await movements(orderId)
  const bills = await q(
    `SELECT * FROM eway_bill WHERE order_id = $1 ORDER BY id`, [orderId],
  )

  const consignments = rows.map((r: any) => {
    const value = Number(r.consignment_value ?? 0)
    const evaluation = evaluateEway({
      fromStateCode: r.from_state_code,
      toStateCode: r.to_state_code,
      consignmentValue: value,
    })
    return { ...r, consignment_value: value, evaluation }
  })

  return ok({
    order,
    consignments,
    bills,
    requiredCount: consignments.filter((c: any) => c.evaluation.required).length,
    note:
      'One e-way bill per despatching warehouse — a split shipment is two physical movements ' +
      'from two states, and each vehicle carries its own document.',
  })
})

const Body = z.strictObject({
  warehouseId: z.number().int().positive(),
  reason: z.string().min(2).max(60).default('Supply'),
  // Part B — optional. Filing Part A alone is legitimate and common: the
  // consignment is ready before the vehicle is assigned.
  transportMode: z.enum(['road', 'rail', 'air', 'ship']).optional(),
  vehicleNumber: z.string().min(4).max(20).optional(),
  transporterDoc: z.string().max(40).optional(),
  distanceKm: z.number().int().positive().max(5000).optional(),
  isOdc: z.boolean().default(false),
})

export const POST = withAuth<Ctx>([...FILE_ROLES], async (req, session, { params }) => {
  const orderId = Number((await params).orderId)
  if (!Number.isFinite(orderId)) return fail('Invalid order id', 400)
  const b = await parseBody(req, Body)

  const rows = await movements(orderId)
  const m: any = rows.find((r: any) => Number(r.warehouse_id) === b.warehouseId)
  if (!m) return fail('That warehouse has no allocation on this order.', 400)
  if (m.existing_bill_id) {
    return fail(`An e-way bill already exists for ${m.warehouse_code} on this order.`, 409)
  }

  const value = Number(m.consignment_value ?? 0)
  const evaluation = evaluateEway({
    fromStateCode: m.from_state_code,
    toStateCode: m.to_state_code,
    consignmentValue: value,
  })

  // Part B needs a distance, because the distance IS the validity.
  const hasPartB = Boolean(b.transportMode && b.vehicleNumber)
  if (hasPartB && !b.distanceKm) {
    throw new BusinessRuleError(
      'Part B needs the transit distance — validity is one day per 200 km (20 km for over-dimensional cargo), so without it there is no expiry to compute.',
    )
  }

  const result = await tx(async (c) => {
    const seq = await c.query(`SELECT count(*)::int + 1 AS n FROM eway_bill`)
    // The portal issues a 12-digit EBN. Ours is clearly ours: prefixed, and
    // never presented as portal-issued.
    const ebn = 'EWB-' + String(Date.now()).slice(-8) + '-' + String(seq.rows[0].n).padStart(3, '0')

    const partBAt = hasPartB ? new Date() : null
    const validUntil =
      hasPartB && b.distanceKm ? ewayValidUntil(partBAt!, b.distanceKm, b.isOdc) : null

    const r = await c.query(
      `INSERT INTO eway_bill
         (ebn, order_id, from_warehouse_id, consignment_value, from_state_code, to_state_code,
          is_interstate, hsn_code, reason, transport_mode, vehicle_number, transporter_doc,
          distance_km, is_odc, part_b_at, valid_until, created_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING *`,
      [ebn, orderId, b.warehouseId, value, m.from_state_code, m.to_state_code,
       evaluation.isInterstate, m.skus, b.reason,
       b.transportMode ?? null, b.vehicleNumber ?? null, b.transporterDoc ?? null,
       b.distanceKm ?? null, b.isOdc, partBAt, validUntil, session.userId],
    )

    await c.query(
      `INSERT INTO audit_log (entity_type, entity_id, action, actor_user_id, note, payload)
       VALUES ('sales_order', $1, 'eway_bill', $2, $3, $4)`,
      [orderId, session.userId,
       `${ebn} raised for ${m.warehouse_code} → ${m.to_state_name} (₹${value.toFixed(2)})` +
       (hasPartB ? `, vehicle ${b.vehicleNumber}, valid ${ewayValidityDays(b.distanceKm!, b.isOdc)} day(s)` : ', Part A only'),
       JSON.stringify({ ebn, evaluation, partB: hasPartB })],
    )

    return r.rows[0]
  })

  return ok({
    bill: result,
    evaluation,
    validityDays: hasPartB && b.distanceKm ? ewayValidityDays(b.distanceKm, b.isOdc) : null,
    registered: false,
    disclaimer:
      'Generated locally against the Rule 138 logic. NOT filed with the NIC e-way bill portal — ' +
      'the EBN is ours, not portal-issued.',
  }, 201)
})
