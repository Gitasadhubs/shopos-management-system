# Platform admin guide

The platform admin runs the ShopOS service: every shop, subscription and payment. The installer
creates this account; it belongs to no shop and works only in **/admin**, which is invisible (404) to
everyone else.

## Overview (`/admin`)

Shops by state (trial, active, expired, suspended), monthly recurring revenue, revenue this month and
all time, sign-ups in the last 7 days, revenue by month, trials and plans ending within 7 days, newest shops.

## Shops (`/admin/shops`)

Search by shop name, phone or any user's email; filter by state. Each shop's page shows its owner and
staff, usage (products, customers, sales, revenue in 30 days, last sale), payments, payment proofs and
an audit trail of every subscription change. Actions:

| Action | Effect |
|---|---|
| **Record payment** (amount, months, method, reference) | Adds the months on top of any time already paid; the shop becomes active; waiting proofs are marked recorded. |
| **Add days** | Free extra time (1–365 days). |
| **Suspend** / **Resume** | Read-only until resumed (resume goes back to active if it has ever paid, otherwise trial). |
| **End subscription now** | Period ends now; the shop is read-only until it pays. |
| **Monthly price** | Per-shop price (default ₨1,500). |

## Payments (`/admin/payments`)

Payment proofs waiting for review (screenshots/PDFs shops sent from Billing) and all recorded payments.
Check the proof against your bank/wallet, then **Record payment** on that shop's page.

## Subscriptions (`/admin/subscriptions`)

All shops sorted by when their period ends — your renewal follow-up list.

## Good practice

- Use a long, unique password for this account; sign out on shared computers.
- Record a payment only after the money has arrived.
- A shop that stops paying: let the period end (read-only) rather than deleting anything. Data
  deletion on request is done in the database by the server operator.
