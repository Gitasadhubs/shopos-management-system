# Platform admin guide

The platform admin runs the ShopOS service: every shop, subscription and payment. The installer
creates this account; it belongs to no shop and works only in **/admin**, which is invisible (404) to
everyone else.

## Overview (`/admin`)

Shops by state (trial, active, expired, suspended), monthly recurring revenue, revenue this month and
all time, sign-ups in the last 7 days, revenue by month, trials and plans ending within 7 days, newest shops.
Money is shown per currency (USD from card plans, PKR from transfers) and never added together; yearly
plans count as a twelfth of their price in monthly recurring revenue.

## Plans

| Plan | Price | Paid by | Staff |
|---|---|---|---|
| Starter | $9/month or $90/year | Card (Paddle), renews by itself | up to 3 |
| Growth | $19/month or $190/year | Card (Paddle), renews by itself | unlimited |
| Basic | ₨1,500/month | Bank transfer or wallet, recorded here | unlimited |

New shops start a 14-day trial on Basic and choose a plan on **Billing**. Card payments need no action:
Paddle's webhook records each payment (method "card", reference = Paddle transaction id), sets the plan
and the paid-until date, and partner commissions follow in USD. A renewal that fails gets 3 days of grace
while Paddle retries the card; a cancelled card plan runs until its paid date and then ends.

## Shops (`/admin/shops`)

Search by shop name, phone or any user's email; filter by state. Each shop's page shows its owner and
staff, usage (products, customers, sales, revenue in 30 days, last sale), payments, payment proofs and
an audit trail of every subscription change. Actions:

| Action | Effect |
|---|---|
| **Record payment** (amount, currency, months, method, reference) | For transfers. Adds the months on top of any time already paid; the shop becomes active; waiting proofs are marked recorded. |
| **Add days** | Free extra time (1–365 days). |
| **Suspend** / **Resume** | Read-only until resumed (resume goes back to active if it has ever paid, otherwise trial). A card payment never lifts a suspension. |
| **End subscription now** | Period ends now; the shop is read-only until it pays. It does not cancel a card plan in Paddle (do that in Paddle). |
| **Plan, per, price** | Per-shop plan and price for shops paying by transfer. Locked while a card plan renews; it follows Paddle. |

Shops paying by card also show **Card billing (Paddle webhooks)**: each event Paddle sent and what it did.

## Payments (`/admin/payments`)

Payment proofs waiting for review (screenshots/PDFs shops sent from Billing) and all recorded payments,
card and transfer. Check a proof against your bank/wallet, then **Record payment** on that shop's page.

## Refunds

Refund card payments in Paddle (Transactions → the payment → Refund); Paddle returns the money and the
tax. If the refund ends the plan, cancel the subscription in Paddle and use **End subscription now**
here. The payment stays in the ShopOS history; partner commissions for it should not be paid out.

## Subscriptions (`/admin/subscriptions`)

All shops sorted by when their period ends — your renewal follow-up list.

## Good practice

- Use a long, unique password for this account; sign out on shared computers.
- Record a payment only after the money has arrived.
- A shop that stops paying: let the period end (read-only) rather than deleting anything. Data
  deletion on request is done in the database by the server operator.
