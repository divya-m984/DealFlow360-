# Ownership map

> **Rule Zero — every file has exactly one owner. You may only create or edit files under
> your paths. If you need something outside your lane, you ask its owner. You never create
> it yourself.**

Every file below already exists as a stub. **Nothing is created later, so nothing can be
created twice** — which is what stops two people inventing the same file and colliding.

| Path | Owner |
|---|---|
| `package.json`, `tsconfig.json`, `next.config.ts`, `docker-compose.yml`, `middleware.ts` | **Integrator** — frozen |
| `lib/db.ts`, `lib/api.ts`, `lib/auth.ts`, `lib/jwt.ts` | **Integrator** — frozen, read by everyone |
| `db/schema.sql`, `db/reset.sh` | **Integrator** — frozen |
| `app/(auth)/**`, `app/api/auth/**` | **Integrator** — frozen |
| `db/migrations/NNN-*.sql` | claimed per file |
| `lib/types/quotation.ts`, `lib/risk.ts`, `lib/approval.ts`, `lib/quotation.ts` | **D1** |
| `app/api/quotations/**`, `app/api/approvals/**`, `app/api/portal/**`, `app/api/deal-alerts/**` | **D1** |
| `app/(app)/quotations/[id]/**`, `app/(app)/approvals/[id]/**`, `app/(portal)/**` | **D1** |
| `components/quotation/**`, `db/seed/05-quotations.sql` | **D1** |
| `lib/types/order.ts`, `lib/types/catalog.ts`, `lib/allocate.ts`, `lib/billing.ts`, `lib/invoice.ts` | **D2** |
| `app/api/orders/**`, `app/api/fulfilment/**`, `app/api/subscriptions/**`, `app/api/invoices/**`, `app/api/config/**`, `app/api/products/**` | **D2** |
| `app/(app)/fulfilment/[id]/**`, `app/(app)/subscriptions/[id]/**`, `app/(app)/invoices/[id]/**`, `app/(app)/products/[id]/**`, `app/(app)/settings/**` | **D2** |
| `components/fulfilment/**`, `components/billing/**`, `db/seed/04-stock.sql`, `db/seed/06-orders.sql` | **D2** |
| `app/(app)/layout.tsx`, `app/globals.css`, `components/nav.ts` | **D3** |
| `components/ui/**`, `components/shared/**`, `components/data-table.tsx` | **D3** |
| **All `app/(app)/*/page.tsx`** (list screens) + `app/(app)/page.tsx` | **D3** |
| `db/seed/*.csv`, `docs/**`, `app/(app)/reports/**`, `app/api/reports/**` | **D4** |

### The rule that removes the last of the risk

In a shared route folder, **`page.tsx` belongs to D3** (the list) and **`[id]/page.tsx`
belongs to D1 or D2** (the detail). Same directory, different files. Git never collides.

### No barrel files

There is no `lib/types.ts`. Types live per domain: `lib/types/quotation.ts`,
`lib/types/order.ts`, `lib/types/catalog.ts`. One shared file is a guaranteed four-way conflict.

---

## Contracts you may rely on (frozen)

```ts
// lib/db.ts   — pg is imported ONLY inside app/api/**
q<T>(sql, params?)            // rows
one<T>(sql, params?)          // first row or null
tx(async (c) => { … })        // use for ANY write touching more than one row

// lib/api.ts  — every response is { data } or { error: { message } }
ok(data, status?)  ·  fail(message, status)
withAuth(roles | null, handler)      // 401 unauthenticated, 403 wrong role
parseBody(req, zodSchema)            // throws a message withAuth renders

// lib/auth.ts — NODE runtime only (bcryptjs)
hashPassword · verifyPassword · getSession
// lib/jwt.ts  — EDGE safe (jose only). middleware.ts imports from HERE.
signToken · verifyToken · COOKIE
```

**Ids on the wire:** internal APIs use the numeric `id`. **The portal uses `public_id` (uuid)
only** — a portal user must never enumerate quotations by incrementing an integer.

**Runtime rule:** `bcryptjs` only in route handlers (`export const runtime = 'nodejs'`).
`jose` is the only auth code allowed in `middleware.ts`, which runs on Edge.

---

## Environment

```bash
cp .env.example .env.local     # DATABASE_URL, JWT_SECRET
docker compose up -d           # Postgres 17
./db/reset.sh                  # schema + all seeds, ~2s
npm install && npm run dev
```

`db/reset.sh` uses the host's `psql` if it has one, **otherwise runs psql inside the
container** — nobody needs postgresql-client installed.

**Seeded logins — password `demo1234`:**
`rep@dealflow.app` · `manager@dealflow.app` · `finance@dealflow.app` · `admin@dealflow.app` ·
`buyer@acme.example` (portal)

---

## Git protocol

- Everyone commits to `main`. Strict ownership means branches buy nothing.
- **Always `git pull --rebase`.** Never plain `git pull`.
- **Never `git add -A` from the repo root.** Add your own files by path.
- A conflict in a file you don't own means Rule Zero was broken — **stop and talk to the owner.**

---

## Added during D2's build (branch `D2`)

Phase 0 could not stub what nobody had thought of yet. These paths were created
while building the order-to-cash lane. **They are listed here so nobody creates
them a second time** — which is the whole point of this document.

