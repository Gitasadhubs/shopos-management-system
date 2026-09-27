import { NextResponse } from 'next/server'
import { getLocalDashboardStats } from '@/lib/local-db'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const json = (data: unknown, error: string | null = null, status = 200) => NextResponse.json({ data, error }, { status })

function startOfDay() {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  return date.toISOString()
}

export async function GET() {
  const startAt = startOfDay()
  if (process.env.SHOPOS_STORAGE === 'sqlite') {
    try {
      return json(getLocalDashboardStats(startAt))
    } catch {
      return json(null, 'Unable to load dashboard statistics.', 500)
    }
  }

  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return json(null, 'Authentication required.', 401)
    const { data: role } = await supabase.from('user_roles').select('shop_id').eq('user_id', user.id).maybeSingle()
    if (!role?.shop_id) return json(null, 'Shop not configured.', 400)

    const [{ data: sales, error: salesError }, { data: products, error: productsError }, { data: customers, error: customersError }] = await Promise.all([
      supabase.from('sales').select('id,total,discount,payment_method,created_at,customers(name)').eq('shop_id', role.shop_id).gte('created_at', startAt).order('created_at', { ascending: false }),
      supabase.from('products').select('id,name,stock_quantity,reorder_level').eq('shop_id', role.shop_id).eq('is_active', true).order('stock_quantity', { ascending: true }),
      supabase.from('customers').select('credit_balance').eq('shop_id', role.shop_id),
    ])
    if (salesError || productsError || customersError) throw salesError ?? productsError ?? customersError

    const saleRows = sales ?? []
    const saleIds = saleRows.map((sale) => sale.id)
    const { data: saleItems, error: itemsError } = saleIds.length
      ? await supabase.from('sale_items').select('sale_id,unit_price,cost_price,quantity').in('sale_id', saleIds)
      : { data: [], error: null }
    if (itemsError) throw itemsError
    const lowProducts = (products ?? []).filter((product) => Number(product.stock_quantity ?? 0) <= Number(product.reorder_level ?? 0))
    return json({
      sales: saleRows.reduce((sum, sale) => sum + Number(sale.total ?? 0), 0),
      profit: (saleItems ?? []).reduce((sum, item) => sum + (Number(item.unit_price ?? 0) - Number(item.cost_price ?? 0)) * Number(item.quantity ?? 0), 0) - saleRows.reduce((sum, sale) => sum + Number(sale.discount ?? 0), 0),
      lowStock: lowProducts.length,
      salesCount: saleRows.length,
      lowProducts,
      recent: saleRows.slice(0, 10),
      credit: (customers ?? []).reduce((sum, customer) => sum + Number(customer.credit_balance ?? 0), 0),
    })
  } catch {
    return json(null, 'Unable to load dashboard statistics.', 500)
  }
}