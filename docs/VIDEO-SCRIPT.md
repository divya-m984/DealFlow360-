# DealFlow360 — Workflow Demonstration Video Script

**Format:** screen recording + voice-over · **Target length: 7:00** (cut markers included to reach 5:00)
**Recorded as:** one continuous workflow — one deal, from a rep opening a blank quotation to the
customer's second invoice being paid — with the six jury-review-2 answers appearing *inside* that
flow rather than as a feature tour.

Everything below is stated the way it actually behaves in the code as of this commit. The
**⚠ RECORDING NOTES** are the places where the demo can bite you; read all of them before you hit
record.

---

## 0 · Pre-flight (do this before recording, not on camera)

```bash
docker compose up -d          # postgres 17 on 5432
./db/reset.sh                 # schema + all seed files, in filename order
npm run dev                   # next dev on :3000
```

Then, in the browser, before recording:

- Log in once as `rep@dealflow.app` / `demo1234` so the session cookie is warm.
- Open every screen you are going to visit once, so nothing compiles on camera
  (`next dev` compiles routes lazily — the first hit on `/fulfilment/[id]` is a two-second stall).
- Zoom the browser to **125%**. The money columns and the risk badges are the things a judge
  squints at.
- Close the terminal, or keep it in a second workspace. You need it for exactly one step (§5).

**Accounts — all password `demo1234`:**

| Email | Role | Used in |
|---|---|---|
| `rep@dealflow.app` | sales_rep (A. Rao, West) | §1–§5 |
| `manager@dealflow.app` | sales_manager (M. Shah) | §3 |
| `finance@dealflow.app` | finance (S. Iyer) | §3, §6–§7 |
| `buyer@acme.example` | portal (R. Menon, Acme Corp) | §4 |
| `admin@dealflow.app` | admin | §8 |
| `root@dealflow.app` | super_admin (Priya Nair) | §8 |
| `viewer@dealflow.app` | viewer (read-only auditor) | §8, optional |

---

## 1 · Cold open — the problem, over the dashboard (0:00 – 0:25)

**On screen:** `/` — the dashboard, already logged in as the rep.

> "A B2B distributor loses margin in three places, and none of them are the sale itself. A rep
> discounts past what the deal can carry. An approval sits in an inbox for four days. An order for a
> hundred units gets held hostage because only seventy are on the shelf.
>
> DealFlow360 is a sales-operations platform where each of those three is a rule the database
> enforces, not a habit the team is asked to keep. I'm going to run one deal end to end — quotation,
> approval, customer negotiation, order, a split shipment, two invoices, and payment — and stop on
> the places where the system refuses to do what I'm asking."

*Cut for 5:00: trim to the first sentence and the last.*

---

## 2 · The quotation, and the ceiling that is computed, not typed (0:25 – 1:40)

**On screen:** `/quotations` → **New Quotation** → customer **Acme Corp**.

1. Point at the tier badge. *"Acme is Gold — a fifteen per cent discount ceiling."*
2. Add a line: **Galaxy A56** (`PH-A56`, Mobility category), qty 10.
3. Set discount **6%**. Risk band reads **LOW**. Margin recalculates in the row.
4. Now set discount **12%** — under Acme's Gold ceiling of 15%, and *still refused/flagged*.

> **This is the sentence to land:** *"Twelve per cent is inside the customer's fifteen. But this is
> a phone, and the Mobility category caps at eight. The effective ceiling is `LEAST(tier, category)`
> — computed per line, in SQL, at the moment the line is written. The rep cannot discover this rule
> by asking; it's just what the row is allowed to be."*

5. Open the **Upsell and cross-sell suggestions** block below the lines. It offers the case, the
   power bank, the charger — and it offers them because of a margin threshold, not a hunch.

**⚠ RECORDING NOTES for this section**
- **Do not open a product page and then quote that product on camera.** `/products/[id]` shows an
  `effective_price` derived from the tier pricelist; `POST /api/quotations/[id]/lines` prices from
  `product.base_price` and does not apply the pricelist. The two numbers disagree. Quote from the
  quotation screen only, and if a judge asks about pricelists, say plainly: *"modelled and seeded,
  applied at the product level, not yet applied in the line builder."*