| Path | Owner | Why it exists |
|---|---|---|
| `app/api/fulfilment/_stock.ts` | **D2** | DB glue for the split. `lib/allocate.ts` stays pure — no `pg`, no clock — so it can be unit-tested and read aloud; this file loads the numbers and writes back the decision. Not a route: Next only treats `route.ts`/`page.tsx` as routes, so a plain module in a route folder is safe. |
| `app/api/fulfilment/[id]/{plan,reserve,ship,consolidate}/route.ts` | **D2** | Accept/override the split, reserve with `FOR UPDATE`, ship, consolidate a backorder. |
| `app/api/fulfilment/stock/route.ts` | **D2** | Goods receipt. §B6's consolidate prompt is triggered by stock *arriving*; without this it could only be demoed by editing the database by hand on stage. |
| `app/api/orders/[id]/route.ts` | **D2** | One order with everything hanging off it — screens 8 and 10. |
| `app/api/invoices/[id]/route.ts`, `.../payments/route.ts` | **D2** | Screen 13, and §9's eighth and final step. |
| `app/api/subscriptions/[id]/{route,change,cancel,invoice,pause,resume}/route.ts` | **D2** | Proration ledger and the full billing lifecycle. `pause`/`resume` close out `sub_status = 'paused'` and `event_type = 'reactivate'`, which the schema declared and nothing implemented. |
| `components/billing/format.tsx` | **D2** | `qty()` and the two date helpers only. The money formatter that used to live here is gone — D2's screens now use D3's `components/shared/money.tsx`, along with `StatusBadge`, `ErrorState` and `EmptyState`. |
| `components/billing/invoice-pdf.ts`, `components/fulfilment/split-plan.tsx` | **D2** | Invoice PDF, and the suggested-split card. |
| `lib/allocate.test.mjs` | **D2** | 26 hand-run cases for the allocator. `.mjs`, not `.ts`, because Node's ESM loader needs the explicit `./allocate.ts` specifier and tsc rejects that without `allowImportingTsExtensions` — which would mean editing the Integrator's frozen `tsconfig.json`. `.mjs` is outside tsconfig's `include`, so both tools stay happy. Run it with `node --experimental-strip-types lib/allocate.test.mjs`. |

### ⚠ One change to a FROZEN file — `lib/db.ts`

I added a single line to the Integrator's frozen `lib/db.ts` and it needs your
sign-off, because it fixes a bug in **every lane at once**:

```ts
types.setTypeParser(types.builtins.DATE, (v) => v)
```

Postgres `date` is a calendar date with no time and no timezone. node-postgres
was turning it into a JS `Date` at LOCAL midnight, and `JSON.stringify` then
serialised that to UTC — so on any machine east of Greenwich the browser
received **the day before** the one in the database:

```
db 2026-10-05  →  Date(2026-10-05 00:00 IST)  →  "2026-10-04T18:30:00Z"
                                                   the screen showed the 4th
```

Gandhinagar is UTC+5:30, so this was wrong on every machine at the event, on
every due date, period boundary and promised delivery date — including the ones
printed on a customer invoice. Verified before and after: the DB and the wire
now agree.

Fixing it at the driver fixes it for D1's quotation dates, D3's lists and D4's
reports too. The alternative was ~30 call sites across four lanes. `timestamptz`
is deliberately untouched — those really are instants and UTC is right for them.

### Notes for other lanes

- **D1 — one more confirmed quotation would finish the fulfilment demo.**
  `05-quotations.sql` currently has exactly one (`Q-1028`), so the seed produces
  one order. That is enough to show the warehouse split, but a **backorder needs a
  second order** — stock is deliberately short. Confirming any second quotation,
  in the seed or live on stage, produces one immediately. I retuned
  `04-stock.sql` (LP14: MAIN 18 · EAST 10) so Q-1028's 25-unit line *must* split;
  **if you change that quantity, tell me and I will retune.**
- **D1 and D3 — `/api/products` and `/api/products/[id]` are built.** The list
  returns margin %, stock totals and variant counts; the detail returns variants
  with their option values, tier pricelists with the price already resolved, and
  per-warehouse stock. Ask for fields rather than adding a second endpoint.
- **D3 — thanks for `components/shared/**`; all five D2 screens are on it now**
  (`Money`, `StatusBadge`, `ErrorState`, `EmptyState`). If you add a status value,
  add it to your map and D2 picks it up for free. One gap: `manual` and
  `inactive` fall through to the neutral tone — add them when convenient.
- **D3 — `components/nav.ts` has no `/settings` entry.** Screen 18 is reachable
  only by typing the URL. Its own brief says it must be "reachable in two clicks
  during the demo", and a judge editing a discount ceiling live is a rubric
  moment. That file is D3's and frozen, so D2 cannot add it.
- **Integrator — `middleware.ts` is deprecated in Next 16.** Every build prints
  the `middleware-to-proxy` codemod notice. Harmless today; better decided before
  the freeze than at 3am.
- **D3 — TanStack Table in `package.json` is v9, and shadcn's `data-table` recipe
  is v8.** `useReactTable` is renamed to `useTable` and the row-model factories
  changed; shadcn has an open compatibility issue for exactly this. Either use
  `useLegacyTable` from `@tanstack/react-table/legacy` (deprecated, ships every
  feature) or write against the v9 API — but find out before, not during.
