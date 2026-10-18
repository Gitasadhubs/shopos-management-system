#!/usr/bin/env bash
# The end-to-end suite against the real deployment stack (production build, MariaDB, nginx HTTPS,
# MinIO, Mailpit, backups) on Linux: what scripts/e2e.ps1 -Target preprod does on Windows. Used by
# GitHub Actions (.github/workflows/ci-cd.yml).
#   bash scripts/e2e-ci.sh                     # whole suite
#   bash scripts/e2e-ci.sh e2e/billing.spec.ts # extra args go to playwright
set -euo pipefail
cd "$(dirname "$0")/.."

stack=(docker compose -p shopos-e2e -f docker-compose.yml --env-file e2e/preprod.env)
cleanup() { "${stack[@]}" down -v >/dev/null 2>&1 || true; }
trap cleanup EXIT

rm -rf .e2e-backups && mkdir -p .e2e-backups
docker build -q -f Dockerfile.e2e -t shopos-playwright:1.64.0 . >/dev/null
"${stack[@]}" up -d --build --wait
docker run --rm --network shopos-e2e_default --ipc host --init \
  -e BASE_URL=https://nginx:18443 -e E2E_TARGET=preprod -e CI=true -e MAILPIT_URL=http://mailpit:8025 \
  -v "$PWD:/app" -v /app/node_modules -w /app \
  shopos-playwright:1.64.0 npx playwright test "$@"

# The newest rollback (deploy/rollback/NNNN-*.sql) undoes its migration cleanly, and the app then
# migrates forward again on the same data.
latest=$(ls deploy/rollback/[0-9]*.sql 2>/dev/null | sort | tail -1)
if [[ -n $latest && $# -eq 0 ]]; then
  version=$((10#$(basename "$latest" | cut -c1-4)))
  db() { "${stack[@]}" exec -T db sh -c 'exec mariadb -N -u"$MARIADB_USER" -p"$MARIADB_PASSWORD" "$MARIADB_DATABASE"'; }
  at() { echo 'SELECT MAX(version) FROM schema_migrations' | db; }
  [[ $(at) -ge $version ]] || { echo "Migration $version was never applied"; exit 1; }
  db < "$latest"
  [[ $(at) -eq $((version - 1)) ]] || { echo "Rollback $(basename "$latest") did not take the schema back to $((version - 1))"; exit 1; }
  "${stack[@]}" restart app >/dev/null
  "${stack[@]}" exec -T app node -e "(async()=>{for(let i=0;i<60;i++){try{const r=await fetch('http://127.0.0.1:3000/api/health');if(r.ok)process.exit(0)}catch{};await new Promise(r=>setTimeout(r,2000))}process.exit(1)})()"
  [[ $(at) -ge $version ]] || { echo "Migration $version did not apply again after its rollback"; exit 1; }
  echo "Rollback $(basename "$latest") checked: down to $((version - 1)) and forward again."
fi
