# DealFlow360 — full audit

Scope: every file under `app/`, `lib/`, `components/`, `db/`, plus `middleware.ts`.
Three questions: **what business logic is missing**, **where does the usage
workflow break**, and **what can be optimised**.

## How each finding was checked

| Method | What it means |
|---|---|
| **VERIFIED** | Confirmed by running SQL against the live `dealflow-db` container, or by running the toolchain. The evidence is quoted. |
| **CODE** | Read from the source. Deterministic — no query needed. |
| **LATENT** | Real defect in the code path, not currently firing because the seed data does not reach it. |

Toolchain status at the time of the audit: `tsc --noEmit` **clean**,
`next build` **passes**, `lib/allocate.test.mjs` **all pass**,
`eslint` **133 errors / 11 warnings** (none block the build).

---

# A · Pipeline and workflow breaks

Ranked by what they cost you in front of a judge.

## A1 — A confirmed quotation never becomes a sales order · **VERIFIED** · blocks the demo

`POST /api/orders` has **no caller anywhere in the UI**. Grep for it across
`app/` and `components/` returns nothing; the only client references are
`GET /api/orders/[id]` and `POST /api/orders/[id]/invoice`.

- `app/(app)/quotations/[id]/page.tsx:169` — the "Confirm Order" button calls
  `POST /api/quotations/[id]/confirm` and nothing else.
- `app/api/quotations/[id]/confirm/route.ts` returns
  `nextStep: 'POST /api/orders { quotationId }'`, and its own header says
  *"Screen 4's Confirm button calls both in sequence"*. It does not.
- `docs/DEMO-SCRIPT.md` step D says *"Rep converts the confirmed quote to an
  order via `POST /api/orders`"* — i.e. the script already assumes a curl.

Consequence: quotation → order → allocation → shipment → invoice → payment is
severed at the first hop. Every order in the system is seeded.

```
orders | lines | lines_invoiced
     2 |     4 |              3     ← both seeded; none created by the app
```

**Second half of the same break:** a LOW-risk quotation goes straight from
`draft` to `confirmed` inside submit (`app/api/quotations/[id]/submit/route.ts:44`),
and the Confirm button only renders for `q.state === 'approved'`
(`page.tsx:166`). So the auto-approved path never even shows the button it
would need — the fastest, most likely demo path is the most broken one.

**Fix:** chain the order creation onto the Confirm button, and render an
"Create Order" action for any `confirmed` quotation with no `sales_order` row.
Both are one file.

## A2 — Invoices carry no tax · **VERIFIED**

`invoice` and `invoice_line` have no tax column. Every invoice amount is a sum
of `sales_order_line.net_amount`, which is tax-exclusive
(`lib/invoice.ts:95`, `:496`). The quotation, meanwhile, computes
`tax_total` and puts it into `grand_total` (`lib/quotation.ts:76`).

```
 number  | order_total | lines_net  | tax_total  | invoiced
 SO-1028 |  1843661.50 | 1562425.00 |  281236.50 | 1526175.00
```

`1562425.00 + 281236.50 = 1843661.50` exactly. The order says the customer owes
₹18.4 lakh; the invoices can never bill more than ₹15.6 lakh. **The gap is
precisely the GST.**

This also poisons credit control: `POST /api/orders` checks credit against
tax-inclusive `quo.grand_total`, but `lib/credit.ts:137` computes
`uninvoicedCommitment` from tax-exclusive `net_amount`. Two bases, one number.

Related and entirely unimplemented: `db/seed/00-migrations.sql` §7 adds
`customer.state_code`, `warehouse.state_code` and `customer.gstin` and explains
CGST+SGST vs IGST at length. Nothing computes a tax split anywhere. Those
columns are used only by the e-way threshold. The IRN at posting hashes a
document that has no tax on it.

**Fix:** additive migration — `invoice.tax_total`, `invoice.amount_untaxed`,
`invoice_line.tax_pct`/`tax_amount`, then carry `quotation_line.tax_pct`
through `sales_order_line` into both invoice builders. The CGST/SGST/IGST split
is a second, larger piece — say so rather than half-building it.

## A3 — Pricelists are modelled, seeded, displayed, and never applied · **VERIFIED**

`app/api/quotations/[id]/lines/route.ts:69` prices a line as
`product.base_price` (+ `product_variant.extra_price` at `:76`). The
quotation's own `pricelist_id` — chosen from the customer's tier at creation —
is never read.

