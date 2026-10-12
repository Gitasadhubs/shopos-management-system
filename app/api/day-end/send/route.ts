import { NextResponse } from 'next/server'
import { z } from 'zod'
import { dayParam, sendDayEnd } from '@/lib/day-end'
import { getShop } from '@/lib/local-platform'
import { jsonResponse, parseBody, withShop } from '@/lib/local-session'
import { dayKey } from '@/lib/time'

export const runtime = 'nodejs'

// Sends the day-end report now, to the shop's report email and WhatsApp numbers (Settings).
export async function POST(request: Request) {
  return withShop(request, 'reports', 'Unable to send the report.', async ({ shop: session }) => {
    const body = await parseBody(request, z.object({ day: dayParam.optional() }))
    if (body instanceof NextResponse) return body
    const day = body.data.day ?? dayKey(session.timezone)
    if (day > dayKey(session.timezone)) return jsonResponse(null, 'That day has not happened yet.', 400)
    const { deliveries } = await sendDayEnd((await getShop(session.id))!, day)
    if (!deliveries.length) return jsonResponse(null, 'Add a report email or WhatsApp number in Settings first.', 400, 'no_recipients')
    return jsonResponse({ deliveries })
  })
}