- Same rule for tax: the quotation computes `tax_total` into `grand_total`, but the **invoice tables
  carry no tax column**. Say totals are "net of tax at invoice stage" and do not put a quotation
  grand total next to an invoice total in the same shot.

---

## 3 · Jury ask 2 — the many-to-many, with the keys visible (1:40 – 2:15)

**On screen:** the **Bought alongside & instead** panel (`components/fulfilment/related-products.tsx`).

> "The jury asked to see a real many-to-many: a phone carrying a relation to the things bought
> alongside it, with the accessory's primary key appearing as a foreign key against the phone.
>
> That's this table — `upsell_rule`. `trigger_product_id` and `suggested_product_id` are both
> foreign keys into `product(id)`. The pair is `UNIQUE`, so the pair is the real key. A `CHECK`
> forbids a product from suggesting itself.
>
> The design we did *not* choose was `accessory_1_id`, `accessory_2_id`, `accessory_3_id` — three
> nullable columns and a hard ceiling of three accessories. A junction table has no ceiling, and it
> can carry attributes of the *relationship* — which is where `kind` and `min_margin_pct` live. The
> rule only fires if the suggested product's own margin clears the threshold, so cross-sell can
> never be used to bury a bad-margin item."

*Cut for 5:00: keep the first paragraph and the `UNIQUE`/`CHECK` sentence; drop the alternative-design paragraph.*

---

## 4 · The deliberate rejection, and the approval chain (2:15 – 3:15)

1. Push the discount to **28%**. Risk spikes to **HIGH**.
2. The screen names the chain it now needs: **Sales Manager → Finance**.
3. **Try to confirm anyway.** The action is refused, and the message names the approval that is
   missing. *"That refusal is server-side, in the route, inside the transaction. The button being
   hidden is a courtesy; the route is the control."*
4. Submit for approval with the note *"Strategic client — competitive defence."*
5. Open **Audit trail** on the same screen: the row is already there, with actor and timestamp.

**Then the version point — this is the strongest thirty seconds in the demo:**

6. Switch to `manager@dealflow.app`, approve in the **Approvals** inbox with a note.
7. Switch back to the rep and **edit a line** — change the discount by a point.
8. Return to Approvals: the approval is **stale**. `approval_request` is keyed on
   `quotation.version`, and a commercial edit bumps the version.

> "The manager approved a document. Not a deal, not a customer — a specific version of a specific
> document. Change the terms and that signature no longer refers to anything, so the chain restarts.
> That's an integrity property of the key, not a rule someone remembered to write."

9. Re-approve as manager, then as `finance@dealflow.app`. State moves to **approved**.

---

## 5 · Jury ask 1 — the buyer negotiates, in a thread (3:15 – 4:00)

**On screen:** open the portal in a **second browser profile** (so both sessions stay live),
`/portal/[publicId]`.

> "The customer never sees an integer id. The portal is keyed on a UUID, so there is no adjacent
> quotation to guess at by adding one."

1. As the buyer, open the quotation, read the lines, and **send a message**: *"Can you do 24% if we
   take the power bank too?"*
2. Switch to the rep window. The **Messages** inbox (`/messages`) shows the thread as
   **awaiting us**, with how long it has waited.
3. Open it — the thread lives on the quotation, next to the lines it is arguing about.
4. Reply, and settle.

> "Each message stores its author *side* on the row, not derived from the author's current role.
> That matters because roles are mutable in this system — promote the rep who ran this negotiation
> and the history must still say the buyer conceded, not the manager. Denormalising the side is what
> keeps the transcript true after the org chart changes."

5. Buyer confirms. `quotation.state = 'confirmed'`.

---

## 6 · Jury ask 5 — conversion, and what it does to both tables (4:00 – 4:45)

