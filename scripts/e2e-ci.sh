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
