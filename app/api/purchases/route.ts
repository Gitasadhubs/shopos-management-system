import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createPurchase, listPurchases } from '@/lib/local-business'
import { jsonResponse, parseBody, withShop } from '@/lib/local-session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const purchaseSchema = z.object({
  supplier_id: z.string().uuid('Invalid supplier.').nullish(),
  reference: z.string().trim().max(80).optional().default(''),
  notes: z.string().trim().max(1000).optional().default(''),
  amount_paid: z.coerce.number().finite().nonnegative().max(1_000_000_000).optional(),
  update_cost: z.boolean().optional().default(true),
  items: z.array(z.object({
    product_id: z.string().uuid(),
    quantity: z.coerce.number().finite().positive('Quantities must be above zero.').max(1_000_000),
    unit_cost: z.coerce.number().finite().nonnegative('Costs cannot be negative.').max(1_000_000_000),
  })).min(1, 'Add at least one product.').max(500),
})

export async function GET(request: Request) {
  return withShop(request, 'purchases', 'Unable to load purchases.', async ({ shop }) => jsonResponse(await listPurchases(shop.id)))
}

// Receiving stock from a supplier.
export async function POST(request: Request) {
  return withShop(request, 'purchases', 'Unable to record the purchase.', async ({ shop, user }) => {
    const body = await parseBody(request, purchaseSchema)
    if (body instanceof NextResponse) return body
    return jsonResponse(await createPurchase(shop.id, body.data, user.id), null, 201)
  })
}
