import { NextResponse } from 'next/server'
import { isSelfHosted, jsonResponse, parseBody, withShop } from '@/lib/local-session'
import { z } from 'zod'
import { adjustLocalStock } from '@/lib/local-db'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const schema = z.object({
  product_id: z.string().uuid(),
  delta: z.coerce.number().finite().min(-1_000_000_000).max(1_000_000_000).refine((value) => value !== 0, 'Stock change cannot be zero.'),
  reason: z.string().trim().min(2).max(200),
})

function json(data: unknown, error: string | null = null, status = 200) {
  return NextResponse.json({ data, error }, { status })
}

export async function POST(request: Request) {
  if (isSelfHosted()) {
    return withShop(request, 'inventory', 'Unable to adjust stock.', async ({ shop, user }) => {
      const body = await parseBody(request, schema)
      if (body instanceof NextResponse) return body
      return jsonResponse(await adjustLocalStock(shop.id, body.data.product_id, body.data.delta, body.data.reason, user.id))
    })
  }
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json(null, 'Request body must be valid JSON.', 400)
  }
  const parsed = schema.safeParse(body)
  if (!parsed.success) return json(null, parsed.error.issues[0]?.message ?? 'Invalid stock adjustment.', 400)

  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return json(null, 'Authentication required.', 401)
    return json(null, 'Stock adjustments are not configured for hosted storage.', 501)
  } catch {
    return json(null, 'Unable to adjust stock.', 500)
  }
}