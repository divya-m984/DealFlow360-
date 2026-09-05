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
| `app/api/quotations/**`, `app/api/approvals/**`, `app/api/portal/**` | **D1** |
| `app/(app)/quotations/[id]/**`, `app/(app)/approvals/[id]/**`, `app/(portal)/**` | **D1** |
| `components/quotation/**`, `db/seed/05-quotations.sql` | **D1** |
| `lib/types/order.ts`, `lib/types/catalog.ts`, `lib/allocate.ts`, `lib/billing.ts`, `lib/invoice.ts` | **D2** |
| `app/api/orders/**`, `app/api/fulfilment/**`, `app/api/subscriptions/**`, `app/api/invoices/**`, `app/api/config/**` | **D2** |
| `app/(app)/fulfilment/[id]/**`, `app/(app)/subscriptions/[id]/**`, `app/(app)/invoices/[id]/**`, `app/(app)/settings/**` | **D2** |
| `components/fulfilment/**`, `components/billing/**`, `db/seed/04-stock.sql`, `db/seed/06-orders.sql` | **D2** |
| `app/(app)/layout.tsx`, `app/globals.css`, `components/nav.ts` | **D3** |
| `components/ui/**`, `components/shared/**`, `components/data-table.tsx` | **D3** |
| **All `app/(app)/*/page.tsx`** (list screens) + `app/(app)/page.tsx` | **D3** |
| `db/seed/*.csv`, `docs/**`, `app/(app)/reports/**` | **D4** |

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
