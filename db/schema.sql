-- DealFlow360 — schema
-- OWNER: Member 1.  FROZEN AT T+3.  After that: additive migrations only.
-- Run:  psql "$DATABASE_URL" -f db/schema.sql
BEGIN;

DROP SCHEMA public CASCADE;
CREATE SCHEMA public;

-- ─────────────────────────── ENUMS ───────────────────────────
CREATE TYPE user_role       AS ENUM ('sales_rep','sales_manager','finance','admin','portal');
CREATE TYPE quotation_state AS ENUM ('draft','pending_approval','approved','negotiation',
                                     'confirmed','rejected','cancelled','expired');
CREATE TYPE risk_band       AS ENUM ('LOW','MEDIUM','HIGH');
CREATE TYPE approval_level  AS ENUM ('sales_manager','finance');
CREATE TYPE approval_status AS ENUM ('pending','approved','returned','rejected');
CREATE TYPE line_type       AS ENUM ('one_time','recurring');
CREATE TYPE billing_cycle   AS ENUM ('weekly','monthly','quarterly','yearly');
CREATE TYPE sub_status      AS ENUM ('active','paused','cancelled');
CREATE TYPE invoice_status  AS ENUM ('unpaid','partial','paid','void');
CREATE TYPE order_state     AS ENUM ('confirmed','split_pending','partially_fulfilled',
                                     'fulfilled','backorder','cancelled');
CREATE TYPE alloc_status    AS ENUM ('planned','reserved','shipped','cancelled');
CREATE TYPE alert_type      AS ENUM ('stalled','discount_anomaly','delivery_slippage');
CREATE TYPE refund_policy   AS ENUM ('none','prorated','full');

-- ──────────────────── IDENTITY & CUSTOMERS ───────────────────
CREATE TABLE currency (
  code char(3) PRIMARY KEY,
  symbol text NOT NULL,
  name text NOT NULL,
  minor_unit smallint NOT NULL DEFAULT 2
);

CREATE TABLE fx_rate (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  from_code char(3) NOT NULL REFERENCES currency(code),
  to_code   char(3) NOT NULL REFERENCES currency(code),
  rate numeric(18,8) NOT NULL CHECK (rate > 0),
  as_of date NOT NULL,
  UNIQUE (from_code, to_code, as_of)
);

CREATE TABLE customer_tier (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  max_discount_pct numeric(5,2) NOT NULL CHECK (max_discount_pct BETWEEN 0 AND 100),
  sort_order smallint NOT NULL DEFAULT 0
);

