-- OWNER: D2.  CLAIMED — new file.  ADDITIVE DDL ONLY, and idempotent.
--
-- ── WHY A DDL FILE LIVES IN db/seed/ ─────────────────────────────────
-- db/schema.sql is frozen: "after T+3, additive migrations only."  But
-- db/reset.sh runs schema.sql and db/seed/*.sql — it does NOT run
-- db/migrations/.  So a column added only under db/migrations/ silently
-- disappears the next time anybody resets, and the person who reset finds
-- out when a route 500s instead of when the file was written.  That is a
-- real process gap, not a style preference.
--
-- This file closes it without editing one frozen byte.  reset.sh globs
-- db/seed/*.sql in filename order, so 00- lands after schema.sql and before
-- 01-identity.sql: the tables exist, no rows do yet, and every statement
-- below is IF NOT EXISTS, so running it against a live database that
-- already took the same change through db/migrations/ is a no-op.
--
-- Every migration file under db/migrations/ has a twin here.  If you add one
-- there, add it here too, or it does not survive a reset.

-- ═════════════════════════════════════════════════════════════════════
-- 1 · ROLES — jury review 2, asks 3, 4 and 7
-- ═════════════════════════════════════════════════════════════════════
-- Postgres allows ALTER TYPE ... ADD VALUE inside a transaction since 12,
-- but the new label still cannot be USED in that same transaction.  Nothing
-- below references either label, and the seeds that do run in later files,
-- so this is safe — but do not "tidy" it by merging it into a BEGIN block
-- with an INSERT that uses 'viewer'.
--
-- 'viewer'      — genuinely read-only.  No existing role was: sales_rep
--                 writes quotations, and every other internal role has some
--                 write surface.  Because EVERY route in this app is an
--                 allow-list (withAuth(['finance','admin'], …)), a new label
--                 starts with zero permissions by construction — there is no
--                 deny-list to audit.
-- 'super_admin' — see section 4 and app/api/admin/reset.  It is NOT "admin
--                 with more toys": it is the only role that may destroy data.
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'viewer';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'super_admin';

-- ═════════════════════════════════════════════════════════════════════
-- 2 · NEGOTIATION AS A CONVERSATION — jury review 2, ask 1
-- ═════════════════════════════════════════════════════════════════════
-- negotiation_comment already existed with (comment, created_at) and no
-- author.  A thread whose messages have no author is not a chat — you cannot
-- render a left/right bubble, you cannot say who conceded, and the audit
-- question "who agreed to 22%?" has no answer in the data.  That was the
-- actual gap behind "we want a chat interface", not the CSS.
ALTER TABLE negotiation_comment
  ADD COLUMN IF NOT EXISTS author_user_id bigint REFERENCES app_user(id) ON DELETE RESTRICT;

-- Who the message is FROM, denormalised deliberately.  author_user_id gives
-- the person; this gives the SIDE, and the two are not the same question.
-- A rep answering on behalf of the company and a buyer are both app_user
-- rows; only this column says which bubble the message belongs in, and it
-- keeps rendering correct even if a user's role changes later (asks 7) —
-- which is exactly the bug that a JOIN to app_user.role would introduce.
ALTER TABLE negotiation_comment
  ADD COLUMN IF NOT EXISTS author_side text
    CHECK (author_side IN ('seller','buyer'));

-- An internal note is visible to staff and never to the customer.  Odoo
-- draws the same line (mail.message log-note vs message); without it, reps
-- have nowhere to write "floor is 18%, do not go below" and will put it in
-- a customer-visible field.
ALTER TABLE negotiation_comment
  ADD COLUMN IF NOT EXISTS is_internal boolean NOT NULL DEFAULT false;

ALTER TABLE negotiation_comment
  ADD COLUMN IF NOT EXISTS read_at timestamptz;

CREATE INDEX IF NOT EXISTS negotiation_comment_thread_idx
  ON negotiation_comment (negotiation_request_id, created_at);

-- ═════════════════════════════════════════════════════════════════════
-- 3 · PARTIAL INVOICING — jury review 2, ask 6
-- ═════════════════════════════════════════════════════════════════════
-- "The shop has 70 laptops but the order is for 100.  Invoice the 70, then
-- invoice the 30 when stock returns."
--
-- Odoo models this as invoice_policy='delivery' with qty_delivered and
-- qty_invoiced per order line, and an invoice_status computed from the gap
-- between them.  We already have qty_delivered implicitly — it is
-- SUM(fulfillment_allocation.qty) WHERE status='shipped' — so the only
-- genuinely missing fact is how much of each line has been BILLED.
--
-- It has to live on the line, not the order: a 3-line order can be 100%
-- shipped on line 1, 70% on line 2 and 0% on line 3, and an order-level
-- counter cannot express that.
ALTER TABLE sales_order_line
  ADD COLUMN IF NOT EXISTS qty_invoiced numeric(12,3) NOT NULL DEFAULT 0
    CHECK (qty_invoiced >= 0);

-- The invariant that makes double-billing impossible at the DATABASE, not in
-- a handler someone might forget to call.  You cannot invoice more than was
-- ordered.  (Not more than was SHIPPED — that one is dynamic, so it is
-- enforced in lib/invoice.ts where the shipped quantity can be read.)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cannot_invoice_more_than_ordered') THEN
    ALTER TABLE sales_order_line
      ADD CONSTRAINT cannot_invoice_more_than_ordered CHECK (qty_invoiced <= qty);
  END IF;
END $$;

-- Which order line an invoice line billed, and how much of it.  Without this
-- FK an invoice is a number with a story attached; with it, every rupee on
-- every invoice traces to a specific line of a specific order, and the
-- "invoice the remaining 30" query is a subtraction rather than a guess.
ALTER TABLE invoice_line
  ADD COLUMN IF NOT EXISTS order_line_id bigint REFERENCES sales_order_line(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS invoice_line_order_line_idx
  ON invoice_line (order_line_id);

-- Distinguishes the 70-unit invoice from the 30-unit one that closes it out.
-- 'final' is set when this invoice takes the order to fully-invoiced, so a
-- judge reading the invoice list can see the sequence, not infer it.
ALTER TABLE invoice
  ADD COLUMN IF NOT EXISTS is_partial boolean NOT NULL DEFAULT false;

ALTER TABLE invoice
  ADD COLUMN IF NOT EXISTS sequence_no smallint NOT NULL DEFAULT 1;

-- ═════════════════════════════════════════════════════════════════════
-- 4 · USER LIFECYCLE + DESTRUCTIVE-ACTION AUDIT — asks 3, 4, 7
-- ═════════════════════════════════════════════════════════════════════
-- Who created this account, and who last changed its role.  A promotion that
-- leaves no trace is indistinguishable from a privilege-escalation attack,
-- and "who made this person an admin?" is the first question asked after one.
ALTER TABLE app_user
  ADD COLUMN IF NOT EXISTS created_by_user_id bigint REFERENCES app_user(id) ON DELETE SET NULL;

ALTER TABLE app_user
  ADD COLUMN IF NOT EXISTS role_changed_at timestamptz;

ALTER TABLE app_user
  ADD COLUMN IF NOT EXISTS role_changed_by_user_id bigint REFERENCES app_user(id) ON DELETE SET NULL;

-- audit_log is wiped by a database reset along with everything else, which
-- makes it the wrong place to record that the reset happened.  This table is
-- deliberately NOT dropped by app/api/admin/reset — it is the one thing that
-- survives, so "who wiped the demo data twenty minutes before judging, and
-- when?" always has an answer.
CREATE TABLE IF NOT EXISTS destructive_action_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  action text NOT NULL,
  actor_email text NOT NULL,
  actor_user_id bigint,
  detail text,
  row_counts jsonb,
  performed_at timestamptz NOT NULL DEFAULT now()
);

-- ── 3b · INVOICING POLICY, PER PRODUCT ───────────────────────────────
-- Odoo puts invoice_policy on product.template with exactly two values:
-- 'order' (invoice what was ordered, bill on confirmation) and 'delivery'
-- (invoice what was delivered).  We need the same split for a reason that is
-- easy to miss and breaks the feature silently:
--
--   A delivery-billed line is invoiceable up to what SHIPPED.  But a service
--   line — onsite setup, an extended warranty — never ships, has no
--   fulfillment_allocation row, and would therefore compute qty_shipped = 0
--   forever.  Bill services on delivery and they can never be invoiced at
--   all, and nothing errors: the line just quietly never appears.
--
-- So hardware defaults to 'delivery' (the jury's 70-of-100 case) and services
-- and subscriptions are set to 'order' below.
ALTER TABLE product
  ADD COLUMN IF NOT EXISTS invoice_policy text NOT NULL DEFAULT 'delivery'
    CHECK (invoice_policy IN ('order','delivery'));

-- Services and subscriptions bill on order, not on shipment.  Written as an
-- UPDATE keyed on category rather than a per-SKU list so it stays correct
-- when 07-mobility.sql (or anyone else) adds products later.
UPDATE product SET invoice_policy = 'order'
 WHERE invoice_policy <> 'order'
   AND (is_subscription
        OR category_id IN (SELECT id FROM product_category WHERE code IN ('services','subscription')));
