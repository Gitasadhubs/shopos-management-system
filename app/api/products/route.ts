import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createProduct, defaultShopId, getProducts } from '@/lib/db'
import { createClient } from '@/lib/supabase/server'

const productSchema = z.object({ name: z.string().min(1), sku: z.string().optional(), barcode: z.string().optional(), category: z.string().optional(), unit: z.string().default('pcs'), cost_price: z.coerce.number().nonnegative().default(0), sale_price: z.coerce.number().nonnegative().default(0), stock_quantity: z.coerce.number().nonnegative().default(0), reorder_level: z.coerce.number().nonnegative().default(0), image_url: z.string().url().optional().or(z.literal('')) })
const json = (data: unknown, error: string | null = null, status = 200) => NextResponse.json({ data, error }, { status })

async function requireUser() {
  const supabase = await createClient()
  const { data } = await supabase.auth.getUser()
  return { supabase, user: data.user }
}

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireUser()
    if (!user) return json(null, 'Authentication required', 401)
    const params = request.nextUrl.searchParams
    return json(await getProducts({ search: params.get('search') ?? undefined, category: params.get('category') ?? undefined }))
  } catch { return json(null, 'Unable to load products', 500) }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireUser()
    if (!user) return json(null, 'Authentication required', 401)
    const input = productSchema.parse(await request.json())
    return json(await createProduct(input), null, 201)
  } catch (error) { return json(null, error instanceof z.ZodError ? 'Invalid product details' : 'Unable to create product', 400) }
}