CREATE TABLE customer (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  name text NOT NULL,
  tier_id bigint NOT NULL REFERENCES customer_tier(id) ON DELETE RESTRICT,
  currency_code char(3) NOT NULL REFERENCES currency(code),
  email text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app_user (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  full_name text NOT NULL,
  role user_role NOT NULL,
  customer_id bigint REFERENCES customer(id) ON DELETE RESTRICT,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT portal_user_has_customer
    CHECK ((role = 'portal') = (customer_id IS NOT NULL))
);

CREATE TABLE sales_team (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  manager_user_id bigint REFERENCES app_user(id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true
);
ALTER TABLE app_user ADD COLUMN team_id bigint REFERENCES sales_team(id) ON DELETE SET NULL;

-- ─────────────────────────── CATALOGUE ───────────────────────
CREATE TABLE product_category (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  max_discount_pct numeric(5,2) NOT NULL CHECK (max_discount_pct BETWEEN 0 AND 100)
);

CREATE TABLE product (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  sku text NOT NULL UNIQUE,
  name text NOT NULL,
  category_id bigint NOT NULL REFERENCES product_category(id) ON DELETE RESTRICT,
  base_price numeric(14,4) NOT NULL CHECK (base_price >= 0),
  cost       numeric(14,4) NOT NULL CHECK (cost >= 0),
  currency_code char(3) NOT NULL REFERENCES currency(code),
  unit text NOT NULL DEFAULT 'Each',
  tax_pct numeric(5,2) NOT NULL DEFAULT 0,
  description text,
  is_subscription boolean NOT NULL DEFAULT false,
  recurring_cycle billing_cycle,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recurring_iff_subscription
    CHECK (is_subscription = (recurring_cycle IS NOT NULL))
);

CREATE TABLE product_attribute (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id bigint NOT NULL REFERENCES product(id) ON DELETE CASCADE,
  name text NOT NULL,
  sort_order smallint NOT NULL DEFAULT 0,
  UNIQUE (product_id, name)
);

CREATE TABLE product_attribute_value (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  attribute_id bigint NOT NULL REFERENCES product_attribute(id) ON DELETE CASCADE,
  value text NOT NULL,
  extra_price numeric(14,4) NOT NULL DEFAULT 0,
  UNIQUE (attribute_id, value)
);

CREATE TABLE product_variant (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  product_id bigint NOT NULL REFERENCES product(id) ON DELETE CASCADE,
  sku text NOT NULL UNIQUE,
  extra_price numeric(14,4) NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE variant_option (
  variant_id bigint NOT NULL REFERENCES product_variant(id) ON DELETE CASCADE,
  attribute_value_id bigint NOT NULL REFERENCES product_attribute_value(id) ON DELETE RESTRICT,
  PRIMARY KEY (variant_id, attribute_value_id)
);

CREATE TABLE pricelist (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL,
  tier_id bigint REFERENCES customer_tier(id) ON DELETE RESTRICT,
  currency_code char(3) NOT NULL REFERENCES currency(code),
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE pricelist_item (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  pricelist_id bigint NOT NULL REFERENCES pricelist(id) ON DELETE CASCADE,
  product_id  bigint REFERENCES product(id) ON DELETE CASCADE,
  category_id bigint REFERENCES product_category(id) ON DELETE CASCADE,
  rule_type text NOT NULL CHECK (rule_type IN ('no_adjustment','discount_pct','fixed_price')),
  value numeric(14,4) NOT NULL DEFAULT 0,
  CONSTRAINT targets_product_or_category
    CHECK (num_nonnulls(product_id, category_id) = 1)
);

CREATE TABLE upsell_rule (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  trigger_product_id   bigint NOT NULL REFERENCES product(id) ON DELETE CASCADE,
  suggested_product_id bigint NOT NULL REFERENCES product(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('upsell','cross_sell')),
  is_promoted boolean NOT NULL DEFAULT false,
  promo_text text,
  min_margin_pct numeric(5,2),
  rank_score numeric(6,2) NOT NULL DEFAULT 0,
  UNIQUE (trigger_product_id, suggested_product_id),
  CONSTRAINT no_self_suggestion CHECK (trigger_product_id <> suggested_product_id)
);

-- ─────────────────── DISCOUNT GOVERNANCE ─────────────────────
CREATE TABLE approval_policy (
  band risk_band PRIMARY KEY,
  score_from numeric(6,2) NOT NULL,
  score_to   numeric(6,2) NOT NULL,
  requires_manager boolean NOT NULL,
  requires_finance boolean NOT NULL,
  CHECK (score_to >= score_from)
);

-- ───────────────────── SUBSCRIPTION PLANS ────────────────────
-- (declared before quotation_line, which references it)
CREATE TABLE subscription_plan (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL,
  cycle billing_cycle NOT NULL,
  price numeric(14,4) NOT NULL CHECK (price >= 0),
  currency_code char(3) NOT NULL REFERENCES currency(code),
  proration_enabled boolean NOT NULL DEFAULT true,
  cancellation_notice_days smallint NOT NULL DEFAULT 0 CHECK (cancellation_notice_days >= 0),
  cancellation_refund refund_policy NOT NULL DEFAULT 'prorated',
  is_active boolean NOT NULL DEFAULT true
);

-- ─────────────────────────── QUOTATION ───────────────────────
CREATE TABLE quotation (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  number text NOT NULL UNIQUE,
  customer_id bigint NOT NULL REFERENCES customer(id) ON DELETE RESTRICT,
  owner_user_id bigint NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  pricelist_id bigint REFERENCES pricelist(id) ON DELETE RESTRICT,
  currency_code char(3) NOT NULL REFERENCES currency(code),
  state quotation_state NOT NULL DEFAULT 'draft',
  subtotal       numeric(14,2) NOT NULL DEFAULT 0,
  discount_total numeric(14,2) NOT NULL DEFAULT 0,
  tax_total      numeric(14,2) NOT NULL DEFAULT 0,
  grand_total    numeric(14,2) NOT NULL DEFAULT 0,
  margin_total   numeric(14,2) NOT NULL DEFAULT 0,
  risk_score numeric(6,2) NOT NULL DEFAULT 0,
  risk_band  risk_band    NOT NULL DEFAULT 'LOW',
  requires_manager boolean NOT NULL DEFAULT false,
  requires_finance boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  approved_at  timestamptz,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE quotation_line (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  quotation_id bigint NOT NULL REFERENCES quotation(id) ON DELETE CASCADE,
  line_no smallint NOT NULL,
  product_id bigint NOT NULL REFERENCES product(id) ON DELETE RESTRICT,
  variant_id bigint REFERENCES product_variant(id) ON DELETE RESTRICT,
  line_type line_type NOT NULL DEFAULT 'one_time',
  subscription_plan_id bigint REFERENCES subscription_plan(id) ON DELETE RESTRICT,
  qty numeric(12,3) NOT NULL CHECK (qty > 0),
  unit_price numeric(14,4) NOT NULL CHECK (unit_price >= 0),
  unit_cost  numeric(14,4) NOT NULL CHECK (unit_cost  >= 0),
  discount_pct numeric(5,2) NOT NULL DEFAULT 0 CHECK (discount_pct BETWEEN 0 AND 100),
  ceiling_pct  numeric(5,2) NOT NULL CHECK (ceiling_pct BETWEEN 0 AND 100),
  tax_pct numeric(5,2) NOT NULL DEFAULT 0,
  over_by_pct numeric(5,2)
    GENERATED ALWAYS AS (GREATEST(0::numeric, discount_pct - ceiling_pct)) STORED,
  net_amount numeric(14,2)
    GENERATED ALWAYS AS (round(qty * unit_price * (1 - discount_pct / 100.0), 2)) STORED,
  margin_amount numeric(14,2)
    GENERATED ALWAYS AS (round(qty * (unit_price * (1 - discount_pct / 100.0) - unit_cost), 2)) STORED,
  UNIQUE (quotation_id, line_no),
  CONSTRAINT recurring_needs_plan
    CHECK ((line_type = 'recurring') = (subscription_plan_id IS NOT NULL))
);

CREATE TABLE approval_request (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  quotation_id bigint NOT NULL REFERENCES quotation(id) ON DELETE CASCADE,
  quotation_version integer NOT NULL,
  level approval_level NOT NULL,
  seq smallint NOT NULL,
  status approval_status NOT NULL DEFAULT 'pending',
  assigned_to_user_id bigint REFERENCES app_user(id),
  acted_by_user_id    bigint REFERENCES app_user(id),
  acted_at timestamptz,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (quotation_id, quotation_version, level),
  CONSTRAINT acted_rows_are_complete
    CHECK ((status = 'pending') = (acted_at IS NULL))
);

CREATE TABLE audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity_type text NOT NULL,
  entity_id bigint NOT NULL,
  action text NOT NULL,
  actor_user_id bigint REFERENCES app_user(id),
  note text,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE negotiation_request (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  quotation_id bigint NOT NULL REFERENCES quotation(id) ON DELETE CASCADE,
  created_by_user_id bigint NOT NULL REFERENCES app_user(id),
  counter_discount_pct numeric(5,2) CHECK (counter_discount_pct BETWEEN 0 AND 100),
  requested_delivery_date date,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','accepted','rejected','superseded')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE negotiation_comment (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  negotiation_request_id bigint NOT NULL REFERENCES negotiation_request(id) ON DELETE CASCADE,
  quotation_line_id bigint REFERENCES quotation_line(id) ON DELETE CASCADE,
  comment text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ───────────────── WAREHOUSES, ORDERS, FULFILMENT ────────────
CREATE TABLE warehouse (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  shipping_cost_weight numeric(10,4) NOT NULL DEFAULT 1,
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE stock_level (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  warehouse_id bigint NOT NULL REFERENCES warehouse(id) ON DELETE RESTRICT,
  product_id   bigint NOT NULL REFERENCES product(id)   ON DELETE RESTRICT,
  variant_id   bigint REFERENCES product_variant(id)    ON DELETE RESTRICT,
  qty_on_hand  numeric(12,3) NOT NULL DEFAULT 0 CHECK (qty_on_hand >= 0),
  qty_reserved numeric(12,3) NOT NULL DEFAULT 0 CHECK (qty_reserved >= 0),
  qty_available numeric(12,3)
    GENERATED ALWAYS AS (qty_on_hand - qty_reserved) STORED,
  reorder_point numeric(12,3) NOT NULL DEFAULT 0 CHECK (reorder_point >= 0),
  reorder_qty   numeric(12,3) NOT NULL DEFAULT 0 CHECK (reorder_qty   >= 0),
  CONSTRAINT cannot_reserve_more_than_held CHECK (qty_reserved <= qty_on_hand),
  UNIQUE NULLS NOT DISTINCT (warehouse_id, product_id, variant_id)
);

CREATE TABLE sales_order (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  number text NOT NULL UNIQUE,
  quotation_id bigint NOT NULL UNIQUE REFERENCES quotation(id) ON DELETE RESTRICT,
  customer_id bigint NOT NULL REFERENCES customer(id) ON DELETE RESTRICT,
  currency_code char(3) NOT NULL REFERENCES currency(code),
  state order_state NOT NULL DEFAULT 'confirmed',
  promised_delivery_date date,
  grand_total numeric(14,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sales_order_line (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id bigint NOT NULL REFERENCES sales_order(id) ON DELETE CASCADE,
  quotation_line_id bigint NOT NULL REFERENCES quotation_line(id) ON DELETE RESTRICT,
  product_id bigint NOT NULL REFERENCES product(id) ON DELETE RESTRICT,
  variant_id bigint REFERENCES product_variant(id) ON DELETE RESTRICT,
  qty numeric(12,3) NOT NULL CHECK (qty > 0),
  unit_price numeric(14,4) NOT NULL,
  net_amount numeric(14,2) NOT NULL
);

CREATE TABLE fulfillment_allocation (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_line_id bigint NOT NULL REFERENCES sales_order_line(id) ON DELETE CASCADE,
  warehouse_id bigint NOT NULL REFERENCES warehouse(id) ON DELETE RESTRICT,
  qty numeric(12,3) NOT NULL CHECK (qty > 0),
  status alloc_status NOT NULL DEFAULT 'planned',
  est_shipments smallint NOT NULL DEFAULT 1,
  shipping_cost numeric(14,2) NOT NULL DEFAULT 0,
  is_manual_override boolean NOT NULL DEFAULT false,
  promised_ship_date date,
  shipped_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE backorder (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_line_id bigint NOT NULL REFERENCES sales_order_line(id) ON DELETE CASCADE,
  qty_outstanding numeric(12,3) NOT NULL CHECK (qty_outstanding > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

-- ───────────────── SUBSCRIPTIONS, BILLING ────────────────────
CREATE TABLE subscription (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  customer_id bigint NOT NULL REFERENCES customer(id) ON DELETE RESTRICT,
  plan_id bigint NOT NULL REFERENCES subscription_plan(id) ON DELETE RESTRICT,
  source_order_line_id bigint REFERENCES sales_order_line(id) ON DELETE SET NULL,
  qty numeric(12,3) NOT NULL DEFAULT 1 CHECK (qty > 0),
  status sub_status NOT NULL DEFAULT 'active',
  current_period_start date NOT NULL,
  current_period_end   date NOT NULL,
  next_bill_date date,
  started_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  CHECK (current_period_end > current_period_start),
  CONSTRAINT next_bill_only_when_active
    CHECK ((status = 'active') OR next_bill_date IS NULL)
);

CREATE TABLE invoice (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  number text NOT NULL UNIQUE,
  customer_id bigint NOT NULL REFERENCES customer(id) ON DELETE RESTRICT,
  order_id bigint REFERENCES sales_order(id) ON DELETE RESTRICT,
  subscription_id bigint REFERENCES subscription(id) ON DELETE RESTRICT,
  kind line_type NOT NULL,
  currency_code char(3) NOT NULL REFERENCES currency(code),
  amount_total numeric(14,2) NOT NULL CHECK (amount_total >= 0),
  status invoice_status NOT NULL DEFAULT 'unpaid',
  issue_date date NOT NULL DEFAULT CURRENT_DATE,
  due_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoice_has_a_source
    CHECK (num_nonnulls(order_id, subscription_id) >= 1)
);

CREATE TABLE invoice_line (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  invoice_id bigint NOT NULL REFERENCES invoice(id) ON DELETE CASCADE,
  description text NOT NULL,
  qty numeric(12,3) NOT NULL,
  unit_price numeric(14,4) NOT NULL,
  amount numeric(14,2) NOT NULL
);

CREATE TABLE payment (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  invoice_id bigint NOT NULL REFERENCES invoice(id) ON DELETE RESTRICT,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  method text NOT NULL CHECK (method IN ('bank','cash','card')),
  reference text,
  paid_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE credit_note (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  number text NOT NULL UNIQUE,
  customer_id bigint NOT NULL REFERENCES customer(id) ON DELETE RESTRICT,
  invoice_id bigint REFERENCES invoice(id) ON DELETE RESTRICT,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE proration_event (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  subscription_id bigint NOT NULL REFERENCES subscription(id) ON DELETE CASCADE,
  event_type text NOT NULL
    CHECK (event_type IN ('qty_change','plan_change','cancel','reactivate')),
  effective_date date NOT NULL,
  old_qty numeric(12,3),
  new_qty numeric(12,3),
  old_plan_id bigint REFERENCES subscription_plan(id),
  new_plan_id bigint REFERENCES subscription_plan(id),
  days_remaining integer NOT NULL CHECK (days_remaining >= 0),
  days_in_period integer NOT NULL CHECK (days_in_period > 0),
  delta_amount numeric(14,2) NOT NULL,
  credit_note_id bigint REFERENCES credit_note(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE deal_alert (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  quotation_id bigint NOT NULL REFERENCES quotation(id) ON DELETE CASCADE,
  kind alert_type NOT NULL,
  detail text NOT NULL,                      -- 'Idle 9 days' | 'Discount 22% vs avg 8%'
  flagged_at date NOT NULL DEFAULT CURRENT_DATE,
  last_action text,                          -- 'Nudge sent' | 'Escalated to Manager'
  last_action_at timestamptz,
  last_action_by_user_id bigint REFERENCES app_user(id),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- at most ONE open alert of each kind per quotation
CREATE UNIQUE INDEX one_open_alert_per_kind
  ON deal_alert (quotation_id, kind) WHERE resolved_at IS NULL;

-- ─────────────── DERIVED: one definition, everywhere ─────────
CREATE VIEW product_stock AS
SELECT product_id,
       SUM(qty_on_hand)   AS qty_on_hand,
       SUM(qty_reserved)  AS qty_reserved,
       SUM(qty_available) AS qty_available
FROM stock_level
GROUP BY product_id;

CREATE FUNCTION effective_ceiling_pct(p_tier_id bigint, p_category_id bigint)
RETURNS numeric(5,2)
LANGUAGE sql STABLE AS $$
  SELECT LEAST(t.max_discount_pct, c.max_discount_pct)
  FROM customer_tier t, product_category c
  WHERE t.id = p_tier_id AND c.id = p_category_id
$$;

-- ─────────────────────────── INDEXES ─────────────────────────
CREATE INDEX ON quotation (state, last_activity_at DESC);
CREATE INDEX ON quotation (customer_id);
CREATE INDEX ON quotation (owner_user_id);
CREATE INDEX ON quotation_line (quotation_id);
CREATE INDEX ON approval_request (quotation_id, quotation_version);
CREATE INDEX ON approval_request (status, assigned_to_user_id) WHERE status = 'pending';
CREATE INDEX ON stock_level (product_id);
CREATE INDEX ON invoice (customer_id, status);
CREATE INDEX ON invoice (due_date) WHERE status <> 'paid';
CREATE INDEX ON subscription (next_bill_date) WHERE status = 'active';
CREATE INDEX ON audit_log (entity_type, entity_id, created_at DESC);
CREATE INDEX ON app_user (team_id);
CREATE INDEX ON deal_alert (kind, flagged_at DESC) WHERE resolved_at IS NULL;
CREATE INDEX ON sales_order (promised_delivery_date) WHERE state <> 'fulfilled';

COMMIT;
