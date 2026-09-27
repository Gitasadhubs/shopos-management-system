import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const body = await request.json()
  const clientId = typeof body.client_id === 'string' ? body.client_id : null
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: role } = await supabase.from('user_roles').select('shop_id').eq('user_id', user.id).maybeSingle()
  const customerId = (await params).id
  if (!role?.shop_id) return NextResponse.json({ error: 'Shop not configured' }, { status: 400 })
  if (!clientId) return NextResponse.json({ error: 'client_id is required' }, { status: 400 })
  const { data: existing } = await supabase.from('credit_transactions').select('*').eq('shop_id', role.shop_id).eq('client_id', clientId).maybeSingle()
  if (existing) return NextResponse.json({ data: existing })
  const { data, error } = await supabase.from('credit_transactions').insert({ shop_id: role.shop_id, customer_id: customerId, type: body.type ?? 'payment', amount: body.amount, note: body.note ?? null, client_id: clientId }).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ data })
}

export const runtime = 'nodejs'
