import { NextResponse } from 'next/server'
import { jsonResponse, parseBody, withShop } from '@/lib/local-session'
import { z } from 'zod'
import { createLocalSale, listLocalSales } from '@/lib/local-db'
import { addDays, dayStart } from '@/lib/time'

export const runtime = 'nodejs'

const localSaleSchema = z.object({
  client_id: z.string().trim().min(1).max(120).optional(),
  customer_id: z.string().uuid('Invalid customer.').nullish(),
  items: z.array(z.object({ product_id: z.string().uuid(), quantity: z.coerce.number().finite().positive().max(1_000_000) })).min(1).max(500),
  discount: z.coerce.number().finite().nonnegative().max(1_000_000_000).default(0),
  // credit: the unpaid part goes on the customer's khata.
  payment_method: z.enum(['cash', 'card', 'credit']).default('cash'),
  amount_paid: z.coerce.number().finite().nonnegative().max(1_000_000_000).optional(),
  // Sales rung up while the till was offline (lib/offline/till.ts): when they happened.
  offline: z.boolean().optional(),
  sold_at: z.string().max(40).optional(),
}).superRefine((sale, context) => {
  const productIds = sale.items.map((item) => item.product_id)
  if (new Set(productIds).size !== productIds.length) context.addIssue({ code: 'custom', message: 'Each product can only appear once in a sale.', path: ['items'] })
})

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)))
const listSchema = z.object({
  search: z.string().max(160).optional(),
  from: day.optional(),
  to: day.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
})

// ?search=&from=&to= (shop-local days)&limit=&offset=. Without them: the 20 newest sales.
export async function GET(request: Request) {
  return withShop(request, 'pos', 'Unable to load sales history.', async ({ shop }) => {
    const params = Object.fromEntries([...new URL(request.url).searchParams].filter(([, value]) => value !== ''))
    const parsed = listSchema.safeParse(params)
    if (!parsed.success) return jsonResponse(null, 'Invalid search. Dates must look like 2026-01-31.', 400)
    const { search, from, to, limit, offset } = parsed.data
    return jsonResponse(await listLocalSales(shop.id, {
      search,
      start: from ? dayStart(shop.timezone, from) : undefined,
      end: to ? dayStart(shop.timezone, addDays(to, 1)) : undefined,
      limit,
      offset,
    }))
  })
}

export async function POST(request: Request) {
  return withShop(request, 'pos', 'Unable to complete sale.', async ({ shop, user }) => {
    const body = await parseBody(request, localSaleSchema)
    if (body instanceof NextResponse) return body
    return jsonResponse(await createLocalSale(shop.id, body.data, user.id), null, 201)
  })
}
