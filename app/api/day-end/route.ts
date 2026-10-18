import type { NextRequest } from 'next/server'
import { dayEndText, dayParam, getDayEnd, listDeliveries } from '@/lib/day-end'
import { formatFor } from '@/lib/format'
import { getShop } from '@/lib/local-platform'
import { jsonResponse, withShop } from '@/lib/local-session'
import { dayKey } from '@/lib/time'
import { whatsAppConfigured } from '@/lib/whatsapp'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ?day=YYYY-MM-DD (shop-local; default today): the closing report, its WhatsApp text and how it is sent.
export async function GET(request: NextRequest) {
  return withShop(request, 'reports', 'Unable to build the day-end report.', async ({ shop: session }) => {
    const today = dayKey(session.timezone)
    const parsed = dayParam.safeParse(request.nextUrl.searchParams.get('day') ?? today)
    if (!parsed.success) return jsonResponse(null, 'Dates must look like 2026-01-31.', 400)
    if (parsed.data > today) return jsonResponse(null, 'That day has not happened yet.', 400)
    const shop = (await getShop(session.id))!
    const report = await getDayEnd(shop.id, shop.timezone, parsed.data)
    return jsonResponse({
      report,
      text: dayEndText(shop.name, report, formatFor(shop)),
      today,
      delivery: { enabled: shop.report_enabled, time: shop.report_time, email: shop.report_email, whatsapp: shop.report_whatsapp, whatsapp_api: whatsAppConfigured(), last_sent_on: shop.report_last_sent_on },
      deliveries: await listDeliveries(shop.id),
    })
  })
}
