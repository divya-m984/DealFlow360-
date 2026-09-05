#!/usr/bin/env bash
# OWNER: Integrator.  FROZEN after Phase 0.
#
# Drops everything, reapplies the schema, replays every seed file in numeric
# order.  Must stay fast — rehearsing the demo from a known-good state is what
# this exists for.
#
#   ./db/reset.sh
#
# Uses the host's psql if it has one, otherwise runs psql INSIDE the Postgres
# container.  Nobody on the team has postgresql-client installed and none of us
# needs to — the container already has it, which is why we chose Docker.
# Files are piped on stdin rather than passed with -f, because -f would resolve
# against the container's filesystem, not the repo.
set -euo pipefail

cd "$(dirname "$0")/.."

if [ -f .env.local ]; then
  set -a; . ./.env.local; set +a
fi
: "${DATABASE_URL:?DATABASE_URL is not set — copy .env.example to .env.local}"

if command -v psql >/dev/null 2>&1; then
  run() { psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q; }
else
  run() { docker compose exec -T db psql -U dealflow -d dealflow -v ON_ERROR_STOP=1 -q; }
fi

echo "→ schema"
run < db/schema.sql

shopt -s nullglob
for f in db/seed/*.sql; do
  echo "→ $(basename "$f")"
  run < "$f"
done

echo "✓ reset complete"