```
  tier  |  pricelist  |   rule_type   | value | lines | repriced
 Gold   | Gold List   | discount_pct  |  10.0 |     6 |        0
 Silver | Silver List | discount_pct  |   5.0 |     3 |        0
 Bronze | Bronze List | no_adjustment |   0.0 |     2 |        0
```

Zero of seventeen lines are repriced. Meanwhile
`app/api/products/[id]/route.ts` computes and shows an `effective_price` per
tier from exactly those `pricelist_item` rows — so **the product screen
advertises a price the quotation builder will not charge.** A judge who opens
the product page and then adds it to a Gold quotation sees the contradiction
immediately.

**Fix:** resolve the pricelist in the same `INSERT ... SELECT` that already
snapshots `ceiling_pct` — product-specific rule beats category rule, exactly
as the products route already does it. Reuse that SQL rather than writing a
second copy.

## A4 — Shipping does not raise the delivery invoice · **CODE**

`app/api/fulfilment/[id]/ship/route.ts:53` calls `createOrderInvoice`, whose
header comment there claims it *"subtracts what has already been invoiced for
each line"*. It does not do that job: `lib/invoice.ts:88` filters
`p.invoice_policy = 'order'`, and every order-policy line already had
`qty_invoiced` set to `qty` when the order was created (`lib/invoice.ts:116`).

So on a hardware order the call returns `null` every time, and
`ship/route.ts:62` writes the audit note **"nothing new to invoice"** on every
shipment. The delivery invoice — jury ask 6 — only ever happens if a finance
user finds the Billing tab and presses the button there.

**Fix:** call `createDeliveryInvoice` on ship. It already exists, already
handles the closing-invoice rounding, and is already correct.

## A5 — Nothing posts an invoice, and the invoice list cannot show draft state · **VERIFIED**

Both invoice builders create rows with `posted_at` NULL — drafts. Consequences
that compound:

- `lib/invoice.ts:204` — `applyPayment` refuses a draft.
- `lib/credit.ts:112` — `getCreditProfile` counts only posted invoices, so a
  draft invoice contributes **nothing** to receivables or exposure.
- `app/api/invoices/route.ts` does not even **select** `posted_at`, so
  `app/(app)/invoices/page.tsx` renders a draft as `status = 'unpaid'`,
  indistinguishable from a posted one — and will happily flag it `is_overdue`.

There are 9 invoices; 1 is a draft, and nothing on the list screen says so.

**Fix:** add `posted_at` to the list SELECT and render a Draft chip; decide
whether posting is automatic on delivery-invoice creation or stays a finance
step (Odoo keeps it manual — that is defensible, but it has to be visible).

## A6 — `customer.payment_terms_days` never reaches a due date · **CODE**

The migration comment says it *"drives the due date on every invoice and
therefore the aging buckets."* It does not. `createOrderInvoice` defaults
`dueInDays ?? 0` (`lib/invoice.ts:103`) — **due today** — and
`createDeliveryInvoice` hardcodes `?? 15` (`:525`). The column is read only by
the credit screen, where it is displayed and ignored.

**Fix:** `opts.dueInDays ?? customer.payment_terms_days` in both builders.

## A7 — Recurring billing has no driver and no due-date guard · **CODE / VERIFIED**

`subscription.next_bill_date` is maintained and has its own partial index
(`schema.sql:495`). Nothing ever queries it. Billing happens only when a human
POSTs `/api/subscriptions/[id]/invoice`, and that route's only guard is
`status !== 'active'` (`:22`) — there is **no** `next_bill_date <= CURRENT_DATE`
check. Finance can bill a yearly plan five periods forward by clicking five
times.

```
 id | status | current_period_end | next_bill_date | due_now
  1 | active | 2026-09-27         | 2026-09-27     | f
  5 | active | 2027-05-29         | 2027-05-29     | f
```

**Fix:** refuse to bill before `next_bill_date`, and add a "due for billing"
list (or a `POST /api/subscriptions/run-billing` scan, in the same honest shape
as `POST /api/alerts/scan`).

## A8 — Approval routing ignores the sales team · **VERIFIED**

`lib/approval.ts:107-111` assigns every approval to
`SELECT id FROM app_user WHERE role = $5 AND is_active ORDER BY id LIMIT 1` —
the lowest-id manager in the whole company. `sales_team.manager_user_id` and
`app_user.team_id` are seeded and never consulted.

```
 id | code |    name     | team_manager | members
  1 | west | West Region | M. Shah      |       3
  2 | east | East Region | M. Shah      |       1
```

