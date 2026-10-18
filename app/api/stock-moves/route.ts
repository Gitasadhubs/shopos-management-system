import { NextResponse } from 'next/server'
import { jsonResponse, parseBody, withShop } from '@/lib/local-session'
import { z } from 'zod'
import { adjustLocalStock } from '@/lib/local-db'

export const runtime = 'nodejs'

const schema = z.object({
  product_id: z.string().uuid(),
  delta: z.coerce.number().finite().min(-1_000_000_000).max(1_000_000_000).refine((value) => value !== 0, 'Stock change cannot be zero.'),
  reason: z.string().trim().min(2).max(200),
})

export async function POST(request: Request) {
  return withShop(request, 'inventory', 'Unable to adjust stock.', async ({ shop, user }) => {
    const body = await parseBody(request, schema)
    if (body instanceof NextResponse) return body
    return jsonResponse(await adjustLocalStock(shop.id, body.data.product_id, body.data.delta, body.data.reason, user.id))
  })
}
