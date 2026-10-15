# Architecture

ShopOS is one Next.js application serving many shops (multi-tenant SaaS), with MariaDB for data,
S3-compatible storage (MinIO) for files, and nginx for HTTPS. Everything runs in Docker.

```
 Browser / till (PWA, works offline)
        │ HTTPS
        ▼
 ┌─────────────┐   reverse proxy, TLS, headers, real visitor IP
 │   nginx     │◄── Let's Encrypt (certbot) or Cloudflare origin certificate
 └─────┬───────┘
       │ HTTP (Docker network only)
       ▼
 ┌─────────────┐  pages (React Server Components), /api/* route handlers,
 │  app        │  proxy.ts (page guards), day-end scheduler (every minute),
 │  Next.js 16 │  migrations on start
 └──┬───────┬──┘
    │       │ S3 API
    │       ▼
    │  ┌─────────┐   product photos, payment proofs (private bucket)
    │  │  MinIO  │
    │  └─────────┘
    ▼
 ┌─────────────┐   all shop data; utf8mb4; UTC
 │ MariaDB 11.4│
 └─────────────┘
       ▲
 ┌─────┴───────┐   mariadb-dump + files archive on start and every 24 h → host folder
 │  backup     │
 └─────────────┘
```

Outbound: SMTP (verification, reset, invitations, day-end reports) and, optionally, Meta's
WhatsApp Cloud API (automatic day-end reports).

## Code map

| Path | What |
|---|---|
| `app/` | Pages (App Router) and API route handlers (`app/api/**/route.ts`). `[...slug]` renders the in-app screens. |
| `app/admin/` | Platform admin panel (server components + server actions). |
| `components/` | Screens (`*-page.tsx`), the app shell (`shopos-app.tsx`), UI kit (`components/ui`). |
| `lib/local-db.ts` | MariaDB pool, **migrations** (append-only list), products, sales, returns, dashboard. |
| `lib/local-auth.ts` | Accounts, sessions, email tokens, staff, rate limits. |
| `lib/local-session.ts` | Session cookie, `authorize` / `withShop` request guards, JSON responses. |
| `lib/local-platform.ts` | Shops, subscriptions, payments, payment proofs, admin queries. |
| `lib/local-business.ts` | Customers (khata), suppliers, purchases. |
| `lib/local-reports.ts`, `lib/day-end.ts`, `lib/local-expenses.ts` | Reports, day-end report + scheduler, expenses. |
| `lib/storage.ts`, `lib/file-keys.ts` | S3 file storage; type sniffing; file URLs. |
| `lib/mailer.ts`, `lib/whatsapp.ts` | Email (nodemailer) and WhatsApp Cloud API. |
| `lib/permissions.ts` | Roles → permissions. |
| `proxy.ts` | Page-level guard: sign-in, setup, roles, admin-only area. |
| `app/sw.ts`, `lib/offline/` | Service worker (Serwist) and offline sync queue (IndexedDB). |
| `e2e/` | Playwright end-to-end tests. |
| `deploy/` | Server installer and the `shopos` command. |
| `scripts/` | Backup script, e2e runner. |

Legacy: `lib/supabase/`, `lib/db.ts` and the non-`mariadb` branches of some routes are from the earlier
hosted (Supabase) mode and are unused when `SHOPOS_STORAGE=mariadb`.

## Data model (main tables)

| Table | Holds |
|---|---|
| `shops`, `subscriptions` | A shop (name, phone, address, receipt footer, time zone, report settings, next invoice number) and its plan (status, price, period end). |
| `users`, `sessions`, `email_tokens`, `auth_attempts` | Accounts (role admin/owner/manager/cashier), sessions (hashed), email links, rate-limit counters. |
| `products`, `stock_moves` | Catalogue with stock; every stock change with a reason. Unique SKU/barcode per shop among active products. |
| `sales`, `sale_items` | Sales with per-shop invoice numbers, payment method, amount paid, change, credit, refunded. |
| `sale_returns`, `sale_return_items` | Returns against a sale; refund split between khata and cash/card. |
| `customers`, `customer_ledger` | Khata: balance per customer and every sale/payment/return on it. |
| `suppliers`, `purchases`, `purchase_items`, `supplier_ledger` | Stock bought, what the shop owes each supplier. |
| `expenses` | Rent, bills, wages… by day and category. |
| `subscription_payments`, `subscription_events`, `payment_proofs` | Billing history, audit trail, uploaded proofs. |
| `report_deliveries` | Day-end report sends by email/WhatsApp. |
| `schema_migrations` | Applied migration versions. |

Every shop-owned table has `shop_id`; every query filters on it.

## Key flows

- **Sale:** POS → `POST /api/sales` with a `client_id` → transaction locks the products (fixed order),
  checks stock, takes the next invoice number under the shop row lock, writes sale + items + stock +
  khata ledger → returns the sale for the receipt. A retry with the same `client_id` returns the same sale.
- **Return:** `POST /api/sales/:id/returns` → locks the sale first, refunds each item's share of what was
  paid (discount shared), khata first up to what the sale left unpaid, rest in cash/card; puts stock back.
- **Day-end report:** every minute the app looks for shops whose report time has passed today and claims
  each with one `UPDATE … WHERE report_last_sent_on < today` (safe with several app instances).
- **Migrations:** on first database use, under `GET_LOCK('shopos_migrations')`, each unapplied entry of the
  append-only `migrations` list runs and is recorded.

## Environments

| | Where | Stack |
|---|---|---|
| Dev | this PC, `docker-compose.dev.yml` | `next dev` with hot reload, MariaDB, MinIO, Mailpit; test profile for e2e |
| Preprod | this PC, `docker-compose.yml` as `shopos-preprod` | the production build, on port 8443 |
| Production | the server, `docker-compose.yml` as `shopos-prod` | installed by `deploy/install.sh` |

Git branches: work on `dev` → full e2e → push `dev` → promote to `prod` → `shopos update` on the server.
