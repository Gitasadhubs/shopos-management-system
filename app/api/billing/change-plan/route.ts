import { z } from 'zod'
import { withBillingOwner } from '@/lib/billing-route'
import { paddleLink } from '@/lib/local-billing'
import { jsonResponse } from '@/lib/local-session'
import { changeSubscriptionPrice, priceIdFor, resumeScheduledCancel } from '@/lib/paddle'

export const runtime = 'nodejs'

const schema = z.union([
  z.object({ action: z.literal('change'), plan: z.enum(['starter', 'growth']), interval: z.enum(['month', 'year']) }),
  z.object({ action: z.literal('resume') }),
])

// Switch a live card subscription to another plan or interval (charged or credited pro rata now), or
// undo a cancellation while the paid period is still running. Paddle confirms by webhook, and the
// shop's plan follows from there.
export async function POST(request: Request) {
  return withBillingOwner(request, 'Unable to change the plan.', async ({ shop }) => {
    const parsed = schema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return jsonResponse(null, 'Choose a plan.', 400)
    const link = await paddleLink(shop.id)
    if (!link?.subscriptionId) return jsonResponse(null, 'This shop does not pay by card.', 404, 'no_card_subscription')
    if (parsed.data.action === 'resume') {
      if (!link.cancelScheduled) return jsonResponse(null, 'Your plan is not set to cancel.', 409)
      await resumeScheduledCancel(link.subscriptionId)
      return jsonResponse({ resumed: true })
    }
    if (!link.live) return jsonResponse(null, 'Your card plan is not renewing. Resume it first, or start a new plan.', 409)
    if (link.plan === parsed.data.plan && link.interval === parsed.data.interval) return jsonResponse(null, 'You are already on this plan.', 409)
    const priceId = priceIdFor(parsed.data.plan, parsed.data.interval)
    if (!priceId) return jsonResponse(null, 'This plan is not available yet.', 503, 'paddle_not_configured')
    await changeSubscriptionPrice(link.subscriptionId, priceId)
    return jsonResponse({ changed: true })
  })
}
