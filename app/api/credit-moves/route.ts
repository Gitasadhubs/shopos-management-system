import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

const schema = z.object({
  client_id: z.string().trim().min(1).max(120),
  customer_id: z.string().uuid(),
  amount: z.coerce.number().finite().positive(),
  type: z.string().trim().min(1).max(40).default('payment'),
  note: z.string().trim().max(500).optional().default(''),
})

const json = (data: unknown, error: string | null = null, status = 200) => NextResponse.json({ data, error }, { status })

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json(null, 'Request body must be valid JSON.', 400)
  }
  const parsed = schema.safeParse(body)
  if (!parsed.success) return json(null, parsed.error.issues[0]?.message ?? 'Invalid credit movement.', 400)
  if (process.env.SHOPOS_STORAGE === 'sqlite') return json(null, 'Customer credit is not configured for SQLite storage.', 501)

  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return json(null, 'Authentication required.', 401)
    const { data: role } = await supabase.from('user_roles').select('shop_id').eq('user_id', user.id).maybeSingle()
    if (!role?.shop_id) return json(null, 'Shop not configured.', 400)
    const { data: existing } = await supabase.from('credit_transactions').select('*').eq('shop_id', role.shop_id).eq('client_id', parsed.data.client_id).maybeSingle()
    if (existing) return json(existing)
    const { data, error } = await supabase.from('credit_transactions').insert({
      shop_id: role.shop_id,
      customer_id: parsed.data.customer_id,
      type: parsed.data.type,
      amount: parsed.data.amount,
      note: parsed.data.note || null,
      client_id: parsed.data.client_id,
    }).select().single()
    if (error) return json(null, error.message, 400)
    return json(data, null, 201)
  } catch {
    return json(null, 'Unable to record credit movement.', 500)
  }
}