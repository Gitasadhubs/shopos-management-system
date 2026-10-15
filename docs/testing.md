# Testing

## Commands

| | Command | What |
|---|---|---|
| Types + lint | `docker exec shopos-dev npm run check` | TypeScript and ESLint. Run before every commit. |
| End-to-end (dev) | `.\scripts\e2e.ps1` | Playwright against a fresh dev server with its own database, MinIO and Mailpit (in-memory; wiped after). |
| End-to-end (preprod) | `.\scripts\e2e.ps1 -Target preprod` | The same suite against a disposable copy of the production stack (nginx, HTTPS, production build). |
| One file / test | `.\scripts\e2e.ps1 e2e/pos.spec.ts` or `e2e/pos.spec.ts:12` | Extra arguments go to Playwright. |
| Report | `playwright-report/index.html` | Traces and screenshots of failures. |

Only one e2e run at a time (they share container names). Tests run serially against one database
and use unique names, so they never depend on each other's data.

## What the suite covers

| Spec | Covers |
|---|---|
| `auth.setup.ts`, `auth.spec.ts` | First-run admin setup, sign-up + email confirmation, sign-in, rate limits, password reset, invitations, roles, sessions, cross-site blocking, cookie flags. |
| `tenancy.spec.ts` | One shop can never read or change another shop's data. |
| `pos.spec.ts`, `sales.spec.ts` | Selling, discounts, payment methods, stock limits, invoice numbers, receipts, returns (cash/card/khata, partial, rounding). |
| `inventory.spec.ts`, `files.spec.ts` | Products, stock adjustments, photos (upload, replace, shared, access rules), payment proofs. |
| `customers.spec.ts`, `purchases.spec.ts` | Khata, payments, ledgers, suppliers, purchases. |
| `reports.spec.ts`, `dayend.spec.ts`, `dashboard.spec.ts` | Reports, day-end report and delivery, expenses, dashboard figures. |
| `admin.spec.ts` | Platform admin: shops, subscriptions, payments, read-only shops. |
| `settings.spec.ts`, `navigation.spec.ts`, `api.spec.ts`, `pwa.spec.ts` | Settings, billing page, menus per role, API validation, offline/service worker. |
| `buttons.spec.ts` | **Every button on every screen, for cashier, manager, owner, admin and signed-out visitors**, including the buttons inside every dialog that opens: no crash, no server error, no error screen, no blank page. Runs in its own shop. |
| `double-submit.spec.ts` | Double-clicking (or pressing F9 twice) on every button that records money — sale, customer payment, supplier payment, return, purchase, expense, new product/customer — records exactly once. |
| `preprod.spec.ts` | Production-only checks (HTTPS headers, real build). |

## Before a release

1. `npm run check` passes.
2. `.\scripts\e2e.ps1` passes (dev).
3. Push `dev`; update preprod; `.\scripts\e2e.ps1 -Target preprod` passes.
4. Merge to `prod`; on the server `shopos update`.
