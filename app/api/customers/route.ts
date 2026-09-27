import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { defaultShopId, getCustomers } from '@/lib/db'

const schema = z.object({
  name: z.string().trim().min(1, 'Customer name is required.').max(160),
  phone: z.string().trim().max(40).optional().default(''),
  address: z.string().trim().max(300).optional().default(''),
  notes: z.string().trim().max(1000).optional().default(''),
})

const json = (data: unknown, error: string | null = null, status = 200) => NextResponse.json({ data, error }, { status })

export async function GET(request: NextRequest) {
  if (process.env.SHOPOS_STORAGE === 'sqlite') return json(null, 'Customer records are not configured for SQLite storage.', 501)
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return json(null, 'Authentication required.', 401)
    return json(await getCustomers(request.nextUrl.searchParams.get('search') ?? undefined))
  } catch {
    return json(null, 'Unable to load customers.', 500)
  }
}

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json(null, 'Request body must be valid JSON.', 400)
  }
  const parsed = schema.safeParse(body)
  if (!parsed.success) return json(null, parsed.error.issues[0]?.message ?? 'Invalid customer details.', 400)
  if (process.env.SHOPOS_STORAGE === 'sqlite') return json(null, 'Customer records are not configured for SQLite storage.', 501)

  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return json(null, 'Authentication required.', 401)
    const { data, error } = await supabase.from('customers').insert({ ...parsed.data, shop_id: defaultShopId() }).select().single()
    if (error) return json(null, error.message, 400)
    return json(data, null, 201)
  } catch {
    return json(null, 'Unable to create customer.', 500)
  }
}