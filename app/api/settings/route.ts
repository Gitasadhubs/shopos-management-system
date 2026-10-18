import { NextResponse } from 'next/server'
import { z } from 'zod'
import { isCountryCode } from '@/lib/countries'
import { getShop, updateShop } from '@/lib/local-platform'
import { jsonResponse, parseBody, withShop } from '@/lib/local-session'
import { isValidTimeZone } from '@/lib/time'
import { normalizePhone, parsePhoneList } from '@/lib/whatsapp'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Every field is optional: only the ones sent are changed.
const shopSchema = z.object({
  name: z.string().trim().min(1, 'Shop name is required.').max(120).optional(),
  phone: z.string().trim().max(40).optional(),
  address: z.string().trim().max(300).optional(),
  receipt_footer: z.string().trim().max(300).optional(),
  timezone: z.string().trim().max(64).refine(isValidTimeZone, 'Choose a valid time zone.').optional(),
  // ISO 3166-1 alpha-2; sets currency, language, tax and receipt rules (lib/countries).
  country: z.string().trim().toUpperCase().refine(isCountryCode, 'Choose a country.').optional(),
  daily_target: z.coerce.number().finite().min(0, 'The daily target cannot be negative.').max(1_000_000_000).nullable().optional(),
  report_enabled: z.boolean().optional(),
  report_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Choose a time like 22:00.').optional(),
  report_email: z.string().trim().toLowerCase().email('Enter a valid report email.').max(254).or(z.literal('')).optional(),
  report_whatsapp: z.string().trim().max(200).refine((value) => parsePhoneList(value).every((number) => normalizePhone(number)), 'Enter WhatsApp numbers like 0300 1234567, separated by commas.').refine((value) => parsePhoneList(value).length <= 5, 'Up to 5 WhatsApp numbers.').optional(),
})

// The shop profile printed on receipts. Everyone in the shop can read it; only the owner changes it.
export async function GET(request: Request) {
  return withShop(request, 'dashboard', 'Unable to load shop settings.', async ({ shop }) => jsonResponse(await getShop(shop.id)))
}

export async function PUT(request: Request) {
  return withShop(request, 'billing', 'Unable to save shop settings.', async ({ shop }) => {
    const body = await parseBody(request, shopSchema)
    if (body instanceof NextResponse) return body
    return jsonResponse(await updateShop(shop.id, body.data))
  })
}
