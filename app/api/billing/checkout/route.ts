import { z } from 'zod'
import { withBillingOwner } from '@/lib/billing-route'
import { paddleLink } from '@/lib/local-billing'
import { jsonResponse } from '@/lib/local-session'
import { CARD_SOON_MESSAGE, cardCheckoutOpen, paddleCheckoutConfig, priceIdFor } from '@/lib/paddle'

export const runtime = 'nodejs'

const schema = z.object({ plan: z.enum(['starter', 'growth']), interval: z.enum(['month', 'year']) })

// What the Billing page needs to open Paddle's checkout for a card plan. The shop id travels with the
// checkout (custom_data) and comes back on the webhook, which is what actually activates the plan.
export async function POST(request: Request) {
  return withBillingOwner(request, 'Unable to start the card payment.', async ({ user, shop }) => {
    const parsed = schema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return jsonResponse(null, 'Choose a plan.', 400)
    if (!cardCheckoutOpen()) return jsonResponse(null, CARD_SOON_MESSAGE, 503, 'card_soon')
    const config = paddleCheckoutConfig()
    // A shop waiting for its card starts the 14-day trial: the trial price charges nothing today.
    const trial = shop.subscription.needs_card
    const priceId = config && priceIdFor(parsed.data.plan, parsed.data.interval, trial)
    if (!config || !priceId) return jsonResponse(null, trial ? 'Card sign-up is not available right now. Contact us and we will start your trial.' : 'Card payments are not available yet. Pay by bank transfer below, or contact us.', 503, 'paddle_not_configured')
    const link = await paddleLink(shop.id)
    if (link?.live) return jsonResponse(null, 'Your card plan is already active. Use "Change plan" to switch.', 409, 'already_subscribed')
    return jsonResponse({
      environment: config.environment,
      client_token: config.client_token,
      price_id: priceId,
      trial,
      email: user.email,
      custom_data: { shop_id: shop.id },
    })
  })
}
