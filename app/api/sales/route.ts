import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  const body = await request.json()
  const clientId = typeof body.client_id === 'string' ? body.client_id : null
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: role } = await supabase.from('user_roles').select('shop_id').eq('user_id', user.id).maybeSingle()
  if (!role?.shop_id) return NextResponse.json({ error: 'Shop not configured' }, { status: 400 })
  const { data, error } = await supabase.rpc('create_sale', {
    p_shop_id: role.shop_id,
    p_customer_id: body.customer_id ?? null,
    p_items: body.items ?? [],
    p_total: body.total,
    p_payment_method: body.payment_method,
    p_amount_paid: body.amount_paid ?? body.total,
    p_client_id: clientId,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ data: Array.isArray(data) ? data[0] : data })
}

export const runtime = 'nodejs'
