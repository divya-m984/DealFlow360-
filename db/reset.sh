#!/usr/bin/env bash
# OWNER: Integrator.  FROZEN after Phase 0.
#
# Drops everything, reapplies the schema, replays every seed file in numeric
# order.  Must stay fast — rehearsing the demo from a known-good state is what
# this exists for.
#
#   ./db/reset.sh
set -euo pipefail

cd "$(dirname "$0")/.."

if [ -f .env.local ]; then
  set -a; . ./.env.local; set +a
fi
: "${DATABASE_URL:?DATABASE_URL is not set — copy .env.example to .env.local}"

echo "→ schema"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f db/schema.sql

shopt -s nullglob
for f in db/seed/*.sql; do
  echo "→ $(basename "$f")"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$f"
done

echo "✓ reset complete"