Invisible today only because both teams share one manager. Add a second manager
and every East Region deal still routes West.

**Fix:** prefer the owner's team manager, fall back to any active manager.

## A9 — The session is a 24h snapshot with no revocation · **CODE** · undercuts jury asks 3 & 7

`lib/auth.ts:22` reads the JWT and returns its payload. `withAuth`
(`lib/api.ts:104`) checks the role **from the token**. Nothing re-reads
`app_user`.

- Deactivating a user (`PATCH /api/users/[id]`) leaves them fully functional
  for up to 24 hours.
- Promoting or demoting (`PATCH /api/users/[id]/role`) has no effect on the
  affected user until they log out and back in.

The jury asked how a user is created and how a user is promoted. The screens
answer both, and the enforcement layer then ignores the answer.

**Fix:** re-read `is_active` and `role` in `withAuth` (one indexed primary-key
lookup, cheap at this scale), or stamp a `token_version` on `app_user` and
compare. The first is simpler and demoable: promote a user in one tab, watch
the other tab's permissions change on the next request.

## A10 — Public signup mints a role with write access · **CODE**

`middleware.ts:23` lists `/api/auth/signup` as PUBLIC, and
`app/api/auth/signup/route.ts` creates a `sales_rep` — which
`lib/roles.ts:41` includes in `INTERNAL_WRITERS`. Anyone who can load the app
can create an account that writes quotations, lines, negotiations, orders and
deal-alert actions.

`app/api/users/route.ts`'s own header calls this *"a self-service registration
door, not user administration"*. For an ERP it should not be a door at all.

**Fix:** disable it outside development the same way `/api/auth/switch` is
disabled, or create `viewer` instead of `sales_rep`.

## A11 — Credit exposure never releases a credit note · **CODE**

`lib/credit.ts:148` and the same term in `app/api/credit/route.ts`:

```sql
SELECT COALESCE(SUM(amount), 0) FROM credit_note WHERE customer_id = $1
```

Every credit note ever issued, forever, subtracted from exposure — despite the
type comment reading *"Credit notes issued and not consumed by a payment."*
A note raised two years ago and long since settled still grants headroom.

**Fix:** either net credit notes against the invoice they reference and count
only unapplied ones, or drop the term and say so.

## A12 — `discount_anomaly` alerts never close, and the average includes the accused · **VERIFIED**

`lib/alerts.ts:153-178` — the auto-resolve UPDATE has branches for `stalled`
and `delivery_slippage` only. A discount anomaly stays open after the discount
is brought back in line. All three seeded kinds are currently open.

Separately, `tier_avg` at `:109-111` aggregates over `per_quote` **including
the quotation being judged**, while the comment above it says *"the average
discount on OTHER quotations."* With `MIN_SAMPLE = 3` this drags the average
toward the outlier and suppresses genuine anomalies.

**Fix:** add the third auto-resolve branch; make the tier average a correlated
`AVG` excluding `p.id`.

## A13 — E-way bills are raised against stock that has not moved · **CODE**

`app/api/eway/[orderId]/route.ts:53` sums `fulfillment_allocation` where
`status <> 'cancelled'` — which includes `planned`. A `planned` allocation
reserves nothing (`_stock.ts` says so explicitly). So you can file Part A, and
Part B with a vehicle number, for a consignment nobody has picked.

`eway_bill.invoice_id` is never populated, although the schema comment says
filing Part A locks the underlying invoice.

**Fix:** restrict to `status IN ('reserved','shipped')`, and link the delivery
invoice when one exists.

## A14 — Alert detection only runs when somebody presses a button · **CODE**

`scanDealAlerts` is correct and idempotent. It is reachable only via
`POST /api/alerts/scan`, triggered from `components/admin/alert-scan.tsx`. Deal
Health therefore shows whatever was true the last time a human pressed scan.
The file is honest about why there is no worker — worth keeping that honesty,
but consider firing the scan on the Deal Health page load too.

---

# B · Correctness defects

## B1 — Stock writes can hit the pooled row *and* the variant row · **LATENT**

`app/api/fulfilment/_stock.ts:236` (reserve) and `:281` (ship):

```sql
WHERE warehouse_id = $1 AND product_id = $2
  AND (variant_id IS NULL OR variant_id = $4)
```

`UPDATE` has no `LIMIT`. If a product has both a product-level pool row and a
variant row in the same warehouse, **both are decremented** — double the
quantity leaves the books.

