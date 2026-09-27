import { NextResponse } from 'next/server'
import { z } from 'zod'
import { adjustLocalStock, LocalDataError } from '@/lib/local-db'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const schema = z.object({
  product_id: z.string().uuid(),
  delta: z.coerce.number().finite().refine((value) => value !== 0, 'Stock change cannot be zero.'),
  reason: z.string().trim().min(2).max(200),
})

function json(data: unknown, error: string | null = null, status = 200) {
  return NextResponse.json({ data, error }, { status })
}

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json(null, 'Request body must be valid JSON.', 400)
  }
  const parsed = schema.safeParse(body)
  if (!parsed.success) return json(null, parsed.error.issues[0]?.message ?? 'Invalid stock adjustment.', 400)

  if (process.env.SHOPOS_STORAGE === 'sqlite') {
    try {
      return json(adjustLocalStock(parsed.data.product_id, parsed.data.delta, parsed.data.reason))
    } catch (error) {
      if (error instanceof LocalDataError) return json(null, error.message, error.status)
      return json(null, 'Unable to adjust stock.', 500)
    }
  }

  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return json(null, 'Authentication required.', 401)
    return json(null, 'Stock adjustments are not configured for hosted storage.', 501)
  } catch {
    return json(null, 'Unable to adjust stock.', 500)
  }
}