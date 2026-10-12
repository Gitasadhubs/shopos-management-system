import { NextResponse } from 'next/server'
import { isSelfHosted, jsonResponse, parseBody, withShop } from '@/lib/local-session'
import { z } from 'zod'
import { createLocalSale, listLocalSales } from '@/lib/local-db'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const localSaleSchema = z.object({
  client_id: z.string().trim().min(1).max(120).optional(),
  customer_id: z.string().uuid('Invalid customer.').nullish(),
  items: z.array(z.object({ product_id: z.string().uuid(), quantity: z.coerce.number().finite().positive().max(1_000_000) })).min(1).max(500),
  discount: z.coerce.number().finite().nonnegative().max(1_000_000_000).default(0),
  // credit: the unpaid part goes on the customer's khata.
  payment_method: z.enum(['cash', 'card', 'credit']).default('cash'),
  amount_paid: z.coerce.number().finite().nonnegative().max(1_000_000_000).optional(),
}).superRefine((sale, context) => {
  const productIds = sale.items.map((item) => item.product_id)
  if (new Set(productIds).size !== productIds.length) context.addIssue({ code: 'custom', message: 'Each product can only appear once in a sale.', path: ['items'] })
})

const hostedSaleSchema = z.object({
  client_id: z.string().trim().min(1).max(120).nullable().optional(),
  customer_id: z.string().uuid().nullable().optional(),
  items: z.array(z.object({
    product_id: z.string().uuid(),
    quantity: z.coerce.number().finite().positive(),
    product_name: z.string().optional(),
    unit_price: z.coerce.number().finite().nonnegative().optional(),
    cost_price: z.coerce.number().finite().nonnegative().optional(),
    subtotal: z.coerce.number().finite().nonnegative().optional(),
  }).passthrough()).min(1),
  total: z.coerce.number().finite().nonnegative(),
  discount: z.coerce.number().finite().nonnegative().default(0),
  payment_method: z.enum(['cash', 'card', 'credit']).default('cash'),
  amount_paid: z.coerce.number().finite().nonnegative().optional(),
})

const json = (data: unknown, error: string | null = null, status = 200) => NextResponse.json({ data, error }, { status })

export async function GET(request: Request) {
  if (isSelfHosted()) {
    return withShop(request, 'pos', 'Unable to load sales history.', async ({ shop }) => jsonResponse(await listLocalSales(shop.id)))
  }

  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return json(null, 'Authentication required.', 401)
    const { data: role } = await supabase.from('user_roles').select('shop_id').eq('user_id', user.id).maybeSingle()
    if (!role?.shop_id) return json(null, 'Shop not configured.', 400)
    const { data, error } = await supabase.from('sales').select('id,total,payment_method,created_at,customers(name)').eq('shop_id', role.shop_id).order('created_at', { ascending: false }).limit(20)
    if (error) throw error
    return json(data ?? [])
  } catch {
    return json(null, 'Unable to load sales history.', 500)
  }
}

export async function POST(request: Request) {
  if (isSelfHosted()) {
    return withShop(request, 'pos', 'Unable to complete sale.', async ({ shop, user }) => {
      const body = await parseBody(request, localSaleSchema)
      if (body instanceof NextResponse) return body
      return jsonResponse(await createLocalSale(shop.id, body.data, user.id), null, 201)
    })
  }
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json(null, 'Request body must be valid JSON.', 400)
  }

  const parsed = hostedSaleSchema.safeParse(body)
  if (!parsed.success) return json(null, parsed.error.issues[0]?.message ?? 'Invalid sale details.', 400)
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return json(null, 'Authentication required.', 401)
    const { data: role } = await supabase.from('user_roles').select('shop_id').eq('user_id', user.id).maybeSingle()
    if (!role?.shop_id) return json(null, 'Shop not configured.', 400)
    const { data, error } = await supabase.rpc('create_sale', {
      p_shop_id: role.shop_id,
      p_customer_id: parsed.data.customer_id ?? null,
      p_items: parsed.data.items,
      p_total: parsed.data.total,
      p_payment_method: parsed.data.payment_method,
      p_amount_paid: parsed.data.amount_paid ?? parsed.data.total,
      p_client_id: parsed.data.client_id ?? null,
    })
    if (error) return json(null, error.message, 400)
    return json(Array.isArray(data) ? data[0] : data, null, 201)
  } catch {
    return json(null, 'Unable to complete sale.', 500)
  }
}