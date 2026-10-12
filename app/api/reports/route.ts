import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { getReport } from '@/lib/local-reports'
import { jsonResponse, withShop } from '@/lib/local-session'
import { addDays, dayKey } from '@/lib/time'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), 'Invalid date.')

// ?from=YYYY-MM-DD&to=YYYY-MM-DD, whole days in the shop's time zone. Defaults to the last 30 days.
export async function GET(request: NextRequest) {
  return withShop(request, 'reports', 'Unable to build the report.', async ({ shop }) => {
    const today = dayKey(shop.timezone)
    const params = request.nextUrl.searchParams
    const from = day.safeParse(params.get('from') ?? addDays(today, -29))
    const to = day.safeParse(params.get('to') ?? today)
    if (!from.success || !to.success) return jsonResponse(null, 'Dates must look like 2026-01-31.', 400)
    return jsonResponse(await getReport(shop.id, shop.timezone, from.data, to.data))
  })
}
