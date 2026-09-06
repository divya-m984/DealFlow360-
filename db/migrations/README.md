# Migrations

`db/schema.sql` is **frozen**. After the freeze, changes are **additive only**:
a new table, a new nullable column, a new index. Never a rename, never a drop,
never a type change.

- One file per change: `NNN-short-name.sql`, numbered sequentially.
- **Claim your number in chat before you write the file.** Two people picking
  `003` at the same time is the one conflict the ownership map cannot prevent.
- **Never edit a migration someone else has already run.** Write a new one.
## Post-freeze DDL now lives in `db/seed/00-migrations.sql`

`db/reset.sh` applies `schema.sql` and `db/seed/*.sql` — it does **not** run
this directory. Anything added only here disappears on the next reset, and the
person who reset finds out when a route 500s.

So the authoritative path is:

- **`db/seed/00-migrations.sql`** — every additive DDL change, all `IF NOT
  EXISTS`. It sorts before `01-identity.sql`, so the tables exist and no rows
  do yet.
- **`db/seed/09-backfill.sql`** — the data half, guarded by `IS NULL` / `= 0`
  so it is safe to re-run. Column added in `00-`, values set in `09-`.

Put your change in those two files. Do not add `NNN-*.sql` here as well: a
second definition of the same column is a second definition even when
`IF NOT EXISTS` stops it erroring, and the two will disagree — `002` and `003`
were removed during integration for exactly that (they declared
`ON DELETE SET NULL` where `00-migrations.sql` declares `RESTRICT`, and `003`
argued *against* the `author_side` column `00-migrations.sql` ships).

`001-viewer-role.sql` stays as the written rationale for the `viewer` role. It
is a no-op — `00-migrations.sql` performs the same `ADD VALUE`.

`db/reset-with-migrations.sh` was deleted with them: it existed only to replay
this directory after a reset, which `00-migrations.sql` now makes unnecessary.
