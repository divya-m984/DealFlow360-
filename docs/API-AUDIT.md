# API audit — redundant work and rule duplication

Written after an evaluator asked *"why are you fetching twice for approval?"*
They were right. This is the sweep for every instance of the same **class** of
defect, across all four lanes, with the verdict on each.

Two classes are in scope:

- **Redundant work** — asking the database the same question twice in one
  request, or holding a connection nothing needs.
- **Rule duplication** — the same business rule written in two places, where
  the two copies can drift apart. This is the more dangerous class: redundant
  work makes the app slow, a drifted rule makes it *wrong*.

Measured latency at demo scale is **9–14 ms on every endpoint**, and none of
the fixes below changed that measurably — at eight seeded quotations the time
is Next.js request overhead, not the database. Everything here is about
structure: connection pressure, round trips, and above all where a rule lives.

---

## FIXED — the two the evaluator's question exposed

### 1. `POST /api/approvals/[id]` ran the identical query twice

```ts
} else if (await isApproved(c, qid)) {          // query
  ...
}
return ok({ ..., isApproved: await isApproved(c, qid) })   // same query again
```

Nothing between the two calls writes `approval_request`, so the second could
never return a different answer. Now asked once and reused.

### 2. `GET /api/quotations/[id]` read `approval_request` twice, on two connections

It selected the approval **chain** for display, then asked separately whether
the quotation **was approved** — two reads of one table for one screen — and
checked out a second pool connection to do it, because `isApproved` was typed
`(c: PoolClient)` and a pool-based handler could not call it.

**The fix was not to compute the verdict in JavaScript from the rows already
fetched.** That would have put the governance rule in two places, which is the
second class of defect and much worse than the first. Instead the rule became
one exported SQL expression:

```ts
// lib/approval.ts — one copy in the codebase
export const IS_APPROVED_SQL = `...`
```

`isApproved()` uses it; the detail endpoint folds the *same* expression into
the head query it was already running. One definition, two call sites, one
read. `isApproved` now accepts `Pick<PoolClient,'query'>`, so a `Pool`
satisfies it and a read-only handler holds no connection it does not need.

**5 sequential queries + 2 connections → 1 head query, then 3 concurrent, on 1
connection.**

---

## OPEN — real, not yet fixed

### 3. N+1 in `GET /api/fulfilment/[id]` · D2 · low priority

`for (const l of lines.rows)` issues, per order line: two queries in a
`Promise.all`, then one or two `loadStockFor` calls. A three-line order costs
roughly twelve queries; the count grows with the order.

Not a bug and not worth fixing before the demo — orders have a handful of
lines and it runs in single-digit milliseconds. It is the only true N+1 in the
codebase and it should be named in the "what we'd build next" note rather than
discovered by a judge.

The fix, if there is ever time: load stock for every product on the order in
one query keyed by `product_id`, then plan each line against that map.

### 4. `amount_due` written out in two files · D2 · cosmetic

`(i.amount_total - COALESCE(p.paid, 0)) AS amount_due` appears in both
`api/invoices/route.ts` and `api/invoices/[id]/route.ts`. Identical today.
It is arithmetic rather than policy, so drift would be visible immediately,
but it is the same shape as defect 2 and the same fix applies — one exported
SQL fragment.

---

## ACCEPTED — deliberate, documented, keep

### `Math.min` in `app/(app)/settings/page.tsx` mirrors `LEAST()` in SQL

Screen 18 previews the effective ceiling live as the admin types. That is a
second expression of `effective_ceiling_pct()`.

**Accepted because it is display-only** — the value is never persisted, and
every stored ceiling still comes from the SQL function. Same category as the
live limit check on screen 4: a number shown while typing, replaced by the
server's answer on save.

**It is still a drift point.** If the ceiling rule ever stops being
`LEAST(tier, category)`, this UI silently keeps showing the old rule. Anyone
changing `effective_ceiling_pct` must change this too.

### The risk score exists in SQL *and* TypeScript

`db/seed/05-quotations.sql` computes the blended score in SQL;
`lib/risk.ts` computes it in TypeScript. Two implementations of PS §10.

**Accepted, and deliberately so.** The SQL version seeds the database and acts
as the reference implementation; the TypeScript version is what PS §7 requires
("real application logic, not hardcoded"). They are cross-checked: a script
runs `blendedRiskScore()` against every seeded quotation and compares it to the
stored value. All eight agree. **If they ever disagree, the TypeScript is
wrong** — but the check must actually be re-run when either side changes.

### `effective_ceiling_pct` referenced in nine files

This is the *good* pattern, not a smell. One SQL function, nine callers. It is
what defect 2 was refactored to look like.

### `SELECT *` after a write, seven places

Always a single-row primary-key fetch after an `UPDATE`, to return the fresh
row. Costs nothing at this size. `RETURNING *` would save a round trip; not
worth the churn now.

### `lib/invoice.ts` is the only place `invoice.status` is set

Explicitly documented in that file, and verified: paying the exact balance
moves `unpaid → partial → paid`, and overpayment is refused with a readable
message. Status is a conclusion recomputed from `SUM(payment.amount)`, never a
value anyone types. This is the pattern the rest of the codebase should follow.

---

## Checked and clear

- **No transaction is held open across an HTTP boundary.** `tx()` always
  releases in a `finally`.
- **Index coverage matches the actual `WHERE` clauses** — the partial indexes
  on pending approvals and unresolved deal alerts are both used by the queries
  that motivated them.
- **No `await` inside a loop over a result set** anywhere except defect 3.
- **`lib/db.ts` caches the pool on `globalThis`**, so Next's hot reload does
  not leak a pool per recompile.

## Known limitation, not a defect

**No pagination on any of the twenty list endpoints.** Irrelevant at eight
quotations; it would matter at ten thousand. Deliberately out of scope for a
24-hour build, and it belongs in the roadmap note where it reads as a decision
rather than an oversight.
