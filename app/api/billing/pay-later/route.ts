import { z } from 'zod'
import { withBillingOwner } from '@/lib/billing-route'
import { payLater } from '@/lib/local-platform'
import { jsonResponse } from '@/lib/local-session'

export const runtime = 'nodejs'

const schema = z.object({ plan: z.enum(['starter', 'growth']), interval: z.enum(['month', 'year']) })

// "Pay later": the owner starts a card plan now and pays within 7 days (lib/local-platform.ts payLater),
// by card or by transfer recorded in Admin. Refused while an earlier one is still unpaid.
export async function POST(request: Request) {
  return withBillingOwner(request, 'Unable to start the plan.', async ({ user, shop }) => {
    const parsed = schema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return jsonResponse(null, 'Choose a plan.', 400)
    return jsonResponse(await payLater(user.id, shop.id, parsed.data.plan, parsed.data.interval))
  })
}
