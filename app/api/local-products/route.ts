import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { insertLocalProduct, listLocalProducts, removeLocalProduct } from '@/lib/local-db'

export const runtime = 'nodejs'
const schema = z.object({ name: z.string().trim().min(1), sku: z.string().trim().optional(), barcode: z.string().trim().optional(), category: z.string().trim().optional(), unit: z.string().trim().default('pcs'), cost_price: z.coerce.number().min(0), sale_price: z.coerce.number().min(0), stock_quantity: z.coerce.number().min(0), reorder_level: z.coerce.number().min(0) })

export function GET(request: NextRequest) { return NextResponse.json({ data: listLocalProducts(request.nextUrl.searchParams.get('search') ?? '') }) }
export async function POST(request: NextRequest) { const parsed = schema.safeParse(await request.json()); if (!parsed.success) return NextResponse.json({ error: 'Enter a valid product name, prices, and stock quantity.' }, { status: 400 }); return NextResponse.json({ data: insertLocalProduct({ ...parsed.data, sku: parsed.data.sku ?? null, barcode: parsed.data.barcode ?? null, category: parsed.data.category ?? null }) }, { status: 201 }) }
export async function DELETE(request: NextRequest) { const id = request.nextUrl.searchParams.get('id'); if (!id) return NextResponse.json({ error: 'Product id is required.' }, { status: 400 }); removeLocalProduct(id); return NextResponse.json({ data: true }) }
