import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getLocalProduct, insertLocalProduct, listLocalProducts, productPhotoInUse, removeLocalProduct, updateLocalProduct } from '@/lib/local-db'
import { jsonResponse, parseBody, withShop } from '@/lib/local-session'
import { keyFromUrl } from '@/lib/file-keys'
import { deleteFile } from '@/lib/storage'

export const runtime = 'nodejs'

const productSchema = z.object({
  name: z.string().trim().min(1, 'Product name is required.').max(160),
  sku: z.string().trim().max(80).optional().default(''),
  barcode: z.string().trim().max(80).optional().default(''),
  category: z.string().trim().max(80).optional().default(''),
  unit: z.string().trim().min(1).max(20).optional().default('pcs'),
  cost_price: z.coerce.number().finite().nonnegative().max(1_000_000_000).default(0),
  sale_price: z.coerce.number().finite().nonnegative().max(1_000_000_000).default(0),
  stock_quantity: z.coerce.number().finite().nonnegative().max(1_000_000_000).default(0),
  reorder_level: z.coerce.number().finite().nonnegative().max(1_000_000_000).default(0),
  // A photo uploaded through /api/products/image, or a link to one on the web.
  image_url: z.string().trim().max(2048).refine((value) => value === '' || value.startsWith('/api/files/') || /^https?:\/\/\S+$/i.test(value), 'Choose an uploaded photo or a web link.').optional().default(''),
})

// Uploaded photos must be this shop's own.
function foreignPhoto(url: string, shopId: string) {
  if (!url.startsWith('/api/files/')) return false
  const file = keyFromUrl(url)
  return !file || file.shopId !== shopId || file.kind !== 'products'
}
const FOREIGN_PHOTO = 'That photo does not belong to this shop. Upload it again.'


const updateSchema = productSchema.extend({ id: z.string().uuid('Invalid product id.') })

export async function GET(request: NextRequest) {
  return withShop(request, 'pos', 'Unable to load products.', async ({ shop }) => jsonResponse(await listLocalProducts(shop.id, request.nextUrl.searchParams.get('search') ?? '')))
}

export async function POST(request: Request) {
  return withShop(request, 'inventory', 'Unable to create product.', async ({ shop }) => {
    const body = await parseBody(request, productSchema)
    if (body instanceof NextResponse) return body
    if (foreignPhoto(body.data.image_url, shop.id)) return jsonResponse(null, FOREIGN_PHOTO, 400)
    return jsonResponse(await insertLocalProduct(shop.id, body.data), null, 201)
  })
}

export async function PUT(request: Request) {
  return withShop(request, 'inventory', 'Unable to update product.', async ({ shop }) => {
    const body = await parseBody(request, updateSchema)
    if (body instanceof NextResponse) return body
    const { id, ...product } = body.data
    if (foreignPhoto(product.image_url, shop.id)) return jsonResponse(null, FOREIGN_PHOTO, 400)
    const previous = await getLocalProduct(shop.id, id)
    const updated = await updateLocalProduct(shop.id, id, product)
    if (!updated) return jsonResponse(null, 'Product not found.', 404)
    // A replaced or removed photo is deleted once no other product shows it.
    const oldPhoto = keyFromUrl(previous?.image_url)
    if (oldPhoto && previous?.image_url !== updated.image_url && !(await productPhotoInUse(shop.id, previous!.image_url!))) await deleteFile(oldPhoto.key)
    return jsonResponse(updated)
  })
}

export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id')
  const validId = Boolean(id && z.string().uuid().safeParse(id).success)
  return withShop(request, 'inventory', 'Unable to delete product.', async ({ shop }) => {
    if (!validId) return jsonResponse(null, 'A valid product id is required.', 400)
    return (await removeLocalProduct(shop.id, id!)) ? jsonResponse(true) : jsonResponse(null, 'Product not found.', 404)
  })
}
