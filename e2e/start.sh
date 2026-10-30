#!/usr/bin/env bash
# Starts the app against a fresh local D1 with every migration applied.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f dist/server/wrangler.json ] || npm run build
rm -rf .wrangler/state
for f in $(ls drizzle/*.sql | sort); do
  node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file "$f" > /dev/null
done
# Never let a pulled .env.local (production Turso credentials) redirect tests to a real database.
export TURSO_DATABASE_URL="" TURSO_AUTH_TOKEN=""
exec npm run dev -- --port 5173