**⚠ RECORDING NOTE — THE ONE PLACE THE UI CANNOT DO IT.**
Confirm and order-creation are two endpoints, and **only the first is wired to a button**.
`POST /api/orders` has no caller in `app/` or `components/`. You have two choices; pick one before
recording:

- **(a) Fix it first (one file, ~10 lines):** chain `POST /api/orders { quotationId }` onto the
  Confirm handler in `app/(app)/quotations/[id]/page.tsx`, and render a **Create Order** action for
  any `confirmed` quotation with no `sales_order` row. This is the better demo and closes audit
  finding A1.
- **(b) Record it as a curl,** on camera, and own it:

```bash
curl -X POST localhost:3000/api/orders \
  -H 'content-type: application/json' -b cookies.txt \
  -d '{"quotationId": <ID>}'
```
> *"Confirmation and order creation are deliberately two decisions, so they're two endpoints —
> here's the second one."*

Then open the quotation's **Document lineage** panel and answer the question directly:

> "The jury asked: when a quotation becomes a sales bill, does the quotation table *lose* a value
> and gain something new? No. It loses nothing.
>
> Confirming touches three columns on `quotation` — `state`, `confirmed_at`, `last_activity_at`.
> No delete, no write to `quotation_line`, and the version does not move, because the terms didn't
> change, only their status.
>
> Creating the order only **inserts**. A new `sales_order` row carrying `quotation_id`; one
> `sales_order_line` per quotation line, each carrying `quotation_line_id`. The quotation is read,
> never modified.
>
> It's a copy, not a move, because the two rows record different facts with different lifetimes. A
> quotation line records what was *negotiated* — the discount, the ceiling it was measured against,
> the margin the approvers signed. An order line records what is being *delivered*, and it changes
> every time we ship or bill. Move the row and the first partial shipment starts overwriting the
> commercial history somebody approved.
>
> And it isn't a convention we politely follow. `sales_order.quotation_id` is `UNIQUE`, so one
> quotation can never become two orders — double-click Confirm and the second insert fails. It's
> `ON DELETE RESTRICT`, so a quotation that has become an order physically cannot be deleted. That
> is the strongest form of *the quotation loses nothing*: the database refuses."

The panel shows the real primary keys on both sides, each order line pointing back at the quotation
line it came from. Point at them while you say it.

---

## 7 · Jury ask 6 — 70 of 100, shipped and invoiced twice (4:45 – 6:00)

This is the section worth the most screen time. Use the order for **100 laptops against 70 in
stock**.

**On screen:** `/fulfilment/[id]`.

1. **Warehouse split** — the plan is computed live from `qty_on_hand − qty_reserved`, per warehouse.
   Nothing in `db/seed/` precomputes it. The reason string under the split is written by
   `lib/allocate.ts` itself, so the explanation can't drift from the decision.
2. Allocated **70**, backordered **30**, order state **backorder**.
3. **Ship the 70.** Stock moves.
4. Open the **Billing** tab. Every line shows four numbers — *ordered, shipped, invoiced, billable
   now* — and when nothing can be billed, the reason.
5. Raise the invoice: **seq 1, `is_partial = TRUE`, 70 units.**

> "The interesting part isn't the button, it's the arithmetic. `sales_order_line.qty_invoiced`
> carries `CHECK (qty_invoiced <= qty)`. Double-billing a unit is not a bug we test for; it is a
> write Postgres rejects."

6. **Restock**, **consolidate**, ship the remaining **30**.
7. Second invoice: **seq 2, `is_partial = FALSE`, 30 units.**
8. `qty_invoiced` **100 / 100**, zero open backorders, order state **fulfilled**. The original
   quotation still reads exactly as approved.

**⚠ RECORDING NOTE:** shipping does **not** raise the delivery invoice by itself — the ship route
calls `createOrderInvoice`, which filters to order-policy lines that were already invoiced at
confirmation, so it returns null and writes *"nothing new to invoice"* to the audit log. Raise the
invoice from the **Billing** tab, as scripted above. Don't say "shipping bills the customer."

