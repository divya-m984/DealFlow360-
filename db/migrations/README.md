# Migrations

`db/schema.sql` is **frozen**. After the freeze, changes are **additive only**:
a new table, a new nullable column, a new index. Never a rename, never a drop,
never a type change.

- One file per change: `NNN-short-name.sql`, numbered sequentially.
- **Claim your number in chat before you write the file.** Two people picking
  `003` at the same time is the one conflict the ownership map cannot prevent.
- **Never edit a migration someone else has already run.** Write a new one.
- `db/reset.sh` applies `schema.sql` and the seeds. If you add a migration,
  fold it into your own reset flow or tell the integrator.
