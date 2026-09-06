# Quotation → Sales Order → Invoice: what happens to each table

*Answers jury review 2, ask 5: "When a quotation is updated to a sales bill, how
does it affect both tables? Will the quotation table lose a value and add
something new?"*

**Short answer: the quotation loses nothing.** No row is deleted, no line is
moved, no column is emptied. The order is a new row in a different table that
points back at the quotation. Both documents exist afterwards, and both stay
readable.

You can see this in the product: open any confirmed quotation and read the
**Document lineage** panel, which renders the real primary keys on both sides.

---

## The two writes, exactly

Conversion is deliberately two steps, because they are two different decisions.

### Step 1 — `POST /api/quotations/:id/confirm`

Touches **three columns** on `quotation`, and nothing else anywhere:

```sql
UPDATE quotation
   SET state = 'confirmed', confirmed_at = now(), last_activity_at = now()
 WHERE id = $1;
```

No `DELETE`. No write to `quotation_line`. The version does not move — the
terms have not changed, only their status.

### Step 2 — `POST /api/orders { quotationId }`

**Inserts** new rows. It reads the quotation; it never modifies it.

| Table | What happens |
|---|---|
| `quotation` | untouched by this step |
| `quotation_line` | untouched — every line stays exactly as approved |
| `sales_order` | **1 new row**, carrying `quotation_id` |
| `sales_order_line` | **1 new row per quotation line**, each carrying `quotation_line_id` |
| `fulfillment_allocation` | new rows — the warehouse split |
| `backorder` | a new row per line that stock could not cover |
| `invoice` / `invoice_line` | new rows, if the line's policy invoices on order |

---

## Why it is a copy and not a move

The two line tables record **different facts with different lifetimes**.

A `quotation_line` records what was **negotiated**: the discount, the ceiling it
was measured against, the margin at the moment of agreement. That is what the
approval chain signed, and it must stay legible forever — an approval belongs to
a version, and the version has to still mean something a month later.

A `sales_order_line` records what is being **delivered**. It accumulates
allocations, backorders and `qty_invoiced` as the order progresses.

Moving the row would force one table to mean both things, and the first partial
shipment would begin overwriting the commercial history the approvers signed
off on. Copying costs one extra row and keeps the two records honest.

---

## The guarantee lives in the schema

These are not conventions the application politely follows. They are constraints
Postgres enforces underneath any code we could get wrong:

```sql
sales_order.quotation_id            UNIQUE
sales_order.quotation_id            REFERENCES quotation(id)      ON DELETE RESTRICT
sales_order_line.quotation_line_id  REFERENCES quotation_line(id) ON DELETE RESTRICT
```

* **`UNIQUE`** — one quotation can never become two orders. Double-clicking
  "Confirm" cannot produce a duplicate order; the second insert fails.
* **`ON DELETE RESTRICT`** — a quotation that has become an order **cannot be
  deleted**. This is the strongest form of "the quotation does not lose
  anything": the database physically refuses.

Check it yourself:

```
\d sales_order
\d sales_order_line
```

---

## And onward to the invoice

The same shape repeats. `invoice.order_id` references the order;
`invoice_line.order_line_id` references the order line. An order may raise
**several** invoices — see `docs/API-AUDIT.md` and the partial-fulfilment flow —
and `sales_order_line.qty_invoiced` carries a CHECK that it can never exceed
`qty`, so double-billing is impossible at the database level rather than the
route level.

Worked example, verified end to end against a running instance:

```
order 100 laptops, 70 in stock
  → allocated 70, backordered 30, state = backorder
  → ship 70  → INV-…-0010  seq 1  is_partial = TRUE   70 units
  → restock, consolidate, ship 30
             → INV-…-0011  seq 2  is_partial = FALSE  30 units
  → qty_invoiced 100/100, 0 open backorders, state = fulfilled
```

Throughout, the original quotation still reads exactly as it was approved.
