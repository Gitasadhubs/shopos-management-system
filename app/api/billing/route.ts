import { withBillingOwner } from '@/lib/billing-route'
import { paddleLink } from '@/lib/local-billing'
import { getBilling } from '@/lib/local-platform'
import { jsonResponse } from '@/lib/local-session'
import { paddleCheckoutConfig } from '@/lib/paddle'
import { CARD_PLANS, PLANS } from '@/lib/plans'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Where shops send PKR subscription payments: SHOPOS_PAY_* in the env file. No defaults, so a shop is
// never shown an account that is not yours; anything unset is left off the Billing page.
function paymentDetails() {
  const value = (name: string) => process.env[name]?.trim() || ''
  return {
    bank_name: value('SHOPOS_PAY_BANK_NAME'),
    account_title: value('SHOPOS_PAY_ACCOUNT_TITLE'),
    account_number: value('SHOPOS_PAY_ACCOUNT_NUMBER'),
    iban: value('SHOPOS_PAY_IBAN'),
    wallet: value('SHOPOS_PAY_WALLET'),
    whatsapp: value('SHOPOS_PAY_WHATSAPP'),
  }
}

// The shop's plan, status and payment history, plus how it can pay: card plans through Paddle (when
// set up) and PKR transfers. Owner only; readable even after the shop has expired.
export async function GET(request: Request) {
  return withBillingOwner(request, 'Unable to load billing.', async ({ shop }) => {
    const checkout = paddleCheckoutConfig()
    const link = await paddleLink(shop.id)
    return jsonResponse({
      ...(await getBilling(shop.id)),
      payment_details: paymentDetails(),
      plans: CARD_PLANS.map((id) => PLANS[id]),
      card: checkout && {
        environment: checkout.environment,
        client_token: checkout.client_token,
        // Plan + interval pairs that have a Paddle price on this install (with the 14-day trial, for a
        // shop that is waiting for its card).
        available: shop.subscription.needs_card ? checkout.trial_prices : checkout.prices,
        subscription: link && { live: link.live, cancel_scheduled: link.cancelScheduled, plan: link.plan, interval: link.interval },
      },
    })
  })
}