The read path deliberately picks one or the other and says why
(`loadStockFor`, "Mixing the two would double-count, so it is one or the other,
never both"). The write path does not honour that.

Not firing today — the seed has no `(warehouse, product)` with more than one
row, confirmed:

```
 product_id | warehouse_id | rows
(0 rows)
```

But `LP14` already has two `product_variant` rows, so one variant-level stock
row is all it takes.

**Fix:** target the exact row the read path chose — pass `stockLevelId` through
from `loadStockFor` and update by primary key.

## B2 — Document numbers are `count(*) + 1` · **CODE**

Four places:

- `lib/invoice.ts:34` — `nextNumber()`, used for every invoice
- `lib/billing.ts:461` — credit notes from proration
- `app/api/invoices/[id]/credit-note/route.ts:84` — credit notes from reversal
- `app/api/eway/[orderId]/route.ts:134` — e-way bill sequence

Three problems, in order of severity:

1. **Racy.** Two concurrent invoices read the same count, both build
   `INV-2026-0010`, the `UNIQUE` constraint rejects the second, and the caller
   gets a 500. The unique index is a backstop, not a numbering scheme.
2. **Never restarts per financial year** despite the year being in the string.
   In 2027 the tenth invoice overall is `INV-2027-0010`, not `INV-2027-0001` —
   and the IRN at posting hashes that number together with the financial year.
3. **Wrong after a delete.** Any deletion re-issues a used number.

**Fix:** a Postgres `SEQUENCE` per prefix — O(1), race-free, additive.

## B3 — The portal derives `author_side` from the author's current role · **CODE**

`app/api/portal/quotations/[publicId]/route.ts:82`:

```sql
'author_side', CASE WHEN cau.role = 'portal' THEN 'buyer' ... ELSE 'seller' END
```

This is the exact bug that `db/seed/00-migrations.sql` §2 and three separate
route headers say must never be written — *"promote the rep who ran this
negotiation and a derived side would re-render months of history from the new
role."* Every other reader reads the stored `nc.author_side` column. This one
does not.

Currently both seeded comments have a non-null `author_side`, so the column is
there to be read.

**Fix:** one-line — select `nc.author_side`.

## B4 — Refused business rules return 500 · **CODE**

`BusinessRuleError` exists precisely for this (`lib/api.ts:55`) and is used in
five places. Everywhere else a refused rule is a bare `throw new Error`, which
`withAuth` maps to **500**:

| Message the user sees as a server fault | Where |
|---|---|
| "This line has already been reserved or shipped" | `_stock.ts:158` |
| "Nothing on this order is reserved yet" | `ship/route.ts` |
| "No open backorder … can be filled from current stock" | `consolidate/route.ts` |
| "…would overpay it" / "is void and cannot take a payment" | `lib/invoice.ts:217,229` |
| "That subscription is already cancelled/paused" | `lib/billing.ts:281,380` |
| "Only an active subscription can be changed/billed" | `lib/billing.ts:140` |
| "This is the last active super admin" | `users/[id]/route.ts:202` |
| manual-split validation failures | `plan/route.ts` |

Every one of these is the system working. The `lib/api.ts` header makes the
argument for 409 and then most callers do not take it.

**Fix:** mechanical — swap `Error` for `BusinessRuleError` at those sites.

## B5 — A zero-total invoice reads as paid · **CODE**

`lib/invoice.ts:268` — `WHEN paid.total >= i.amount_total THEN 'paid'`. With
`amount_total = 0` and no payments, `0 >= 0` is true.

## B6 — A GET writes · **CODE**

`app/api/portal/negotiation/[publicId]/messages/route.ts` opens a transaction
inside its GET to set `read_at`. Read-marking is reasonable; doing it in a GET
means any prefetch, retry or double-render marks messages read.

## B7 — `progress.invoiced` is wrong once partial invoicing exists · **CODE**

`app/api/orders/[id]/route.ts` — `invoiced: invoices.length > 0`. On the jury's
own 70-of-100 case the rail reads "Invoiced" after the first of two invoices.
`deriveOrderInvoiceStatus()` already computes the right answer and is imported
one directory away.

## B8 — The integrity endpoint ignores `variant_id` · **CODE**

`app/api/fulfilment/integrity/route.ts` compares `stock_level.qty_reserved`
against allocations grouped by `(warehouse_id, product_id)` only. Same blind
spot as B1 — the one screen that exists to prove the reservation path is sound
would not see a variant-level discrepancy. Clean today (0 rows).

## B9 — Two divergent paths post a seller message · **CODE**

`POST /api/negotiation/[id]/messages` and
`POST /api/quotations/[id]/negotiation` with `action: 'message'` both insert
`author_side = 'seller'`, with different rules: the second requires an **open**
request and refuses `accepted`/`rejected`; the first accepts anything but
`superseded`. Two answers to "may I reply to a closed negotiation?"

## B10 — Accepting a counter-offer can promote any state to `approved` · **CODE**

`app/api/quotations/[id]/negotiation/route.ts` — the accept branch sets
`state = 'approved'` whenever the rescored risk needs no signature, without
checking what the state was. A `draft` quotation with an open negotiation
becomes `approved` without ever being submitted.

---

# C · Optimisations

## C1 — 60 foreign keys have no supporting index · **VERIFIED** · biggest single win

Postgres does not index FK columns automatically. Every join in the fulfilment
and billing screens is a sequential scan today. Thirteen of the sixty are on
genuinely hot paths:

```sql
-- Additive only; fits db/seed/00-migrations.sql and the frozen-schema policy.
CREATE INDEX IF NOT EXISTS sales_order_line_order_idx      ON sales_order_line (order_id);
CREATE INDEX IF NOT EXISTS fulfillment_alloc_line_idx      ON fulfillment_allocation (order_line_id);
CREATE INDEX IF NOT EXISTS fulfillment_alloc_wh_idx        ON fulfillment_allocation (warehouse_id);
CREATE INDEX IF NOT EXISTS backorder_line_idx              ON backorder (order_line_id);
CREATE INDEX IF NOT EXISTS invoice_line_invoice_idx        ON invoice_line (invoice_id);
CREATE INDEX IF NOT EXISTS payment_invoice_idx             ON payment (invoice_id);
CREATE INDEX IF NOT EXISTS invoice_order_idx               ON invoice (order_id);
CREATE INDEX IF NOT EXISTS invoice_subscription_idx        ON invoice (subscription_id);
CREATE INDEX IF NOT EXISTS negotiation_request_quote_idx   ON negotiation_request (quotation_id);
CREATE INDEX IF NOT EXISTS subscription_src_line_idx       ON subscription (source_order_line_id);
CREATE INDEX IF NOT EXISTS credit_note_customer_idx        ON credit_note (customer_id);
CREATE INDEX IF NOT EXISTS credit_note_invoice_idx         ON credit_note (invoice_id);
CREATE INDEX IF NOT EXISTS proration_event_sub_idx         ON proration_event (subscription_id);
CREATE INDEX IF NOT EXISTS quotation_line_product_idx      ON quotation_line (product_id);
CREATE INDEX IF NOT EXISTS sales_order_customer_idx        ON sales_order (customer_id);
```

`payment (invoice_id)` matters most — the invoice **list** runs a
`LATERAL SUM(amount) FROM payment WHERE invoice_id = i.id` per row, and
`invoice_line (invoice_id)` and `sales_order_line (order_id)` are on nearly
every screen in the Deliver and Billing groups.

To re-derive the full list:

```sql
SELECT c.conrelid::regclass AS child, a.attname AS fk_column, c.confrelid::regclass AS parent
FROM pg_constraint c
JOIN LATERAL unnest(c.conkey) k(attnum) ON true
JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
WHERE c.contype = 'f' AND array_length(c.conkey,1) = 1
  AND NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.conrelid AND i.indkey[0] = k.attnum);
```

## C2 — `tx()` on read-only paths

`tx()` costs a pool checkout + `BEGIN` + `COMMIT` + release. It is used for
pure reads in several places:

- `app/api/orders/[id]/invoice/route.ts` — **GET** opens one transaction; **POST**
  opens **three** (`createDeliveryInvoice`, then `getInvoiceableLines` twice for
  the before/after payloads).
- `app/api/alerts/scan/route.ts` is correct (it writes).
- `app/api/fulfilment/[id]/route.ts` holds a transaction open across the whole
  N+1 loop below — deliberate (consistent stock snapshot), but it means the
  connection is held for the duration.

`lib/db.ts` sets `max: 10`. With `useLiveRefresh` polling every 20s across
several mounted panels, that ceiling is closer than it looks.

**Fix:** `getInvoiceableLines` already accepts `Pick<PoolClient,'query'>`-shaped
input in spirit — widen its type the way `isApproved` was widened
(`docs/API-AUDIT.md` §2 documents that exact refactor) and pass the pool.

## C3 — N+1 in `GET /api/fulfilment/[id]` · already documented

`docs/API-AUDIT.md` §3 owns this and the analysis is right: 2 + 2N queries,
plus up to N more `loadStockFor` calls for consolidation. The stated fix —
one stock query keyed by `product_id`, then plan each line against the map —
is correct. Worth doing now that C1 makes the underlying joins cheap.

## C4 — `SELECT count(*)` per document number

`lib/invoice.ts:36` runs `SELECT count(*) FROM invoice` on every invoice
creation. Sequential scan, O(n), on the write path. Replaced by a sequence
(B2) this becomes O(1) and the race disappears with it.

## C5 — Type safety is half-disabled

`tsconfig.json` sets `"strict": true` and then `"noImplicitAny": false`, which
turns off a large part of what strict buys. `eslint` reports **93
`no-explicit-any`** errors on top of that, and `lib/db.ts:50,56` type `q<T = any>`
so every query result is `any` unless a call site annotates it.

```
  93  @typescript-eslint/no-explicit-any
  20  react-hooks/refs
  18  react-hooks/set-state-in-effect
  10  @typescript-eslint/no-unused-vars
```

None block `next build`. The `set-state-in-effect` cluster is the one with a
runtime cost — cascading renders on `theme-toggle.tsx:13`,
`components/negotiation/thread.tsx:87` and sixteen others.

## C6 — `SELECT *` after write, seven places

`docs/API-AUDIT.md` accepts this. Agreed at this size — `RETURNING *` saves a
round trip and is a mechanical change whenever the polish pass runs.

## C7 — No pagination on twenty list endpoints

Already documented and correctly scoped out. Keep it in the roadmap note.

## C8 — `.env.example` is missing two variables the app reads

`ADMIN_RESET_TOKEN` and `SUPPLIER_GSTIN` are read at runtime but absent from
`.env.example`. Consequences on a fresh clone:

- `POST /api/admin/reset` returns **503** — the Danger Zone on `/settings`
  fails closed, which is correct behaviour and a surprising demo.
- Invoice posting falls back to the hardcoded GSTIN
  `27AABCD1234E1ZP` (`invoices/[id]/post/route.ts`), so the IRN is computed
  against a placeholder supplier.

`.env.local` is correctly git-ignored — that is fine.

---

# What is genuinely strong

Worth knowing what **not** to touch, and what to lead with:

- **Version-keyed approvals (Law 1).** `IS_APPROVED_SQL` as one exported
  expression with no `is_approved` column anywhere is the right design and the
  orphaning banner on screen 4 demonstrates it well.
- **`lib/allocate.ts`.** Pure, tested, exhaustive-with-fallback, and it exposes
  its own search trace plus the greedy comparison it beats. This is the
  strongest single file in the repo.
- **The product↔product many-to-many (jury ask 2).** Real junction table with
  both FKs to `product(id)`, `UNIQUE(trigger, suggested)`, a self-reference
  CHECK, 19 seeded phone→accessory edges, and `products/[id]` reads it in
  **both** directions. Answers the ask exactly as posed.
- **`lib/credit.ts`'s exposure definition** — including the uninvoiced
  commitment term most implementations omit. The bug in A11 is one clause, not
  the design.
- **The reservation concurrency story.** Ordered `FOR UPDATE` + the
  `cannot_reserve_more_than_held` CHECK + a live `/api/fulfilment/integrity`
  endpoint that proves it. Currently clean: 0 oversold, 0 stranded.
- **`db/seed/00-migrations.sql`.** The reasoning in it is better than most
  production migration files.

---

# Suggested order of work

Two hours, highest value first:

1. **A1** — wire `POST /api/orders` to the Confirm button, and add the button
   for auto-approved quotations. Without this the demo has no pipeline.
2. **A4** — one-word change, `createOrderInvoice` → `createDeliveryInvoice` in
   the ship route. Makes ask 6 happen where the jury would expect it.
3. **C1** — paste the index block into `db/seed/00-migrations.sql`.
4. **B3** — one line, and it is the one bug the codebase's own comments
   forbid three times.
5. **A6** — `payment_terms_days` into both invoice builders.
6. **A3** — apply the pricelist in the line INSERT.
7. **B4** — swap the throws for `BusinessRuleError`.
8. **A2** — invoice tax. Largest, and the one a finance-literate judge finds
   fastest by adding up two numbers on screen.

A9 (session revocation) and A10 (public signup) are the two to raise with the
team explicitly — they are small changes, but they change what the RBAC story
means, and the jury asked about exactly that.
