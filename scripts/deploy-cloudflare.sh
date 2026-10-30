#!/usr/bin/env bash
# Deploys to Cloudflare Workers (free plan) with a D1 database. Requires `npx wrangler login` first.
# Usage: PORTAL_STAFF_EMAILS=you@example.com scripts/deploy-cloudflare.sh
set -euo pipefail
cd "$(dirname "$0")/.."
NAME="${WORKER_NAME:-azentio-collective}"
DB_NAME="${D1_NAME:-azentio-collective-db}"
W="node ./node_modules/wrangler/bin/wrangler.js"

npx wrangler whoami > /dev/null
npm run build

DB_ID=$($W d1 list --json | node -e 'const l=JSON.parse(require("fs").readFileSync(0,"utf8"));const d=l.find(x=>x.name===process.argv[1]);if(d)console.log(d.uuid)' "$DB_NAME")
if [ -z "$DB_ID" ]; then
  $W d1 create "$DB_NAME" > /dev/null
  DB_ID=$($W d1 list --json | node -e 'const l=JSON.parse(require("fs").readFileSync(0,"utf8"));console.log(l.find(x=>x.name===process.argv[1]).uuid)' "$DB_NAME")
fi

# Patch the generated config with the real database and worker name.
node -e '
const fs=require("fs"),p="dist/server/wrangler.json",c=JSON.parse(fs.readFileSync(p,"utf8"));
c.name=process.argv[1];c.d1_databases=[{binding:"DB",database_name:process.argv[2],database_id:process.argv[3]}];
c.vars={...c.vars,PORTAL_STAFF_EMAILS:process.env.PORTAL_STAFF_EMAILS||"",DEMO_OPEN_STAFF:"0",DEMO_OPEN_CLIENT_TENANTS:"1",NODE_ENV:"production"};
fs.writeFileSync(p,JSON.stringify(c));' "$NAME" "$DB_NAME" "$DB_ID"

for f in $(ls drizzle/*.sql | sort); do
  $W d1 execute "$DB_NAME" --remote --config dist/server/wrangler.json --file "$f" 2>&1 | grep -viE "already exists" || true
done
$W deploy --config dist/server/wrangler.json
