import { withBillingOwner } from '@/lib/billing-route'
import { paddleLink } from '@/lib/local-billing'
import { jsonResponse } from '@/lib/local-session'
import { createPortalLink } from '@/lib/paddle'

export const runtime = 'nodejs'

// A fresh link to Paddle's customer portal (update card, invoices, cancel). Links expire, so the
// Billing page asks for one on each click.
export async function POST(request: Request) {
  return withBillingOwner(request, 'Unable to open card billing.', async ({ shop }) => {
    const link = await paddleLink(shop.id)
    if (!link) return jsonResponse(null, 'This shop does not pay by card.', 404, 'no_card_subscription')
    return jsonResponse(await createPortalLink(link.customerId, link.subscriptionId))
  })
}
