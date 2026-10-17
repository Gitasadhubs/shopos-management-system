import { z } from 'zod'
import { withBillingOwner } from '@/lib/billing-route'
import { paddleLink } from '@/lib/local-billing'
import { jsonResponse } from '@/lib/local-session'
import { paddleCheckoutConfig, priceIdFor } from '@/lib/paddle'

export const runtime = 'nodejs'

const schema = z.object({ plan: z.enum(['starter', 'growth']), interval: z.enum(['month', 'year']) })

// What the Billing page needs to open Paddle's checkout for a card plan. The shop id travels with the
// checkout (custom_data) and comes back on the webhook, which is what actually activates the plan.
export async function POST(request: Request) {
  return withBillingOwner(request, 'Unable to start the card payment.', async ({ user, shop }) => {
    const parsed = schema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return jsonResponse(null, 'Choose a plan.', 400)
    const config = paddleCheckoutConfig()
    const priceId = config && priceIdFor(parsed.data.plan, parsed.data.interval)
    if (!config || !priceId) return jsonResponse(null, 'Card payments are not available yet. Pay by bank transfer below, or contact us.', 503, 'paddle_not_configured')
    const link = await paddleLink(shop.id)
    if (link?.live) return jsonResponse(null, 'Your card plan is already active. Use "Change plan" to switch.', 409, 'already_subscribed')
    return jsonResponse({
      environment: config.environment,
      client_token: config.client_token,
      price_id: priceId,
      email: user.email,
      custom_data: { shop_id: shop.id },
    })
  })
}