9. **Post** the invoice (IRN + document state), record a **payment**, and show the receivable clear
   in `/credit`.

---

## 8 · Asks 3, 4 and 7 — user lifecycle, roles, and the destroy button (6:00 – 6:40)

**On screen:** `/settings`, as `admin@dealflow.app`.

1. **Config is data.** Change the Silver tier ceiling from 10% to 3%, save, re-submit a quotation —
   routing changes. No deploy, no restart. Every policy edit writes an `audit_log` row.
2. **Users & roles** — create a finance user, and promote the junior rep.
   > "Two rules the server enforces, not the screen: you cannot create or grant a role at or above
   > your own rank — otherwise an admin mints a super-admin and logs into it, and the distinction is
   > decorative. And a portal user must be tied to a customer while an internal user must not be;
   > the schema already had that `CHECK`, this route turns error 23514 into a sentence."
3. **Switch to `root@dealflow.app`** — super_admin — and show the **Danger zone**.
   > "Odoo's database manager can drop and restore whole databases, and it's protected by
   > `admin_passwd` — a master password that lives in `odoo.conf` and never in a database row. Their
   > own deployment docs then say: disable it in production.
   >
   > We took both lessons. The credential that authorises destruction is an **environment
   > variable**, not a role column — because a role is granted by a row, and anyone who can write
   > rows could grant it to themselves. If the variable is unset the endpoint refuses: it fails
   > closed. And dropping the whole schema isn't exposed over HTTP at all — that's `./db/reset.sh`
   > at a shell, gated by filesystem access. What the button does is the bounded thing you actually
   > want before a demo: clear the transactional data, keep the master data."

*Do not press it on camera unless you have re-seeded time.*

*Cut for 5:00: keep 1 and 3, drop 2 — or keep 2 and drop 1.*

---

## 9 · Close (6:40 – 7:00)

**On screen:** `/reports` — KPI tiles, then a PDF export.

> "Reports are live over the same tables — pipeline, won revenue, average discount, gross margin —
> and export to PDF and CSV with no external dependency.
>
> The whole thing runs offline: Next.js and React on the front, raw `pg` against a local Postgres 17
> in Docker, every business rule enforced server-side inside a transaction, and an append-only audit
> log on every mutation. Thank you."

---

## Appendix A · Things to say only if asked

| If a judge asks | The honest answer |
|---|---|
| "Do invoices carry GST?" | "The quotation computes tax into the grand total. The invoice tables don't carry a tax column yet — invoices bill the net amount. It's an additive migration plus carrying `tax_pct` through the order line; the CGST/SGST/IGST split is a second, larger piece and we'd rather name it than half-build it." |
| "Does the tier pricelist change the price?" | "Pricelists are modelled, seeded and shown on the product screen. The quotation line builder still prices from `base_price` — the pricelist resolution isn't wired into that insert yet." |
| "Why two endpoints for confirm and order?" | Two decisions with different authority: agreeing to terms, and committing stock and credit. `POST /api/orders` re-checks credit and refuses anything not `confirmed`. |
| "Concurrency?" | Allocation runs inside a transaction against `stock_level`; there's a concurrency probe component under `components/fulfilment/`. |
| Deep backend internals | Hand off to the owner of that lane by name. Judges reward it. |

## Appendix B · Shot list

| # | Screen | Must be visible in frame |
|---|---|---|
| 1 | `/` dashboard | — |
| 2 | quotation detail | tier badge, discount %, **Limit** column, risk badge |
| 3 | Bought alongside & instead | both product names |
| 4 | quotation detail | refusal message, approval chain, Audit trail |
| 5 | `/approvals` (manager, then finance) | stale-after-edit state |
| 6 | `/portal/[publicId]` + `/messages` | the UUID in the address bar |
| 7 | Document lineage panel | the primary keys on both sides |
| 8 | `/fulfilment/[id]` | Warehouse split + reason, Billing tab's four numbers |
| 9 | `/settings` | tier ceiling field, Users & roles, Danger zone |
| 10 | `/reports` | KPI tiles, export |
