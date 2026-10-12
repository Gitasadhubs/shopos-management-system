# Runs the Playwright suite in Docker against a throwaway database.
#   .\scripts\e2e.ps1                     # dev server (next dev + in-memory MariaDB)
#   .\scripts\e2e.ps1 -Target preprod     # the deployment stack: production build, MariaDB, Caddy HTTPS, Mailpit, backups
#   .\scripts\e2e.ps1 e2e/pos.spec.ts     # extra args go to playwright
# Only one run at a time: runs share containers and the test-results folder.
[CmdletBinding(PositionalBinding = $false)]
param(
  [ValidateSet('dev', 'preprod')] [string] $Target = 'dev',
  [Parameter(ValueFromRemainingArguments = $true)] [string[]] $PlaywrightArgs
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
$dev = @('compose', '-f', 'docker-compose.dev.yml', '--profile', 'test')
$exitCode = 1

& docker @dev build playwright
if ($LASTEXITCODE -ne 0) { throw 'Could not build the Playwright image.' }

if ($Target -eq 'dev') {
  $services = @('mariadb-test', 'mailpit-test', 'shopos-test')
  try {
    # Fresh anonymous volumes, so node_modules always matches the image built from package.json.
    & docker @dev up -d --build --wait --force-recreate --renew-anon-volumes @services
    if ($LASTEXITCODE -ne 0) { throw 'Could not start the dev test server.' }
    & docker @dev run --rm --no-deps playwright npx playwright test @PlaywrightArgs
    $exitCode = $LASTEXITCODE
  } finally {
    # Stopping clears the in-memory database, so the next run starts empty.
    & docker @dev stop @services | Out-Null
  }
  exit $exitCode
}

# Preprod: the real docker-compose.yml under its own project name, ports and volumes.
$stack = @('compose', '-p', 'shopos-e2e', '-f', 'docker-compose.yml', '--env-file', 'e2e/preprod.env')
$backups = Join-Path $root '.e2e-backups'
try {
  if (Test-Path $backups) { Remove-Item -Recurse -Force $backups }
  & docker @stack up -d --build --wait
  if ($LASTEXITCODE -ne 0) { throw 'Could not start the preprod stack.' }
  & docker run --rm --network shopos-e2e_default --ipc host --init `
    -e BASE_URL=https://caddy:18443 -e E2E_TARGET=preprod -e CI=true -e MAILPIT_URL=http://mailpit:8025 `
    -v "${root}:/app" -v /app/node_modules -w /app `
    shopos-playwright:1.64.0 npx playwright test @PlaywrightArgs
  $exitCode = $LASTEXITCODE
} finally {
  & docker @stack down -v | Out-Null
}
exit $exitCode
