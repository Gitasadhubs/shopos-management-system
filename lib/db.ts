import { createClient } from '@/lib/supabase/server'

export type Product = {
  id: string
  shop_id: string
  name: string
  sku: string | null
  barcode: string | null
  category: string | null
  unit: string
  cost_price: number
  sale_price: number
  stock_quantity: number
  reorder_level: number
  image_url: string | null
  is_active: boolean
}

export type Customer = { id: string; shop_id: string; name: string; phone: string | null; address: string | null; credit_balance: number; notes: string | null }

export function defaultShopId() {
  return process.env.DEFAULT_SHOP_ID ?? '00000000-0000-0000-0000-000000000001'
}

export async function getProducts(filters?: { search?: string; category?: string }) {
  const supabase = await createClient()
  let query = supabase.from('products').select('*').eq('shop_id', defaultShopId()).eq('is_active', true).order('name')
  if (filters?.search) query = query.or(`name.ilike.%${filters.search}%,sku.ilike.%${filters.search}%,barcode.ilike.%${filters.search}%`)
  if (filters?.category && filters.category !== 'all') query = query.eq('category', filters.category)
  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as Product[]
}

export async function getCustomers(search?: string) {
  const supabase = await createClient()
  let query = supabase.from('customers').select('id,shop_id,name,phone,address,credit_balance,notes').eq('shop_id', defaultShopId()).order('name')
  if (search) query = query.or(`name.ilike.%${search}%,phone.ilike.%${search}%`)
  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as Customer[]
}

export async function createProduct(input: Record<string, unknown>) {
  const supabase = await createClient()
  const { data, error } = await supabase.from('products').insert({ ...input, shop_id: defaultShopId() }).select().single()
  if (error) throw error
  return data as Product
}

export async function updateProduct(id: string, input: Record<string, unknown>) {
  const supabase = await createClient()
  const { data, error } = await supabase.from('products').update({ ...input, updated_at: new Date().toISOString() }).eq('id', id).eq('shop_id', defaultShopId()).select().single()
  if (error) throw error
  return data as Product
}
