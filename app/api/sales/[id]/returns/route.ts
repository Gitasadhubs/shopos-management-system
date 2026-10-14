import { NextResponse } from 'next/server'
import { z } from 'zod'
import { returnLocalSale } from '@/lib/local-db'
import { jsonResponse, parseBody, withShop } from '@/lib/local-session'

export const runtime = 'nodejs'

const returnSchema = z.object({
  client_id: z.string().trim().min(1).max(120).optional(),
  items: z.array(z.object({ product_id: z.string().uuid('Invalid product.'), quantity: z.coerce.number().finite().positive('Return at least one item.').max(1_000_000) })).min(1, 'Choose what is being returned.').max(500),
  reason: z.string().trim().max(300).optional(),
})

// Takes items back from a sale and refunds them. Owners and managers only.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withShop(request, 'returns', 'Unable to record the return.', async ({ shop, user }) => {
    const id = (await params).id
    if (!z.string().uuid().safeParse(id).success) return jsonResponse(null, 'Sale not found.', 404)
    const body = await parseBody(request, returnSchema)
    if (body instanceof NextResponse) return body
    return jsonResponse(await returnLocalSale(shop.id, id, body.data, user.id), null, 201)
  })
}
