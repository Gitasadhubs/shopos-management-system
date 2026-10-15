# HTTP API

All endpoints return `{ "data": …, "error": null | "message" }` (plus `"code"` for errors the UI acts on)
with `Cache-Control: no-store`. Writes must come from the same origin. The session is the
`shopos_session` cookie (`__Host-shopos_session` over HTTPS).

Status codes: `400` invalid input · `401` signed out · `402` subscription ended (writes refused) ·
`403` role or origin not allowed · `404` not found (also for other shops' records) · `409` conflict
(stock, duplicates) · `413` file too large · `415` wrong file type · `429` rate limited · `502` email failed.

Permissions: **all** = any shop role · **O** owner · **M** manager · **C** cashier.

## Accounts

| Method | Path | Who | Purpose |
|---|---|---|---|
| GET | `/api/auth/setup` | anyone | `{ needs_setup }` until the platform admin exists |
| POST | `/api/auth/setup` | anyone, once | Create the platform admin `{ email, full_name, password }` |
| POST | `/api/auth/signup` | anyone | New shop on a trial `{ shop_name, phone?, full_name, email, password }` |
| POST | `/api/auth/verify-email` | anyone | `{ token }` from the email |
| POST | `/api/auth/resend-verification` | anyone | `{ email }` (same answer whether it exists) |
| POST | `/api/auth/login` | anyone | `{ email, password }` → sets the cookie |
| POST | `/api/auth/logout` | signed in | Ends the session |
| POST | `/api/auth/forgot-password` | anyone | `{ email }` |
| POST | `/api/auth/reset-password` | anyone | `{ token, password }` → signs in, other devices out |
| GET / POST | `/api/auth/invite` | anyone | `?token=` shows the invitation; POST `{ token, full_name, password }` accepts it |
| GET | `/api/auth/me` | signed in | The user and their shop/subscription |
| POST | `/api/auth/password` | signed in | `{ current_password, new_password }` |

## Shop

| Method | Path | Who | Purpose |
|---|---|---|---|
| GET | `/api/dashboard` | all | Today's sales, profit, low stock, week, khata, checklist |
| GET | `/api/products?search=` | all | Active products |
| POST / PUT / DELETE | `/api/products` | O, M | Create / update (`id` in body) / remove (`?id=`) |
| POST | `/api/products/image` | O, M | Multipart `file` → `{ url }` |
| POST | `/api/stock-moves` | O, M | `{ product_id, delta, reason }` |
| GET | `/api/sales?search=&from=&to=&limit=&offset=` | all | Sales history (search: invoice number, customer, product) |
| POST | `/api/sales` | all | `{ client_id, items[{product_id, quantity}], discount, payment_method: cash\|card\|credit, amount_paid?, customer_id? }` |
| GET | `/api/sales/:id` | all | One sale with its returns |
| POST | `/api/sales/:id/returns` | O, M | `{ client_id, items[{product_id, quantity}], reason? }` |
| GET / POST | `/api/customers` | all | Khata customers; add |
| GET / PUT / DELETE | `/api/customers/:id` | all (DELETE: O, M) | Ledger; edit; remove when settled |
| POST | `/api/customers/:id/payment` | all | `{ amount, note? }` (not more than the balance) |
| GET / POST | `/api/suppliers` | O, M | Suppliers; add |
| GET / PUT / DELETE | `/api/suppliers/:id` | O, M | Ledger; edit; remove when settled |
| POST | `/api/suppliers/:id/payment` | O, M | `{ amount, note? }` |
| GET / POST | `/api/purchases` | O, M | Purchases; record `{ supplier_id?, reference?, items[{product_id, quantity, unit_cost}], amount_paid?, update_cost? }` |
| GET | `/api/reports?from=&to=` | O, M | Range report (≤ 366 days) |
| GET / POST | `/api/expenses?from=&to=` | O, M | List; add `{ category, amount, note?, spent_on }` |
| DELETE | `/api/expenses/:id` | O, M | |
| GET | `/api/day-end?day=` | O, M | Day-end report, its WhatsApp text and delivery settings |
| POST | `/api/day-end/send` | O, M | Send the report now `{ day? }` |
| GET | `/api/settings` | all | Shop profile (receipts) |
| PUT | `/api/settings` | O | Profile, time zone, daily target, report schedule |
| GET | `/api/billing` | O | Plan, payments, proofs, where to pay (works when expired) |
| POST | `/api/billing/proofs` | O | Multipart `file` (image/PDF ≤ 5 MB) + `note` (works when expired) |
| GET / POST | `/api/users` | O | Staff and pending invitations; invite `{ email, role, full_name? }` |
| PATCH | `/api/users/:id` | O | `{ role?, is_active? }` |
| DELETE | `/api/users/invites/:id` | O | Cancel an invitation |
| GET | `/api/files/shops/:shop/…` | same shop (proofs: O) or admin | A stored file |
| GET | `/api/health` | anyone | `{ ok, storage, files }` (503 if the database is down) |

The platform admin panel (`/admin`) uses server actions (record payment, add days, suspend, resume,
end subscription, set price), not this API.
